/**
 * Payload Mapping Utility
 *
 * Transforms unified user inputs into provider-specific API requests
 * using template-based payload mappings from model configurations.
 */

export interface PayloadMapping {
  endpoint: string;
  method: string;
  headers: Record<string, string>;
  body: any;
  response_mapping: Record<string, string>;
  defaults?: Record<string, any>;
  transformations?: Record<string, string>;
}

export interface ProviderRequest {
  endpoint: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

/**
 * Apply payload mapping template to user inputs
 * Replaces template variables like {user_prompt}, {api_key}, etc. with actual values
 */
export function applyPayloadMapping(
  mapping: PayloadMapping,
  userInputs: Record<string, any>,
  apiKey: string
): ProviderRequest {
  // Merge user inputs with defaults (user inputs take precedence)
  const allVars = {
    ...mapping.defaults,
    ...userInputs,
    api_key: apiKey,
  };

  // Replace template variables in headers
  const headers = replaceTemplateVars(mapping.headers, allVars);

  // Replace template variables in body
  const body = replaceTemplateVars(mapping.body, allVars);

  return {
    endpoint: mapping.endpoint,
    method: mapping.method,
    headers,
    body,
  };
}

/**
 * Apply response mapping to extract fields from provider response
 * Uses JSONPath-like dot notation to extract nested values
 */
export function applyResponseMapping(
  response: any,
  mapping: Record<string, string>
): Record<string, any> {
  const result: Record<string, any> = {};

  for (const [key, path] of Object.entries(mapping)) {
    result[key] = extractByPath(response, path);
  }

  return result;
}

/**
 * Recursively replace template variables in an object/array/string
 * Supports nested objects and arrays
 */
function replaceTemplateVars(
  obj: any,
  vars: Record<string, any>
): any {
  if (typeof obj === 'string') {
    // Replace all {variable_name} occurrences
    return obj.replace(/\{(\w+)\}/g, (match, key) => {
      if (vars[key] !== undefined && vars[key] !== null) {
        return String(vars[key]);
      }
      // Variable not provided - log warning in production
      console.warn(`Template variable not provided: ${key}`);
      return match; // Keep placeholder if not provided
    });
  }

  if (Array.isArray(obj)) {
    return obj.map(item => replaceTemplateVars(item, vars));
  }

  if (typeof obj === 'object' && obj !== null) {
    const result: any = {};
    for (const [key, val] of Object.entries(obj)) {
      result[key] = replaceTemplateVars(val, vars);
    }
    return result;
  }

  return obj;
}

/**
 * Extract value from object using JSONPath-like dot notation
 * Supports:
 * - $.field - root field
 * - $.nested.field - nested field
 * - $.array[0] - array index
 * - $.data[0].url - combined
 */
function extractByPath(obj: any, path: string): any {
  // Remove leading $ if present
  if (path.startsWith('$.')) {
    path = path.substring(2);
  } else if (path === '$') {
    return obj;
  }

  // Split path by dots and brackets
  const parts = path.split(/\.|\[|\]/).filter(p => p !== '');

  let current = obj;

  for (const part of parts) {
    if (current === undefined || current === null) {
      return undefined;
    }

    // Check if part is an array index
    const arrayIndex = parseInt(part, 10);
    if (!isNaN(arrayIndex)) {
      current = current[arrayIndex];
    } else {
      current = current[part];
    }
  }

  return current;
}

/**
 * Validate payload mapping structure
 * Returns true if valid, false otherwise
 */
export function validatePayloadMapping(mapping: any): boolean {
  if (!mapping || typeof mapping !== 'object') {
    return false;
  }

  // Required fields
  if (!mapping.endpoint || typeof mapping.endpoint !== 'string') {
    return false;
  }

  if (!mapping.method || typeof mapping.method !== 'string') {
    return false;
  }

  if (!mapping.headers || typeof mapping.headers !== 'object') {
    return false;
  }

  if (!mapping.body) {
    return false;
  }

  if (!mapping.response_mapping || typeof mapping.response_mapping !== 'object') {
    return false;
  }

  return true;
}

/**
 * Extract all template variables from a payload mapping
 * Useful for validation and documentation
 */
export function extractTemplateVariables(mapping: PayloadMapping): string[] {
  const variables = new Set<string>();

  function findVariables(obj: any) {
    if (typeof obj === 'string') {
      const matches = obj.matchAll(/\{(\w+)\}/g);
      for (const match of matches) {
        variables.add(match[1]);
      }
    } else if (Array.isArray(obj)) {
      obj.forEach(findVariables);
    } else if (typeof obj === 'object' && obj !== null) {
      Object.values(obj).forEach(findVariables);
    }
  }

  findVariables(mapping.headers);
  findVariables(mapping.body);

  return Array.from(variables);
}

/**
 * Example usage and test helper
 */
export function exampleUsage() {
  const mapping: PayloadMapping = {
    endpoint: '/v1/generate',
    method: 'POST',
    headers: {
      'Authorization': 'Bearer {api_key}',
      'Content-Type': 'application/json',
    },
    body: {
      prompt: '{user_prompt}',
      aspect_ratio: '{aspect_ratio}',
      quality: 'standard',
    },
    response_mapping: {
      image_url: '$.data[0].url',
      job_id: '$.id',
    },
    defaults: {
      aspect_ratio: '1:1',
    },
  };

  const userInputs = {
    user_prompt: 'A serene mountain landscape',
    aspect_ratio: '16:9',
  };

  const apiKey = 'sk-test-key-12345';

  // Apply mapping
  const request = applyPayloadMapping(mapping, userInputs, apiKey);

  console.log('Generated Request:', JSON.stringify(request, null, 2));

  // Example provider response
  const providerResponse = {
    id: 'job_abc123',
    status: 'processing',
    data: [
      {
        url: 'https://cdn.example.com/image.png',
      },
    ],
  };

  // Apply response mapping
  const extracted = applyResponseMapping(providerResponse, mapping.response_mapping);

  console.log('Extracted Response:', JSON.stringify(extracted, null, 2));

  // Extract template variables
  const variables = extractTemplateVariables(mapping);
  console.log('Template Variables:', variables);
}
