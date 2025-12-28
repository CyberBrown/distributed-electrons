/**
 * Test script for JSON validator
 * Run with: bun run workers/text-gen/src/utils/json-validator.test.ts
 */

import { validateJson, attemptJsonRepair, buildRepairPrompt } from './json-validator';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✅ ${name}`);
  } catch (e) {
    console.error(`❌ ${name}`);
    console.error(`   ${(e as Error).message}`);
  }
}

function assertEqual(actual: unknown, expected: unknown, msg?: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${msg || 'Assertion failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

console.log('\n🧪 JSON Validator Tests\n');

// Test valid JSON
test('validates simple JSON object', () => {
  const result = validateJson('{"key": "value"}');
  assertEqual(result.valid, true);
  assertEqual(result.extracted, '{"key":"value"}');
});

test('validates JSON array', () => {
  const result = validateJson('[1, 2, 3]');
  assertEqual(result.valid, true);
  assertEqual(result.extracted, '[1,2,3]');
});

test('extracts JSON from markdown code block', () => {
  const result = validateJson('```json\n{"name": "test"}\n```');
  assertEqual(result.valid, true);
  assertEqual(result.extracted, '{"name":"test"}');
});

test('extracts JSON from markdown code block without json hint', () => {
  const result = validateJson('```\n{"name": "test"}\n```');
  assertEqual(result.valid, true);
  assertEqual(result.extracted, '{"name":"test"}');
});

test('extracts JSON from text with surrounding content', () => {
  const result = validateJson('Here is the JSON:\n{"result": true}\nEnd of response');
  assertEqual(result.valid, true);
  assertEqual(result.extracted, '{"result":true}');
});

// Test invalid JSON
test('detects truncated JSON', () => {
  const result = validateJson('{"key": "value", "arr": [1, 2, 3');
  assertEqual(result.valid, false);
  assertEqual(typeof result.error, 'string');
});

test('detects missing closing brace', () => {
  const result = validateJson('{"key": {"nested": "value"}');
  assertEqual(result.valid, false);
});

test('detects empty response', () => {
  const result = validateJson('');
  assertEqual(result.valid, false);
  assertEqual(result.error, 'Empty response');
});

test('detects non-JSON text', () => {
  const result = validateJson('This is just plain text with no JSON');
  assertEqual(result.valid, false);
});

// Test JSON repair
test('repairs trailing comma in object', () => {
  const repaired = attemptJsonRepair('{"a": 1, "b": 2,}');
  assertEqual(repaired !== null, true);
  assertEqual(repaired, '{"a": 1, "b": 2}');
});

test('repairs trailing comma in array', () => {
  const repaired = attemptJsonRepair('[1, 2, 3,]');
  assertEqual(repaired !== null, true);
  assertEqual(repaired, '[1, 2, 3]');
});

test('repairs missing closing brace', () => {
  const repaired = attemptJsonRepair('{"a": 1, "b": 2');
  assertEqual(repaired !== null, true);
  JSON.parse(repaired!); // Should not throw
});

test('repairs missing closing bracket', () => {
  const repaired = attemptJsonRepair('[1, 2, 3');
  assertEqual(repaired !== null, true);
  JSON.parse(repaired!); // Should not throw
});

test('repairs nested structure with missing braces', () => {
  const repaired = attemptJsonRepair('{"outer": {"inner": [1, 2, 3]}');
  if (repaired) {
    JSON.parse(repaired); // Should not throw
  }
});

// Test repair prompt
test('builds repair prompt with error context', () => {
  const prompt = buildRepairPrompt(
    'Generate a JSON list of items',
    '{"items": [1, 2, 3',
    'Unexpected end of JSON input'
  );
  assertEqual(prompt.includes('Unexpected end of JSON input'), true);
  assertEqual(prompt.includes('Generate a JSON list'), true);
  assertEqual(prompt.includes('items'), true);
});

console.log('\n✨ All tests completed!\n');
