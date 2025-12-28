/**
 * JSON Validation Utilities
 * Validates and repairs JSON output from LLM responses
 */

export interface ValidationResult {
  valid: boolean;
  error?: string;
  errorPosition?: number;
  extracted?: string; // cleaned/extracted JSON
}

/**
 * Try to extract and validate JSON from LLM response
 * Handles markdown code blocks and raw JSON
 */
export function validateJson(response: string): ValidationResult {
  if (!response || response.trim() === '') {
    return {
      valid: false,
      error: 'Empty response',
    };
  }

  // Try to extract JSON from markdown code blocks first
  const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  let jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : response.trim();

  // Also try to find JSON array or object boundaries if no code block
  if (!codeBlockMatch) {
    // Find first { or [ and last } or ]
    const firstBrace = jsonStr.indexOf('{');
    const firstBracket = jsonStr.indexOf('[');
    let startIdx = -1;

    if (firstBrace === -1 && firstBracket === -1) {
      return {
        valid: false,
        error: 'No JSON structure found (no { or [ detected)',
      };
    }

    if (firstBrace === -1) {
      startIdx = firstBracket;
    } else if (firstBracket === -1) {
      startIdx = firstBrace;
    } else {
      startIdx = Math.min(firstBrace, firstBracket);
    }

    const isArray = jsonStr[startIdx] === '[';
    const closingChar = isArray ? ']' : '}';
    const lastClose = jsonStr.lastIndexOf(closingChar);

    if (lastClose > startIdx) {
      jsonStr = jsonStr.slice(startIdx, lastClose + 1);
    }
  }

  try {
    const parsed = JSON.parse(jsonStr);
    // Re-stringify to get clean JSON
    return {
      valid: true,
      extracted: JSON.stringify(parsed),
    };
  } catch (e) {
    const error = e as SyntaxError;
    // Extract position from error message
    const posMatch = error.message.match(/position (\d+)/i);

    return {
      valid: false,
      error: error.message,
      errorPosition: posMatch ? parseInt(posMatch[1]) : undefined,
    };
  }
}

/**
 * Build a repair prompt for the LLM to fix invalid JSON
 */
export function buildRepairPrompt(
  originalPrompt: string,
  invalidResponse: string,
  error: string
): string {
  // Truncate the invalid response to avoid massive prompts
  const truncatedResponse =
    invalidResponse.length > 1000
      ? invalidResponse.slice(0, 1000) + '\n... [truncated]'
      : invalidResponse;

  return `Your previous response contained invalid JSON that could not be parsed.

JSON Parse Error: ${error}

Original request:
${originalPrompt.slice(0, 500)}${originalPrompt.length > 500 ? '...' : ''}

Your invalid response (truncated):
${truncatedResponse}

Please provide a VALID JSON response. Common issues to fix:
1. Ensure all brackets and braces are properly closed
2. Remove any trailing commas before closing brackets
3. Ensure all strings are properly quoted
4. Don't include any text before or after the JSON
5. Don't use single quotes - use double quotes

Respond ONLY with valid JSON, no markdown code blocks or explanations.`;
}

/**
 * Attempt to repair common JSON issues
 * Returns repaired JSON or null if repair failed
 */
export function attemptJsonRepair(jsonStr: string): string | null {
  let repaired = jsonStr.trim();

  // Remove markdown code blocks if present
  const codeBlockMatch = repaired.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    repaired = codeBlockMatch[1].trim();
  }

  // Find JSON boundaries
  const firstBrace = repaired.indexOf('{');
  const firstBracket = repaired.indexOf('[');
  let startIdx = -1;

  if (firstBrace === -1 && firstBracket === -1) {
    return null;
  }

  if (firstBrace === -1) {
    startIdx = firstBracket;
  } else if (firstBracket === -1) {
    startIdx = firstBrace;
  } else {
    startIdx = Math.min(firstBrace, firstBracket);
  }

  repaired = repaired.slice(startIdx);

  // Common repairs
  // 1. Remove trailing commas before closing brackets
  repaired = repaired.replace(/,(\s*[}\]])/g, '$1');

  // 2. Try to balance brackets by adding missing closing brackets
  const openBraces = (repaired.match(/{/g) || []).length;
  const closeBraces = (repaired.match(/}/g) || []).length;
  const openBrackets = (repaired.match(/\[/g) || []).length;
  const closeBrackets = (repaired.match(/]/g) || []).length;

  // Add missing closing braces
  for (let i = 0; i < openBraces - closeBraces; i++) {
    repaired += '}';
  }

  // Add missing closing brackets
  for (let i = 0; i < openBrackets - closeBrackets; i++) {
    repaired += ']';
  }

  // Try parsing the repaired JSON
  try {
    JSON.parse(repaired);
    return repaired;
  } catch {
    return null;
  }
}
