/**
 * ProductShippingResearchWorkflow
 *
 * Cloudflare Workflow for researching product shipping dimensions using z.ai.
 * This workflow:
 * 1. Takes product information (SKU, name, description, brand)
 * 2. Calls z.ai API (GLM model with web search capability)
 * 3. Parses the JSON response for shipping dimensions
 * 4. Returns structured shipping data
 */

import { WorkflowEntrypoint, WorkflowStep, type WorkflowEvent } from 'cloudflare:workers';
import type {
  ProductShippingResearchParams,
  ProductShippingResearchResult,
  ProductShippingResearchEnv,
  ShippingData,
  ProductInfo,
} from './types';

// z.ai API configuration
const ZAI_API_URL = 'https://api.z.ai/api/paas/v4/chat/completions';
const ZAI_MODEL = 'GLM-4-32B-0414';

/**
 * Build the system prompt for shipping research
 */
function buildSystemPrompt(): string {
  return `You are a product research assistant specializing in finding shipping dimensions.
Your task is to search the web and find accurate shipping dimensions for products.

IMPORTANT GUIDELINES:
- Look for SHIPPING dimensions (boxed/packaged), not just product dimensions
- If only product dimensions are available, add 10-15% for packaging
- Verify the product name/SKU matches before using specs
- If you cannot find reliable specs, make a reasonable estimate based on similar products
- Always cite your source

You MUST respond with ONLY a valid JSON object in this exact format:
{
  "shipping_weight": <number in lbs>,
  "shipping_length": <number in inches>,
  "shipping_width": <number in inches>,
  "shipping_height": <number in inches>,
  "source": "<URL where found or 'estimated'>",
  "confidence": "<high|medium|low>"
}

No other text, explanations, or markdown - just the raw JSON object.`;
}

/**
 * Build the user prompt for shipping research
 */
function buildUserPrompt(product: ProductInfo): string {
  const parts: string[] = [
    'Find the shipping dimensions for this product:',
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

  parts.push('');
  parts.push('Search online for manufacturer specs, distributor listings, or retail sites.');

  return parts.join('\n');
}

/**
 * Parse shipping data from z.ai response
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

    // Step 2: Call z.ai for shipping research
    let shippingData: ShippingData | null = null;
    let error: string | undefined;

    try {
      const zaiResult = await step.do(
        'research-shipping',
        {
          retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' },
          timeout: `${Math.ceil(timeout_ms / 1000)} seconds`,
        },
        async () => {
          return this.callZAI(product);
        }
      );

      if (zaiResult.success && zaiResult.output) {
        console.log(`[ProductShippingResearch] z.ai response received, parsing...`);
        shippingData = parseShippingData(zaiResult.output);

        if (!shippingData) {
          error = 'Failed to parse shipping data from z.ai response';
          console.log(`[ProductShippingResearch] Raw response: ${zaiResult.output.substring(0, 500)}`);
        }
      } else {
        error = zaiResult.error || 'z.ai API call failed';
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      console.error(`[ProductShippingResearch] z.ai call failed: ${error}`);
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
   * Call z.ai API for shipping research
   */
  private async callZAI(
    product: ProductInfo
  ): Promise<{ success: boolean; output?: string; error?: string }> {
    if (!this.env.ZAI_API_KEY) {
      return {
        success: false,
        error: 'ZAI_API_KEY not configured',
      };
    }

    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(product);

    console.log(`[ProductShippingResearch] Calling z.ai API...`);

    try {
      const response = await fetch(ZAI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.env.ZAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: ZAI_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.2,
          max_tokens: 500,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[ProductShippingResearch] z.ai API HTTP error: ${response.status}`);
        return {
          success: false,
          error: `z.ai API error (${response.status}): ${errorText}`,
        };
      }

      const data = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: string;
            reasoning_content?: string; // z.ai may return content here
          };
        }>;
        error?: {
          message?: string;
        };
      };

      if (data.error) {
        return {
          success: false,
          error: data.error.message || 'z.ai API error',
        };
      }

      // z.ai may return content in 'content' or 'reasoning_content' field
      const message = data.choices?.[0]?.message;
      const content = message?.content || message?.reasoning_content;

      if (!content) {
        return {
          success: false,
          error: 'No content in z.ai response',
        };
      }

      return {
        success: true,
        output: content,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[ProductShippingResearch] z.ai fetch error: ${errorMsg}`);
      return {
        success: false,
        error: `z.ai request failed: ${errorMsg}`,
      };
    }
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
