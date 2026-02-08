-- DE Router Seed Data
-- Initial workers, providers, and models

-- Workers
INSERT INTO workers (id, name, media_types) VALUES
  ('text-gen', 'Text Generation', '["text"]'),
  ('image-gen', 'Image Generation', '["image"]'),
  ('video-gen', 'Video Generation', '["video"]'),
  ('audio-gen', 'Audio Generation', '["audio"]'),
  ('embedding-gen', 'Embedding Generation', '["embedding"]');

-- Providers
INSERT INTO providers (id, name, type, base_endpoint, auth_type, auth_secret_name, priority) VALUES
  ('zai', 'Z.ai', 'api', 'https://api.z.ai/api/paas', 'bearer', 'ZAI_API_KEY', 5),
  ('spark-local', 'Spark Nemotron', 'local', NULL, 'none', 'SPARK_LOCAL_URL', 10),
  ('anthropic', 'Anthropic', 'api', 'https://api.anthropic.com', 'api_key', 'ANTHROPIC_API_KEY', 50),
  ('openai', 'OpenAI', 'api', 'https://api.openai.com', 'bearer', 'OPENAI_API_KEY', 60),
  ('google', 'Google AI', 'api', 'https://generativelanguage.googleapis.com', 'api_key', 'GOOGLE_API_KEY', 70),
  ('ideogram', 'Ideogram', 'api', 'https://api.ideogram.ai', 'api_key', 'IDEOGRAM_API_KEY', 50),
  ('elevenlabs', 'ElevenLabs', 'api', 'https://api.elevenlabs.io', 'api_key', 'ELEVENLABS_API_KEY', 50),
  ('replicate', 'Replicate', 'api', 'https://api.replicate.com', 'bearer', 'REPLICATE_API_KEY', 70);

-- Models for text-gen
INSERT INTO models (id, provider_id, model_id, worker_id, capabilities, context_window, cost_input_per_1k, cost_output_per_1k, quality_tier, speed_tier, priority) VALUES
  ('zai:glm-4.7', 'zai', 'glm-4.7', 'text-gen', '["reasoning","code"]', 128000, 0, 0, 'premium', 'fast', 5),
  ('spark:nemotron-3-nano', 'spark-local', 'nemotron-3-nano', 'text-gen', '["reasoning","code"]', 1048576, 0, 0, 'standard', 'fast', 10),
  ('anthropic:claude-sonnet-4', 'anthropic', 'claude-sonnet-4-20250514', 'text-gen', '["reasoning","code","vision"]', 200000, 0.003, 0.015, 'premium', 'medium', 50),
  ('anthropic:claude-haiku', 'anthropic', 'claude-3-5-haiku-20241022', 'text-gen', '["code"]', 200000, 0.001, 0.005, 'draft', 'fast', 30),
  ('anthropic:claude-opus', 'anthropic', 'claude-opus-4-20250514', 'text-gen', '["reasoning","code","vision","analysis"]', 200000, 0.015, 0.075, 'premium', 'slow', 80),
  ('openai:gpt-4o', 'openai', 'gpt-4o', 'text-gen', '["reasoning","code","vision"]', 128000, 0.005, 0.015, 'premium', 'medium', 50),
  ('openai:gpt-4o-mini', 'openai', 'gpt-4o-mini', 'text-gen', '["code"]', 128000, 0.00015, 0.0006, 'standard', 'fast', 40),
  ('openai:o1', 'openai', 'o1', 'text-gen', '["reasoning","code","analysis"]', 128000, 0.015, 0.06, 'premium', 'slow', 90),
  ('google:gemini-2-flash', 'google', 'gemini-2.0-flash-exp', 'text-gen', '["reasoning","code","vision"]', 1000000, 0, 0, 'standard', 'fast', 35);

-- Models for image-gen
INSERT INTO models (id, provider_id, model_id, worker_id, capabilities, quality_tier, speed_tier, priority) VALUES
  ('ideogram:v2', 'ideogram', 'V_2', 'image-gen', '["photorealistic","illustration","text-rendering"]', 'premium', 'medium', 50),
  ('ideogram:v2-turbo', 'ideogram', 'V_2_TURBO', 'image-gen', '["photorealistic","illustration"]', 'standard', 'fast', 40),
  ('openai:dall-e-3', 'openai', 'dall-e-3', 'image-gen', '["photorealistic","illustration"]', 'premium', 'slow', 60),
  ('replicate:flux-schnell', 'replicate', 'black-forest-labs/flux-schnell', 'image-gen', '["photorealistic"]', 'standard', 'fast', 45),
  ('replicate:flux-dev', 'replicate', 'black-forest-labs/flux-dev', 'image-gen', '["photorealistic","artistic"]', 'premium', 'medium', 55);

-- Models for audio-gen (TTS)
INSERT INTO models (id, provider_id, model_id, worker_id, capabilities, quality_tier, speed_tier, priority) VALUES
  ('elevenlabs:turbo-v2-5', 'elevenlabs', 'eleven_turbo_v2_5', 'audio-gen', '["voice","natural","multilingual"]', 'premium', 'fast', 50),
  ('elevenlabs:multilingual-v2', 'elevenlabs', 'eleven_multilingual_v2', 'audio-gen', '["voice","natural","multilingual"]', 'premium', 'medium', 60),
  ('openai:tts-1', 'openai', 'tts-1', 'audio-gen', '["voice"]', 'standard', 'fast', 70),
  ('openai:tts-1-hd', 'openai', 'tts-1-hd', 'audio-gen', '["voice","natural"]', 'premium', 'medium', 75);

-- Models for video-gen
INSERT INTO models (id, provider_id, model_id, worker_id, capabilities, quality_tier, speed_tier, priority) VALUES
  ('replicate:minimax-video', 'replicate', 'minimax/video-01', 'video-gen', '["text-to-video"]', 'premium', 'slow', 50),
  ('replicate:luma-ray', 'replicate', 'luma/ray', 'video-gen', '["text-to-video","image-to-video"]', 'premium', 'slow', 55);

-- Models for embeddings
INSERT INTO models (id, provider_id, model_id, worker_id, capabilities, quality_tier, speed_tier, priority) VALUES
  ('openai:text-embedding-3-small', 'openai', 'text-embedding-3-small', 'embedding-gen', '["semantic-search"]', 'standard', 'fast', 50),
  ('openai:text-embedding-3-large', 'openai', 'text-embedding-3-large', 'embedding-gen', '["semantic-search","classification"]', 'premium', 'medium', 60);

-- Worker-Provider mappings
INSERT INTO worker_providers (worker_id, provider_id, priority) VALUES
  ('text-gen', 'zai', 5),
  ('text-gen', 'spark-local', 10),
  ('text-gen', 'anthropic', 50),
  ('text-gen', 'openai', 60),
  ('text-gen', 'google', 70),
  ('image-gen', 'ideogram', 50),
  ('image-gen', 'openai', 60),
  ('image-gen', 'replicate', 70),
  ('audio-gen', 'elevenlabs', 50),
  ('audio-gen', 'openai', 60),
  ('video-gen', 'replicate', 50),
  ('embedding-gen', 'openai', 50);

-- Initialize provider status
INSERT INTO provider_status (provider_id, healthy) VALUES
  ('zai', 1),
  ('spark-local', 1),
  ('anthropic', 1),
  ('openai', 1),
  ('google', 1),
  ('ideogram', 1),
  ('elevenlabs', 1),
  ('replicate', 1);
