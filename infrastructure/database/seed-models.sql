-- ============================================================================
-- MODEL CONFIGURATIONS SEED DATA
-- Description: Seed initial model configurations for multi-provider AI system
-- Date: 2025-12-05
-- Version: 1.0
-- ============================================================================
--
-- This file seeds the model_configs table with production-ready configurations
-- for image generation, text generation, and audio generation models across
-- multiple providers (Ideogram, OpenAI, Anthropic, ElevenLabs).
--
-- Each model configuration includes:
-- - model_id: Unique identifier for the model variant
-- - provider_id: Provider system (ideogram, openai, anthropic, elevenlabs)
-- - display_name: Human-readable model name
-- - capabilities: Supported operations (image, text, audio, etc.)
-- - pricing: Cost structure per operation
-- - rate_limits: Provider-imposed rate limits
-- - payload_mapping: Template for API request/response transformation
-- ============================================================================

-- ============================================================================
-- IMAGE GENERATION MODELS
-- ============================================================================

-- Ideogram V2 - High-quality image generation
INSERT INTO model_configs (
    config_id,
    model_id,
    provider_id,
    display_name,
    description,
    capabilities,
    pricing,
    rate_limits,
    payload_mapping,
    status,
    created_at,
    updated_at
) VALUES (
    'cfg_ideogram_v2_' || substr(lower(hex(randomblob(8))), 1, 16),
    'ideogram-v2',
    'ideogram',
    'Ideogram V2',
    'High-quality AI image generation with excellent text rendering capabilities',
    json('{"image": true, "video": false, "text": false, "audio": false}'),
    json('{
        "cost_per_image": 0.08,
        "currency": "USD",
        "notes": "Standard quality images"
    }'),
    json('{
        "rpm": 100,
        "tpm": 50000,
        "concurrent_requests": 10
    }'),
    json('{
        "endpoint": "https://api.ideogram.ai/generate",
        "method": "POST",
        "headers": {
            "Content-Type": "application/json",
            "Api-Key": "{api_key}"
        },
        "body": {
            "image_request": {
                "prompt": "{user_prompt}",
                "model": "V_2",
                "aspect_ratio": "{aspect_ratio}",
                "style_type": "{style}"
            }
        },
        "response_mapping": {
            "image_url": "$.data[0].url",
            "resolution": "$.data[0].resolution"
        },
        "defaults": {
            "aspect_ratio": "1:1",
            "style": "AUTO"
        }
    }'),
    'active',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

-- DALL-E 3 - OpenAI's latest image generation model
INSERT INTO model_configs (
    config_id,
    model_id,
    provider_id,
    display_name,
    description,
    capabilities,
    pricing,
    rate_limits,
    payload_mapping,
    status,
    created_at,
    updated_at
) VALUES (
    'cfg_dalle3_' || substr(lower(hex(randomblob(8))), 1, 16),
    'dall-e-3',
    'openai',
    'DALL-E 3',
    'OpenAI''s most capable image generation model with improved prompt understanding',
    json('{"image": true, "video": false, "text": false, "audio": false}'),
    json('{
        "cost_per_image": 0.04,
        "currency": "USD",
        "notes": "Standard 1024x1024 images"
    }'),
    json('{
        "rpm": 50,
        "tpm": 10000
    }'),
    json('{
        "endpoint": "https://api.openai.com/v1/images/generations",
        "method": "POST",
        "headers": {
            "Content-Type": "application/json",
            "Authorization": "Bearer {api_key}"
        },
        "body": {
            "model": "dall-e-3",
            "prompt": "{user_prompt}",
            "n": 1,
            "size": "{size}",
            "quality": "{quality}",
            "style": "{style}"
        },
        "response_mapping": {
            "image_url": "$.data[0].url",
            "revised_prompt": "$.data[0].revised_prompt"
        },
        "defaults": {
            "size": "1024x1024",
            "quality": "standard",
            "style": "vivid"
        }
    }'),
    'active',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

-- ============================================================================
-- TEXT GENERATION MODELS
-- ============================================================================

-- GPT-4o - OpenAI's flagship multimodal model
INSERT INTO model_configs (
    config_id,
    model_id,
    provider_id,
    display_name,
    description,
    capabilities,
    pricing,
    rate_limits,
    payload_mapping,
    status,
    created_at,
    updated_at
) VALUES (
    'cfg_gpt4o_' || substr(lower(hex(randomblob(8))), 1, 16),
    'gpt-4o',
    'openai',
    'GPT-4o',
    'OpenAI''s most advanced multimodal model with vision and text capabilities',
    json('{"image": false, "video": false, "text": true, "audio": false}'),
    json('{
        "cost_per_1k_tokens": 0.005,
        "currency": "USD",
        "notes": "Combined input/output pricing"
    }'),
    json('{
        "rpm": 500,
        "tpm": 150000,
        "concurrent_requests": 100
    }'),
    json('{
        "endpoint": "https://api.openai.com/v1/chat/completions",
        "method": "POST",
        "headers": {
            "Content-Type": "application/json",
            "Authorization": "Bearer {api_key}"
        },
        "body": {
            "model": "gpt-4o",
            "messages": [
                {
                    "role": "user",
                    "content": "{user_prompt}"
                }
            ],
            "max_tokens": "{max_tokens}",
            "temperature": "{temperature}",
            "top_p": "{top_p}"
        },
        "response_mapping": {
            "text": "$.choices[0].message.content",
            "model": "$.model",
            "tokens_used": "$.usage.total_tokens",
            "finish_reason": "$.choices[0].finish_reason"
        },
        "defaults": {
            "max_tokens": 1000,
            "temperature": 0.7,
            "top_p": 1.0
        }
    }'),
    'active',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

-- GPT-4o-mini - Efficient and cost-effective model
INSERT INTO model_configs (
    config_id,
    model_id,
    provider_id,
    display_name,
    description,
    capabilities,
    pricing,
    rate_limits,
    payload_mapping,
    status,
    created_at,
    updated_at
) VALUES (
    'cfg_gpt4o_mini_' || substr(lower(hex(randomblob(8))), 1, 16),
    'gpt-4o-mini',
    'openai',
    'GPT-4o Mini',
    'Fast and cost-effective model for most text generation tasks',
    json('{"image": false, "video": false, "text": true, "audio": false}'),
    json('{
        "cost_per_1k_tokens": 0.00015,
        "currency": "USD",
        "notes": "Highly cost-effective for high-volume workloads"
    }'),
    json('{
        "rpm": 500,
        "tpm": 200000,
        "concurrent_requests": 100
    }'),
    json('{
        "endpoint": "https://api.openai.com/v1/chat/completions",
        "method": "POST",
        "headers": {
            "Content-Type": "application/json",
            "Authorization": "Bearer {api_key}"
        },
        "body": {
            "model": "gpt-4o-mini",
            "messages": [
                {
                    "role": "user",
                    "content": "{user_prompt}"
                }
            ],
            "max_tokens": "{max_tokens}",
            "temperature": "{temperature}",
            "top_p": "{top_p}"
        },
        "response_mapping": {
            "text": "$.choices[0].message.content",
            "model": "$.model",
            "tokens_used": "$.usage.total_tokens",
            "finish_reason": "$.choices[0].finish_reason"
        },
        "defaults": {
            "max_tokens": 1000,
            "temperature": 0.7,
            "top_p": 1.0
        }
    }'),
    'active',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

-- Claude 3.5 Sonnet - Anthropic's flagship model
INSERT INTO model_configs (
    config_id,
    model_id,
    provider_id,
    display_name,
    description,
    capabilities,
    pricing,
    rate_limits,
    payload_mapping,
    status,
    created_at,
    updated_at
) VALUES (
    'cfg_claude_sonnet_' || substr(lower(hex(randomblob(8))), 1, 16),
    'claude-sonnet-4-20250514',
    'anthropic',
    'Claude 3.5 Sonnet',
    'Anthropic''s most intelligent model with superior reasoning and analysis',
    json('{"image": false, "video": false, "text": true, "audio": false}'),
    json('{
        "cost_per_1k_tokens": 0.003,
        "currency": "USD",
        "notes": "Balanced performance and cost"
    }'),
    json('{
        "rpm": 50,
        "tpm": 50000,
        "concurrent_requests": 10
    }'),
    json('{
        "endpoint": "https://api.anthropic.com/v1/messages",
        "method": "POST",
        "headers": {
            "Content-Type": "application/json",
            "x-api-key": "{api_key}",
            "anthropic-version": "2023-06-01"
        },
        "body": {
            "model": "claude-sonnet-4-20250514",
            "messages": [
                {
                    "role": "user",
                    "content": "{user_prompt}"
                }
            ],
            "max_tokens": "{max_tokens}",
            "temperature": "{temperature}"
        },
        "response_mapping": {
            "text": "$.content[0].text",
            "model": "$.model",
            "tokens_used": "$.usage.input_tokens",
            "output_tokens": "$.usage.output_tokens",
            "stop_reason": "$.stop_reason"
        },
        "defaults": {
            "max_tokens": 1000,
            "temperature": 0.7
        }
    }'),
    'active',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

-- Claude 3.5 Haiku - Fast and efficient model
INSERT INTO model_configs (
    config_id,
    model_id,
    provider_id,
    display_name,
    description,
    capabilities,
    pricing,
    rate_limits,
    payload_mapping,
    status,
    created_at,
    updated_at
) VALUES (
    'cfg_claude_haiku_' || substr(lower(hex(randomblob(8))), 1, 16),
    'claude-3-5-haiku-20241022',
    'anthropic',
    'Claude 3.5 Haiku',
    'Fastest and most compact Claude model for high-throughput tasks',
    json('{"image": false, "video": false, "text": true, "audio": false}'),
    json('{
        "cost_per_1k_tokens": 0.0008,
        "currency": "USD",
        "notes": "Optimized for speed and cost"
    }'),
    json('{
        "rpm": 50,
        "tpm": 100000,
        "concurrent_requests": 10
    }'),
    json('{
        "endpoint": "https://api.anthropic.com/v1/messages",
        "method": "POST",
        "headers": {
            "Content-Type": "application/json",
            "x-api-key": "{api_key}",
            "anthropic-version": "2023-06-01"
        },
        "body": {
            "model": "claude-3-5-haiku-20241022",
            "messages": [
                {
                    "role": "user",
                    "content": "{user_prompt}"
                }
            ],
            "max_tokens": "{max_tokens}",
            "temperature": "{temperature}"
        },
        "response_mapping": {
            "text": "$.content[0].text",
            "model": "$.model",
            "tokens_used": "$.usage.input_tokens",
            "output_tokens": "$.usage.output_tokens",
            "stop_reason": "$.stop_reason"
        },
        "defaults": {
            "max_tokens": 1000,
            "temperature": 0.7
        }
    }'),
    'active',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

-- ============================================================================
-- AUDIO GENERATION MODELS
-- ============================================================================

-- ElevenLabs Multilingual V2 - High-quality text-to-speech
INSERT INTO model_configs (
    config_id,
    model_id,
    provider_id,
    display_name,
    description,
    capabilities,
    pricing,
    rate_limits,
    payload_mapping,
    status,
    created_at,
    updated_at
) VALUES (
    'cfg_elevenlabs_v2_' || substr(lower(hex(randomblob(8))), 1, 16),
    'eleven_multilingual_v2',
    'elevenlabs',
    'ElevenLabs Multilingual V2',
    'High-quality multilingual text-to-speech with natural-sounding voices',
    json('{"image": false, "video": false, "text": false, "audio": true}'),
    json('{
        "cost_per_1k_characters": 0.30,
        "currency": "USD",
        "notes": "Pricing based on character count"
    }'),
    json('{
        "rpm": 100,
        "concurrent_requests": 10
    }'),
    json('{
        "endpoint": "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
        "method": "POST",
        "headers": {
            "Content-Type": "application/json",
            "xi-api-key": "{api_key}"
        },
        "body": {
            "text": "{user_text}",
            "model_id": "eleven_multilingual_v2",
            "voice_settings": {
                "stability": "{stability}",
                "similarity_boost": "{similarity_boost}",
                "style": "{style}",
                "use_speaker_boost": "{use_speaker_boost}"
            }
        },
        "response_mapping": {
            "audio_data": "$",
            "content_type": "audio/mpeg"
        },
        "defaults": {
            "voice_id": "21m00Tcm4TlvDq8ikWAM",
            "stability": 0.5,
            "similarity_boost": 0.75,
            "style": 0,
            "use_speaker_boost": true
        }
    }'),
    'active',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

-- ============================================================================
-- SEED DATA SUMMARY
-- ============================================================================
-- Total Model Configurations: 7
--
-- Image Generation (2):
--   - Ideogram V2 (ideogram-v2)
--   - DALL-E 3 (dall-e-3)
--
-- Text Generation (4):
--   - GPT-4o (gpt-4o)
--   - GPT-4o Mini (gpt-4o-mini)
--   - Claude 3.5 Sonnet (claude-sonnet-4-20250514)
--   - Claude 3.5 Haiku (claude-3-5-haiku-20241022)
--
-- Audio Generation (1):
--   - ElevenLabs Multilingual V2 (eleven_multilingual_v2)
--
-- All models are set to 'active' status and include:
--   - Complete payload mappings with endpoint, headers, body templates
--   - Response mappings for extracting results
--   - Default values for optional parameters
--   - Provider-specific pricing information
--   - Rate limit specifications
-- ============================================================================
