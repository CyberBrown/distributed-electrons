/**
 * ProductShippingResearchWorkflow
 *
 * Cloudflare Workflow for researching product shipping dimensions using Gemini CLI.
 * This workflow:
 * 1. Takes product information (SKU, name, description, brand)
 * 2. Sends to Gemini CLI with web search capability
 * 3. Parses the JSON response for shipping dimensions
 * 4. Returns structured shipping data
 *
 * Routes ONLY to Gemini CLI (no fallback) because web search is required.
 */

import { WorkflowEntrypoint, WorkflowStep, type WorkflowEvent } from 'cloudflare:workers';
import type {
  ProductShippingResearchParams,
  ProductShippingResearchResult,
  ProductShippingResearchEnv,
  ShippingData,
  ProductInfo,
} from './types';

const DEFAULT_GEMINI_RUNNER_URL = 'https://gemini-runner.shiftaltcreate.com';

/**
 * Build the Gemini prompt for shipping research
 */
function buildShippingResearchPrompt(product: ProductInfo): string {
  const parts: string[] = [
    'You are a product research assistant. Find the shipping dimensions for this product:',
    '',
  ];

  if (product.brand) {
    parts.push(`Manufacturer/Brand: ${product.brand}`);
  }
  parts.push(`Product: ${product.name}`);
  parts.push(`SKU: ${product.sku}`);
  if (product.description) {
    parts.push(`Description: ${product.description}`);
  }
  if (product.image_urls && product.image_urls.length > 0) {
    parts.push(`Reference Images: ${product.image_urls.join(', ')}`);
  }

  parts.push('');
  parts.push('Search online for the manufacturer specs, distributor listings, or retail sites that list shipping dimensions.');
  parts.push('');
  parts.push('IMPORTANT:');
  parts.push('- Look for SHIPPING dimensions (boxed/packaged), not just product dimensions');
  parts.push('- If only product dimensions are available, add 10-15% for packaging');
  parts.push('- Verify the product name/SKU matches before using specs');
  parts.push('- If you cannot find reliable specs, make a reasonable estimate based on similar products');
  parts.push('');
  parts.push('Return ONLY a JSON object with these fields:');
  parts.push('{');
  parts.push('  "shipping_weight": <number in lbs>,');
  parts.push('  "shipping_length": <number in inches>,');
  parts.push('  "shipping_width": <number in inches>,');
  parts.push('  "shipping_height": <number in inches>,');
  parts.push('  "source": "<URL where found or \'estimated\'>",');
  parts.push('  "confidence": "<high|medium|low>"');
  parts.push('}');
  parts.push('');
  parts.push('No other text, just the JSON.');

  return parts.join('\n');
}

/**
 * Parse shipping data from Gemini response
 * Handles various JSON formats and extracts the shipping data
 */
function parseShippingData(response: string): ShippingData | null {
  // Try to extract JSON from the response
  // Handle cases where JSON is wrapped in markdown code blocks
  let jsonStr = response.trim();

  // Remove markdown code blocks if present
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  // Try to find JSON object in the response
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.log('[ProductShippingResearch] No JSON object found in response');
    return null;
  }

  try {
    const data = JSON.parse(jsonMatch[0]);

    // Validate required fields
    if (
      typeof data.shipping_weight !== 'number' ||
      typeof data.shipping_length !== 'number' ||
      typeof data.shipping_width !== 'number' ||
      typeof data.shipping_height !== 'number'
    ) {
      console.log('[ProductShippingResearch] Missing or invalid numeric fields');
      return null;
    }

    // Validate confidence level
    const validConfidence = ['high', 'medium', 'low'];
    if (!validConfidence.includes(data.confidence)) {
      data.confidence = 'low'; // Default to low if invalid
    }

    // Ensure source is a string
    if (typeof data.source !== 'string') {
      data.source = 'estimated';
    }

    return {
      shipping_weight: data.shipping_weight,
      shipping_length: data.shipping_length,
      shipping_width: data.shipping_width,
      shipping_height: data.shipping_height,
      source: data.source,
      confidence: data.confidence as 'high' | 'medium' | 'low',
    };
  } catch (error) {
    console.error('[ProductShippingResearch] Failed to parse JSON:', error);
    return null;
  }
}

export class ProductShippingResearchWorkflow extends WorkflowEntrypoint<
  ProductShippingResearchEnv,
  ProductShippingResearchParams
> {
  /**
   * Main workflow execution
   */
  override async run(
    event: WorkflowEvent<ProductShippingResearchParams>,
    step: WorkflowStep
  ) {
    const {
      request_id,
      product,
      callback_url,
      timeout_ms = 120000, // 2 minutes default
    } = event.payload;

    const startTime = Date.now();

    console.log(`[ProductShippingResearch] Starting for request ${request_id}`);
    console.log(`[ProductShippingResearch] Product: ${product.name} (SKU: ${product.sku})`);

    // Step 1: Validate product info
    const validation = await step.do(
      'validate-product',
      {
        retries: { limit: 1, delay: '1 second', backoff: 'constant' },
        timeout: '5 seconds',
      },
      async () => {
        return this.validateProduct(product);
      }
    );

    if (!validation.valid) {
      console.error(`[ProductShippingResearch] Validation failed: ${validation.error}`);
      const result: ProductShippingResearchResult = {
        success: false,
        sku: product.sku,
        error: validation.error,
        duration_ms: Date.now() - startTime,
      };

      if (callback_url) {
        await this.sendCallback(callback_url, result);
      }

      return result;
    }

    // Step 2: Call Gemini runner for shipping research
    let shippingData: ShippingData | null = null;
    let error: string | undefined;

    try {
      const geminiResult = await step.do(
        'research-shipping',
        {
          retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' },
          timeout: `${Math.ceil(timeout_ms / 1000)} seconds`,
        },
        async () => {
          return this.callGeminiRunner(product);
        }
      );

      if (geminiResult.success && geminiResult.output) {
        console.log(`[ProductShippingResearch] Gemini response received, parsing...`);
        shippingData = parseShippingData(geminiResult.output);

        if (!shippingData) {
          error = 'Failed to parse shipping data from Gemini response';
          console.log(`[ProductShippingResearch] Raw response: ${geminiResult.output.substring(0, 500)}`);
        }
      } else {
        error = geminiResult.error || 'Gemini runner failed';
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      console.error(`[ProductShippingResearch] Gemini call failed: ${error}`);
    }

    // Build result
    const result: ProductShippingResearchResult & { output?: string } = {
      success: !!shippingData,
      sku: product.sku,
      shipping_data: shippingData || undefined,
      error,
      duration_ms: Date.now() - startTime,
      // Include output field for PrimeWorkflow to extract
      output: shippingData ? JSON.stringify(shippingData) : undefined,
    };

    // Step 3: Send callback if configured
    if (callback_url) {
      await step.do(
        'send-callback',
        {
          retries: { limit: 3, delay: '2 seconds', backoff: 'exponential' },
          timeout: '30 seconds',
        },
        async () => {
          await this.sendCallback(callback_url, result);
          return { sent: true };
        }
      );
    }

    // Step 4: Log completion
    await step.do(
      'log-completion',
      {
        retries: { limit: 1, delay: '1 second', backoff: 'constant' },
        timeout: '5 seconds',
      },
      async () => {
        console.log(`[ProductShippingResearch] Completed for ${product.sku}`);
        console.log(`[ProductShippingResearch] Result: ${JSON.stringify(result)}`);
        return { logged: true };
      }
    );

    return result;
  }

  /**
   * Validate product information
   */
  private validateProduct(product: ProductInfo): { valid: boolean; error?: string } {
    if (!product.sku || product.sku.trim() === '') {
      return { valid: false, error: 'Missing product SKU' };
    }

    if (!product.name || product.name.trim() === '') {
      return { valid: false, error: 'Missing product name' };
    }

    return { valid: true };
  }

  /**
   * Call Gemini runner for shipping research
   */
  private async callGeminiRunner(
    product: ProductInfo
  ): Promise<{ success: boolean; output?: string; error?: string }> {
    const url = this.env.GEMINI_RUNNER_URL || DEFAULT_GEMINI_RUNNER_URL;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.env.GEMINI_RUNNER_SECRET) {
      headers['X-Runner-Secret'] = this.env.GEMINI_RUNNER_SECRET;
    }
    if (this.env.CF_ACCESS_CLIENT_ID && this.env.CF_ACCESS_CLIENT_SECRET) {
      headers['CF-Access-Client-Id'] = this.env.CF_ACCESS_CLIENT_ID;
      headers['CF-Access-Client-Secret'] = this.env.CF_ACCESS_CLIENT_SECRET;
    }

    const prompt = buildShippingResearchPrompt(product);
    console.log(`[ProductShippingResearch] Sending prompt to Gemini runner...`);

    const response = await fetch(`${url}/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt: prompt,
        timeout_ms: 120000, // 2 minutes for web search
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[ProductShippingResearch] Gemini runner HTTP error: ${response.status}`);
      return {
        success: false,
        error: `Gemini runner error (${response.status}): ${errorText}`,
      };
    }

    const data = (await response.json()) as {
      success: boolean;
      output?: string;
      error?: string;
    };

    if (!data.success) {
      return {
        success: false,
        error: data.error || 'Gemini runner failed',
      };
    }

    return {
      success: true,
      output: data.output,
    };
  }

  /**
   * Send callback with result
   */
  private async sendCallback(
    callbackUrl: string,
    result: ProductShippingResearchResult
  ): Promise<void> {
    console.log(`[ProductShippingResearch] Sending callback to ${callbackUrl}`);

    const response = await fetch(callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Passphrase': this.env.NEXUS_PASSPHRASE || '',
      },
      body: JSON.stringify({
        ...result,
        timestamp: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[ProductShippingResearch] Callback failed: ${response.status}`);
      throw new Error(`Callback failed (${response.status}): ${errorText}`);
    }

    console.log('[ProductShippingResearch] Callback sent successfully');
  }
}
