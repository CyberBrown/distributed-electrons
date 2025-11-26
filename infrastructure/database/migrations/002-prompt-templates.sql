-- Migration: Add prompt_template column to model_configs
-- Version: 1.1
-- Created: 2025-11-24
-- Description: Adds prompt template support for model-specific text generation configuration

-- Add prompt_template column to model_configs table
-- This allows per-model configuration of:
--   - system_prompt: Default system prompt for the model
--   - user_prompt_wrapper: Template to wrap user prompts (e.g., "{user_prompt}\n\nRespond concisely.")
--   - default_temperature: Model-specific default temperature
--   - default_max_tokens: Model-specific default max tokens
--   - stop_sequences: Default stop sequences for the model

ALTER TABLE model_configs ADD COLUMN prompt_template JSON;

-- Update existing text models with sensible defaults
UPDATE model_configs
SET prompt_template = json_object(
  'system_prompt', 'You are a helpful AI assistant.',
  'default_temperature', 0.7,
  'default_max_tokens', 1000
)
WHERE capabilities LIKE '%"text":true%' OR capabilities LIKE '%"text": true%';

-- Example: Update Claude models with specific system prompt
UPDATE model_configs
SET prompt_template = json_object(
  'system_prompt', 'You are Claude, an AI assistant made by Anthropic. You are helpful, harmless, and honest.',
  'default_temperature', 0.7,
  'default_max_tokens', 4096
)
WHERE provider_id = 'anthropic' AND (capabilities LIKE '%"text":true%' OR capabilities LIKE '%"text": true%');
