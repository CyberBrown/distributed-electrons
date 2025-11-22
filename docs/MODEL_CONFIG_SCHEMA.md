# Model Configuration Database Schema

## Overview

This document defines the database schema for the Model Configuration system, including table structures, indexes, constraints, and data types.

## Tables

### `model_configs`

Stores configuration for each AI model variant, including metadata and payload mapping templates.

#### Schema

```sql
CREATE TABLE model_configs (
    config_id TEXT PRIMARY KEY,
    model_id TEXT NOT NULL UNIQUE,
    provider_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT,
    capabilities JSON NOT NULL,
    pricing JSON,
    rate_limits JSON,
    payload_mapping JSON NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('active', 'beta', 'deprecated')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

#### Indexes

```sql
CREATE INDEX idx_model_configs_model_id ON model_configs(model_id);
CREATE INDEX idx_model_configs_provider_id ON model_configs(provider_id);
CREATE INDEX idx_model_configs_status ON model_configs(status);
CREATE INDEX idx_model_configs_created_at ON model_configs(created_at DESC);
```

#### Field Definitions

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `config_id` | TEXT | PRIMARY KEY | Unique identifier for the config (e.g., `cfg_gemini_veo_31`) |
| `model_id` | TEXT | NOT NULL, UNIQUE | Model identifier used in API requests (e.g., `gemini-veo-3.1`) |
| `provider_id` | TEXT | NOT NULL | Provider identifier (e.g., `gemini`, `openai`, `ideogram`) |
| `display_name` | TEXT | NOT NULL | Human-readable name shown in UI (e.g., `Gemini Veo 3.1`) |
| `description` | TEXT | NULLABLE | Detailed description of the model and its capabilities |
| `capabilities` | JSON | NOT NULL | Object defining what the model can do (see Capabilities Schema) |
| `pricing` | JSON | NULLABLE | Pricing information (see Pricing Schema) |
| `rate_limits` | JSON | NULLABLE | Rate limit configuration (see Rate Limits Schema) |
| `payload_mapping` | JSON | NOT NULL | Template for transforming inputs to provider format (see Payload Mapping Schema) |
| `status` | TEXT | NOT NULL, CHECK | Model availability status: `active`, `beta`, or `deprecated` |
| `created_at` | TIMESTAMP | NOT NULL, DEFAULT NOW | When the config was created |
| `updated_at` | TIMESTAMP | NOT NULL, DEFAULT NOW | When the config was last updated |

## JSON Schema Definitions

### Capabilities Schema

Defines what types of content the model can generate or process.

```typescript
interface Capabilities {
  image?: boolean;           // Can generate images
  video?: boolean;           // Can generate videos
  text?: boolean;            // Can generate text
  audio?: boolean;           // Can generate audio
  inpainting?: boolean;      // Supports inpainting
  outpainting?: boolean;     // Supports outpainting
  upscaling?: boolean;       // Supports image upscaling
  style_transfer?: boolean;  // Supports style transfer
  image_to_video?: boolean;  // Can convert images to video
  text_to_speech?: boolean;  // Can convert text to speech
  [key: string]: boolean;    // Allow custom capabilities
}
```

**Example**:
```json
{
  "image": false,
  "video": true,
  "text": false,
  "audio": false,
  "image_to_video": true
}
```

### Pricing Schema

Defines cost information for using the model.

```typescript
interface Pricing {
  cost_per_image?: number;       // Cost per single image
  cost_per_video?: number;       // Cost per video
  cost_per_1k_tokens?: number;   // Cost per 1000 tokens (for text models)
  cost_per_minute?: number;      // Cost per minute (for audio/video)
  cost_per_request?: number;     // Flat cost per API request
  currency?: string;             // Currency code (USD, EUR, etc.)
  billing_unit?: string;         // Unit of billing (image, token, second, etc.)
  free_tier?: {                  // Free tier information
    requests_per_month?: number;
    tokens_per_month?: number;
  };
  notes?: string;                // Additional pricing notes
}
```

**Example**:
```json
{
  "cost_per_video": 0.50,
  "currency": "USD",
  "billing_unit": "video",
  "free_tier": {
    "requests_per_month": 100
  },
  "notes": "Pricing varies by video length and resolution"
}
```

### Rate Limits Schema

Defines usage limits for the model.

```typescript
interface RateLimits {
  rpm?: number;              // Requests per minute
  rph?: number;              // Requests per hour
  rpd?: number;              // Requests per day
  tpm?: number;              // Tokens per minute
  tph?: number;              // Tokens per hour
  concurrent_requests?: number; // Max concurrent requests
  burst_limit?: number;      // Burst capacity
  notes?: string;            // Additional rate limit notes
}
```

**Example**:
```json
{
  "rpm": 60,
  "tpm": 30000,
  "concurrent_requests": 5,
  "notes": "Rate limits apply per API key"
}
```

### Payload Mapping Schema

Defines how to transform user inputs into provider-specific API requests.

```typescript
interface PayloadMapping {
  endpoint: string;                      // API endpoint path
  method: string;                        // HTTP method (GET, POST, etc.)
  headers: Record<string, string>;       // HTTP headers (supports templates)
  body: any;                             // Request body structure (supports templates)
  response_mapping: Record<string, string>; // JSONPath expressions for response extraction
  defaults?: Record<string, any>;        // Default values for template variables
  transformations?: Record<string, string>; // Custom transformation functions
}
```

**Example**:
```json
{
  "endpoint": "/v1/models/gemini-veo-3.1:generateContent",
  "method": "POST",
  "headers": {
    "Authorization": "Bearer {api_key}",
    "Content-Type": "application/json"
  },
  "body": {
    "contents": [
      {
        "parts": [
          {
            "text": "{user_prompt}"
          }
        ]
      }
    ],
    "generationConfig": {
      "aspectRatio": "{aspect_ratio}",
      "responseModality": "video"
    }
  },
  "response_mapping": {
    "job_id": "$.name",
    "video_url": "$.candidates[0].content.parts[0].videoUrl"
  },
  "defaults": {
    "aspect_ratio": "16:9"
  }
}
```

## TypeScript Type Definitions

```typescript
// Main model config interface
export interface ModelConfig {
  config_id: string;
  model_id: string;
  provider_id: string;
  display_name: string;
  description?: string;
  capabilities: Capabilities;
  pricing?: Pricing;
  rate_limits?: RateLimits;
  payload_mapping: PayloadMapping;
  status: 'active' | 'beta' | 'deprecated';
  created_at: string; // ISO 8601 timestamp
  updated_at: string; // ISO 8601 timestamp
}

// Capabilities
export interface Capabilities {
  image?: boolean;
  video?: boolean;
  text?: boolean;
  audio?: boolean;
  inpainting?: boolean;
  outpainting?: boolean;
  upscaling?: boolean;
  style_transfer?: boolean;
  image_to_video?: boolean;
  text_to_speech?: boolean;
  [key: string]: boolean | undefined;
}

// Pricing
export interface Pricing {
  cost_per_image?: number;
  cost_per_video?: number;
  cost_per_1k_tokens?: number;
  cost_per_minute?: number;
  cost_per_request?: number;
  currency?: string;
  billing_unit?: string;
  free_tier?: {
    requests_per_month?: number;
    tokens_per_month?: number;
  };
  notes?: string;
}

// Rate Limits
export interface RateLimits {
  rpm?: number;
  rph?: number;
  rpd?: number;
  tpm?: number;
  tph?: number;
  concurrent_requests?: number;
  burst_limit?: number;
  notes?: string;
}

// Payload Mapping
export interface PayloadMapping {
  endpoint: string;
  method: string;
  headers: Record<string, string>;
  body: any;
  response_mapping: Record<string, string>;
  defaults?: Record<string, any>;
  transformations?: Record<string, string>;
}

// Request/Response types
export interface CreateModelConfigRequest {
  model_id: string;
  provider_id: string;
  display_name: string;
  description?: string;
  capabilities: Capabilities;
  pricing?: Pricing;
  rate_limits?: RateLimits;
  payload_mapping: PayloadMapping;
  status: 'active' | 'beta' | 'deprecated';
}

export interface UpdateModelConfigRequest {
  display_name?: string;
  description?: string;
  capabilities?: Capabilities;
  pricing?: Pricing;
  rate_limits?: RateLimits;
  payload_mapping?: PayloadMapping;
  status?: 'active' | 'beta' | 'deprecated';
}

export interface ListModelConfigsResponse {
  configs: ModelConfig[];
  total: number;
}

export interface GetModelConfigResponse {
  config: ModelConfig;
}
```

## Example Records

### Example 1: Ideogram V2

```sql
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
  status
) VALUES (
  'cfg_ideogram_v2',
  'ideogram-v2',
  'ideogram',
  'Ideogram V2',
  'High-quality image generation with excellent text rendering capabilities',
  '{"image": true, "video": false, "text": false, "inpainting": false}',
  '{"cost_per_image": 0.08, "currency": "USD", "billing_unit": "image"}',
  '{"rpm": 100, "tpm": 50000, "concurrent_requests": 10}',
  '{"endpoint": "/generate", "method": "POST", "headers": {"Api-Key": "{api_key}", "Content-Type": "application/json"}, "body": {"image_request": {"model": "V_2", "prompt": "{user_prompt}", "aspect_ratio": "{aspect_ratio}", "magic_prompt_option": "AUTO"}}, "response_mapping": {"job_id": "$.data.id", "status": "$.data.status", "image_url": "$.data.url"}, "defaults": {"aspect_ratio": "1:1"}}',
  'active'
);
```

### Example 2: Gemini Veo 3.1

```sql
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
  status
) VALUES (
  'cfg_gemini_veo_31',
  'gemini-veo-3.1',
  'gemini',
  'Gemini Veo 3.1',
  'Advanced video generation model with support for various aspect ratios and video lengths',
  '{"image": false, "video": true, "text": false, "image_to_video": true}',
  '{"cost_per_video": 0.50, "currency": "USD", "billing_unit": "video", "notes": "Pricing varies by video length"}',
  '{"rpm": 60, "tpm": 30000, "concurrent_requests": 5}',
  '{"endpoint": "/v1/models/gemini-veo-3.1:generateContent", "method": "POST", "headers": {"Authorization": "Bearer {api_key}", "Content-Type": "application/json"}, "body": {"contents": [{"role": "user", "parts": [{"text": "{user_prompt}"}]}], "generationConfig": {"aspectRatio": "{aspect_ratio}", "responseModality": "video", "videoLength": "{video_length}"}}, "response_mapping": {"job_id": "$.name", "status": "$.status", "video_url": "$.candidates[0].content.parts[0].videoUrl"}, "defaults": {"aspect_ratio": "16:9", "video_length": "8s"}}',
  'active'
);
```

### Example 3: OpenAI DALL-E 3

```sql
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
  status
) VALUES (
  'cfg_dalle3',
  'dall-e-3',
  'openai',
  'DALL-E 3',
  'OpenAI premier text-to-image generation model with enhanced prompt adherence',
  '{"image": true, "video": false, "text": false}',
  '{"cost_per_image": 0.04, "currency": "USD", "billing_unit": "image"}',
  '{"rpm": 50, "tpm": 25000}',
  '{"endpoint": "/v1/images/generations", "method": "POST", "headers": {"Authorization": "Bearer {api_key}", "Content-Type": "application/json"}, "body": {"model": "dall-e-3", "prompt": "{user_prompt}", "size": "{size}", "quality": "{quality}", "n": 1}, "response_mapping": {"image_url": "$.data[0].url", "revised_prompt": "$.data[0].revised_prompt"}, "defaults": {"size": "1024x1024", "quality": "standard"}}',
  'active'
);
```

## Database Constraints

### Primary Key Constraint
- `config_id` must be unique across all records
- Format: `cfg_{provider}_{model}` (e.g., `cfg_gemini_veo_31`)

### Unique Constraints
- `model_id` must be unique (users reference models by this ID)

### Check Constraints
- `status` must be one of: `'active'`, `'beta'`, `'deprecated'`

### Foreign Key Considerations
- No direct foreign key to providers table (providers defined in code)
- Could add FK if providers table is created in future

## Triggers

### Update Timestamp Trigger

Automatically update `updated_at` when record is modified:

```sql
CREATE TRIGGER update_model_configs_timestamp
BEFORE UPDATE ON model_configs
FOR EACH ROW
BEGIN
  UPDATE model_configs
  SET updated_at = CURRENT_TIMESTAMP
  WHERE config_id = NEW.config_id;
END;
```

Note: Syntax varies by database (SQLite, PostgreSQL, MySQL)

## Indexes Rationale

1. **idx_model_configs_model_id**: Fast lookup by model_id (most common query)
2. **idx_model_configs_provider_id**: Filter configs by provider
3. **idx_model_configs_status**: Filter by active/beta/deprecated
4. **idx_model_configs_created_at**: Sort by creation date (DESC for newest first)

## Query Examples

### Get all active models for a provider

```sql
SELECT *
FROM model_configs
WHERE provider_id = 'gemini'
  AND status = 'active'
ORDER BY display_name;
```

### Get model config by ID

```sql
SELECT *
FROM model_configs
WHERE model_id = 'gemini-veo-3.1';
```

### List all video-capable models

```sql
SELECT *
FROM model_configs
WHERE JSON_EXTRACT(capabilities, '$.video') = true
  AND status = 'active';
```

### Get models with pricing under $0.10

```sql
SELECT *
FROM model_configs
WHERE JSON_EXTRACT(pricing, '$.cost_per_image') < 0.10
   OR JSON_EXTRACT(pricing, '$.cost_per_video') < 0.10;
```

## Migration Scripts

### Initial Schema Creation

```sql
-- Create model_configs table
CREATE TABLE model_configs (
    config_id TEXT PRIMARY KEY,
    model_id TEXT NOT NULL UNIQUE,
    provider_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT,
    capabilities JSON NOT NULL,
    pricing JSON,
    rate_limits JSON,
    payload_mapping JSON NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('active', 'beta', 'deprecated')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Create indexes
CREATE INDEX idx_model_configs_model_id ON model_configs(model_id);
CREATE INDEX idx_model_configs_provider_id ON model_configs(provider_id);
CREATE INDEX idx_model_configs_status ON model_configs(status);
CREATE INDEX idx_model_configs_created_at ON model_configs(created_at DESC);
```

### Seed Data Script

See `infrastructure/database/seed-model-configs.sql` for complete seed data.

## Data Validation Rules

### Application-Level Validation

1. **config_id**:
   - Format: `cfg_[provider]_[model_slug]`
   - Must be unique
   - Max length: 100 characters

2. **model_id**:
   - Format: lowercase alphanumeric with hyphens
   - Must be unique
   - Max length: 100 characters
   - Pattern: `/^[a-z0-9-]+$/`

3. **provider_id**:
   - Must match existing provider in system
   - Valid values: `ideogram`, `openai`, `anthropic`, `gemini`, etc.

4. **display_name**:
   - Required, non-empty
   - Max length: 200 characters

5. **capabilities**:
   - Must be valid JSON object
   - At least one capability must be `true`

6. **payload_mapping**:
   - Must be valid JSON object
   - Must contain: `endpoint`, `method`, `headers`, `body`, `response_mapping`
   - Template variables must use format: `{variable_name}`

7. **status**:
   - Must be one of: `active`, `beta`, `deprecated`

## Backup and Recovery

### Backup Strategy
- Full backup before schema changes
- Regular backups of model configs (daily recommended)
- Export as JSON for version control

### Export Example

```bash
# Export all model configs to JSON
sqlite3 db.sqlite "SELECT json_group_array(json_object(
  'config_id', config_id,
  'model_id', model_id,
  'provider_id', provider_id,
  'display_name', display_name,
  'description', description,
  'capabilities', json(capabilities),
  'pricing', json(pricing),
  'rate_limits', json(rate_limits),
  'payload_mapping', json(payload_mapping),
  'status', status
)) FROM model_configs" > model_configs_backup.json
```

## Performance Considerations

1. **JSON Field Queries**: Use JSON_EXTRACT with care; consider denormalizing frequently queried JSON fields
2. **Index Usage**: Ensure queries use indexes (check with EXPLAIN QUERY PLAN)
3. **Cache Model Configs**: Cache in application layer (Redis, memory) for frequently accessed configs
4. **Payload Mapping Size**: Keep payload mappings under 10KB for optimal performance

## Future Schema Enhancements

1. **Model Versions Table**: Track version history of model configs
2. **Provider Table**: Normalize provider information
3. **Usage Statistics Table**: Track model usage metrics
4. **Model Tags Table**: Add tagging system for categorization
5. **Model Dependencies Table**: Track model relationships (e.g., upscaler depends on base model)

## See Also

- [Model Configuration Plan](./MODEL_CONFIGURATION_PLAN.md)
- [Payload Mapping Specification](./PAYLOAD_MAPPING_SPEC.md)
- [Database Schema](../infrastructure/database/schema.sql)
- [Config Service Types](../infrastructure/config-service/types.ts)
