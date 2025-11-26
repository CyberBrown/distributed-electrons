# Model Configuration API Documentation

API reference for managing AI model configurations programmatically.

## Base URL

```
https://config-service.distributedelectrons.com
```

## Authentication

Currently, model configuration endpoints don't require authentication. In production, you should implement API key or OAuth authentication.

## Endpoints

### List Model Configurations

Get all model configurations, optionally filtered by provider or status.

```http
GET /model-config
```

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| provider_id | string | No | Filter by provider (e.g., `openai`, `ideogram`) |
| status | string | No | Filter by status (`active`, `beta`, `deprecated`) |

**Example Requests:**

```bash
# Get all model configs
curl https://config-service.distributedelectrons.com/model-config

# Get only OpenAI models
curl https://config-service.distributedelectrons.com/model-config?provider_id=openai

# Get only active models
curl https://config-service.distributedelectrons.com/model-config?status=active

# Get active OpenAI models
curl https://config-service.distributedelectrons.com/model-config?provider_id=openai&status=active
```

**Success Response:**

```json
{
  "data": {
    "configs": [
      {
        "config_id": "cfg_ideogram_v2",
        "model_id": "ideogram-v2",
        "provider_id": "ideogram",
        "display_name": "Ideogram V2",
        "description": "High-quality image generation with excellent text rendering",
        "capabilities": {
          "image": true,
          "video": false,
          "text": false,
          "inpainting": false
        },
        "pricing": {
          "cost_per_image": 0.08,
          "currency": "USD"
        },
        "rate_limits": {
          "rpm": 100,
          "tpm": 50000
        },
        "payload_mapping": {
          "endpoint": "/generate",
          "method": "POST",
          "headers": {
            "Api-Key": "{api_key}",
            "Content-Type": "application/json"
          },
          "body": {
            "image_request": {
              "model": "V_2",
              "prompt": "{user_prompt}",
              "aspect_ratio": "{aspect_ratio}"
            }
          },
          "response_mapping": {
            "job_id": "$.data.id",
            "image_url": "$.data.url"
          },
          "defaults": {
            "aspect_ratio": "1:1"
          }
        },
        "status": "active",
        "created_at": "2025-01-16T10:00:00Z",
        "updated_at": "2025-01-16T10:00:00Z"
      }
    ],
    "total": 1
  }
}
```

**Error Response:**

```json
{
  "error": "Invalid status value",
  "details": {
    "allowed_values": ["active", "beta", "deprecated"]
  }
}
```

---

### Get Model Configuration

Get a specific model configuration by config ID or model ID.

```http
GET /model-config/{id}
```

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| id | string | Yes | Config ID (e.g., `cfg_ideogram_v2`) or Model ID (e.g., `ideogram-v2`) |

**Example Requests:**

```bash
# By config ID
curl https://config-service.distributedelectrons.com/model-config/cfg_ideogram_v2

# By model ID
curl https://config-service.distributedelectrons.com/model-config/ideogram-v2
```

**Success Response:**

```json
{
  "data": {
    "config_id": "cfg_ideogram_v2",
    "model_id": "ideogram-v2",
    "provider_id": "ideogram",
    "display_name": "Ideogram V2",
    "description": "High-quality image generation with excellent text rendering",
    "capabilities": {
      "image": true,
      "video": false,
      "text": false
    },
    "pricing": {
      "cost_per_image": 0.08,
      "currency": "USD"
    },
    "rate_limits": {
      "rpm": 100,
      "tpm": 50000
    },
    "payload_mapping": {
      "endpoint": "/generate",
      "method": "POST",
      "headers": {
        "Api-Key": "{api_key}",
        "Content-Type": "application/json"
      },
      "body": {
        "image_request": {
          "model": "V_2",
          "prompt": "{user_prompt}",
          "aspect_ratio": "{aspect_ratio}"
        }
      },
      "response_mapping": {
        "job_id": "$.data.id",
        "image_url": "$.data.url"
      },
      "defaults": {
        "aspect_ratio": "1:1"
      }
    },
    "status": "active",
    "created_at": "2025-01-16T10:00:00Z",
    "updated_at": "2025-01-16T10:00:00Z"
  }
}
```

**Error Response:**

```json
{
  "error": "Model configuration not found",
  "config_id": "cfg_nonexistent"
}
```

---

### Create Model Configuration

Create a new model configuration.

```http
POST /model-config
```

**Request Headers:**

```
Content-Type: application/json
```

**Request Body:**

```json
{
  "model_id": "gemini-imagen-3",
  "provider_id": "gemini",
  "display_name": "Gemini Imagen 3",
  "description": "Google's latest image generation model",
  "capabilities": {
    "image": true,
    "video": false,
    "text": false
  },
  "pricing": {
    "cost_per_image": 0.04,
    "currency": "USD"
  },
  "rate_limits": {
    "rpm": 100,
    "tpm": 50000
  },
  "payload_mapping": {
    "endpoint": "/v1/generate",
    "method": "POST",
    "headers": {
      "Authorization": "Bearer {api_key}",
      "Content-Type": "application/json"
    },
    "body": {
      "prompt": "{user_prompt}",
      "aspect_ratio": "{aspect_ratio}"
    },
    "response_mapping": {
      "image_url": "$.data[0].url",
      "job_id": "$.id"
    },
    "defaults": {
      "aspect_ratio": "1:1"
    }
  },
  "status": "beta"
}
```

**Required Fields:**
- `model_id` (string) - Unique model identifier
- `provider_id` (string) - Provider identifier
- `display_name` (string) - User-friendly name
- `capabilities` (object) - Capability flags
- `payload_mapping` (object) - Request/response mapping
- `status` (string) - One of: `active`, `beta`, `deprecated`

**Optional Fields:**
- `description` (string) - Model description
- `pricing` (object) - Pricing information
- `rate_limits` (object) - Rate limit configuration

**Example Request:**

```bash
curl -X POST https://config-service.distributedelectrons.com/model-config \
  -H "Content-Type: application/json" \
  -d '{
    "model_id": "gemini-imagen-3",
    "provider_id": "gemini",
    "display_name": "Gemini Imagen 3",
    "capabilities": {"image": true},
    "payload_mapping": {...},
    "status": "beta"
  }'
```

**Success Response:**

```json
{
  "data": {
    "config_id": "cfg_abc123def456",
    "model_id": "gemini-imagen-3",
    "provider_id": "gemini",
    "display_name": "Gemini Imagen 3",
    ...
  }
}
```

**Error Responses:**

```json
// Validation error
{
  "error": "Validation failed",
  "details": {
    "model_id": "Model ID must be lowercase with hyphens"
  }
}

// Duplicate model_id
{
  "error": "Model configuration already exists",
  "model_id": "gemini-imagen-3"
}

// Invalid payload mapping
{
  "error": "Invalid payload mapping structure",
  "details": {
    "missing_fields": ["endpoint", "method"]
  }
}
```

---

### Update Model Configuration

Update an existing model configuration.

```http
PUT /model-config/{id}
```

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| id | string | Yes | Config ID (e.g., `cfg_abc123`) |

**Request Headers:**

```
Content-Type: application/json
```

**Request Body:**

Only include fields you want to update:

```json
{
  "display_name": "Gemini Imagen 3 (Updated)",
  "status": "active",
  "pricing": {
    "cost_per_image": 0.05,
    "currency": "USD"
  }
}
```

**Example Request:**

```bash
curl -X PUT https://config-service.distributedelectrons.com/model-config/cfg_abc123 \
  -H "Content-Type: application/json" \
  -d '{
    "display_name": "Gemini Imagen 3 (Updated)",
    "status": "active"
  }'
```

**Success Response:**

```json
{
  "data": {
    "config_id": "cfg_abc123",
    "model_id": "gemini-imagen-3",
    "display_name": "Gemini Imagen 3 (Updated)",
    "status": "active",
    ...
  }
}
```

**Error Responses:**

```json
// Config not found
{
  "error": "Model configuration not found",
  "config_id": "cfg_nonexistent"
}

// Validation error
{
  "error": "Validation failed",
  "details": {
    "status": "Invalid status value"
  }
}
```

---

### Delete Model Configuration

Delete a model configuration.

```http
DELETE /model-config/{id}
```

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| id | string | Yes | Config ID (e.g., `cfg_abc123`) |

**Example Request:**

```bash
curl -X DELETE https://config-service.distributedelectrons.com/model-config/cfg_abc123
```

**Success Response:**

```json
{
  "message": "Model configuration deleted successfully",
  "config_id": "cfg_abc123"
}
```

**Error Response:**

```json
{
  "error": "Model configuration not found",
  "config_id": "cfg_nonexistent"
}
```

---

## Data Types

### ModelConfig Object

```typescript
interface ModelConfig {
  config_id: string;           // Auto-generated (cfg_xxxxx)
  model_id: string;            // Unique model identifier
  provider_id: string;         // Provider identifier
  display_name: string;        // User-friendly name
  description?: string;        // Optional description
  capabilities: Capabilities;  // What the model can do
  pricing?: Pricing;          // Optional pricing info
  rate_limits?: RateLimits;   // Optional rate limits
  payload_mapping: PayloadMapping;  // Request/response mapping
  status: 'active' | 'beta' | 'deprecated';
  created_at: string;         // ISO 8601 timestamp
  updated_at: string;         // ISO 8601 timestamp
}
```

### Capabilities Object

```typescript
interface Capabilities {
  image?: boolean;      // Can generate images
  video?: boolean;      // Can generate videos
  text?: boolean;       // Can generate text
  audio?: boolean;      // Can generate audio
  inpainting?: boolean; // Supports inpainting
  upscaling?: boolean;  // Supports upscaling
}
```

### Pricing Object

```typescript
interface Pricing {
  cost_per_image?: number;     // Cost per image (USD)
  cost_per_video?: number;     // Cost per video (USD)
  cost_per_1k_tokens?: number; // Cost per 1K tokens (USD)
  currency: string;            // Currency code (e.g., "USD")
  notes?: string;              // Additional pricing notes
}
```

### RateLimits Object

```typescript
interface RateLimits {
  rpm?: number;              // Requests per minute
  tpm?: number;              // Tokens per minute
  concurrent_requests?: number;  // Max concurrent requests
}
```

### PayloadMapping Object

```typescript
interface PayloadMapping {
  endpoint: string;                      // API endpoint path
  method: string;                        // HTTP method (POST, GET, etc.)
  headers: Record<string, string>;       // Request headers with {variables}
  body: any;                             // Request body with {variables}
  response_mapping: Record<string, string>;  // JSONPath extraction
  defaults?: Record<string, any>;        // Default values for variables
  transformations?: Record<string, string>;  // Optional transformations
}
```

---

## Template Variables

Template variables in payload mapping use `{variable_name}` syntax:

**Standard Variables:**
- `{api_key}` - Provider API key
- `{user_prompt}` - User's text prompt
- `{aspect_ratio}` - Aspect ratio (e.g., "16:9")
- `{style}` - Style preset
- `{quality}` - Quality setting
- `{num_images}` - Number of images

**Custom Variables:**
Any additional fields passed in the request options.

**Example:**

```json
{
  "headers": {
    "Authorization": "Bearer {api_key}"
  },
  "body": {
    "prompt": "{user_prompt}",
    "size": "{aspect_ratio}"
  }
}
```

---

## Response Mapping Syntax

Response mapping uses JSONPath-like dot notation:

**Syntax:**
- `$.field` - Top-level field
- `$.nested.field` - Nested field
- `$.array[0]` - Array element by index
- `$.data[0].url` - Combined

**Example:**

Provider response:
```json
{
  "id": "job_123",
  "status": "completed",
  "data": [
    {
      "url": "https://cdn.example.com/image.png",
      "width": 1024,
      "height": 1024
    }
  ]
}
```

Response mapping:
```json
{
  "job_id": "$.id",
  "status": "$.status",
  "image_url": "$.data[0].url",
  "width": "$.data[0].width",
  "height": "$.data[0].height"
}
```

Extracted result:
```json
{
  "job_id": "job_123",
  "status": "completed",
  "image_url": "https://cdn.example.com/image.png",
  "width": 1024,
  "height": 1024
}
```

---

## Validation Rules

### model_id
- Must be lowercase
- Can contain letters, numbers, hyphens, dots
- Pattern: `^[a-z0-9][a-z0-9\-\.]*$`
- Must be unique

### status
- Must be one of: `active`, `beta`, `deprecated`

### payload_mapping
Required fields:
- `endpoint` (string)
- `method` (string)
- `headers` (object)
- `body` (any)
- `response_mapping` (object)

---

## Rate Limiting

Config Service API currently has no rate limits. In production, implement:
- 100 requests per minute per IP
- 1000 requests per hour per IP

---

## Error Codes

| Status Code | Description |
|-------------|-------------|
| 200 | Success |
| 201 | Created successfully |
| 400 | Bad request (validation failed) |
| 404 | Resource not found |
| 409 | Conflict (duplicate model_id) |
| 500 | Internal server error |

---

## CORS

All endpoints support CORS with the following headers:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

---

## Examples

### JavaScript/TypeScript

```typescript
// List all active models
const response = await fetch(
  'https://config-service.distributedelectrons.com/model-config?status=active'
);
const { data } = await response.json();
console.log(`Found ${data.total} active models`);

// Get specific model
const modelResponse = await fetch(
  'https://config-service.distributedelectrons.com/model-config/ideogram-v2'
);
const { data: model } = await modelResponse.json();
console.log(`Model: ${model.display_name}`);

// Create new model
const newModel = {
  model_id: 'test-model',
  provider_id: 'openai',
  display_name: 'Test Model',
  capabilities: { image: true },
  payload_mapping: { /* ... */ },
  status: 'beta'
};

const createResponse = await fetch(
  'https://config-service.distributedelectrons.com/model-config',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(newModel)
  }
);
const { data: created } = await createResponse.json();
console.log(`Created: ${created.config_id}`);
```

### Python

```python
import requests

# List all models
response = requests.get(
    'https://config-service.distributedelectrons.com/model-config'
)
data = response.json()
print(f"Found {data['data']['total']} models")

# Get specific model
model_response = requests.get(
    'https://config-service.distributedelectrons.com/model-config/ideogram-v2'
)
model = model_response.json()['data']
print(f"Model: {model['display_name']}")

# Create new model
new_model = {
    'model_id': 'test-model',
    'provider_id': 'openai',
    'display_name': 'Test Model',
    'capabilities': {'image': True},
    'payload_mapping': { },
    'status': 'beta'
}

create_response = requests.post(
    'https://config-service.distributedelectrons.com/model-config',
    json=new_model
)
created = create_response.json()['data']
print(f"Created: {created['config_id']}")
```

### cURL

```bash
# List all models
curl https://config-service.distributedelectrons.com/model-config

# Get specific model
curl https://config-service.distributedelectrons.com/model-config/ideogram-v2

# Create model
curl -X POST https://config-service.distributedelectrons.com/model-config \
  -H "Content-Type: application/json" \
  -d @new-model.json

# Update model
curl -X PUT https://config-service.distributedelectrons.com/model-config/cfg_abc123 \
  -H "Content-Type: application/json" \
  -d '{"status": "active"}'

# Delete model
curl -X DELETE https://config-service.distributedelectrons.com/model-config/cfg_abc123
```

---

## See Also

- [Admin Guide](./MODEL_CONFIG_ADMIN_GUIDE.md) - Managing models via admin panel
- [User Guide](./MODEL_CONFIG_USER_GUIDE.md) - Using models in testing GUI
- [Payload Mapping Spec](./PAYLOAD_MAPPING_SPEC.md) - Detailed mapping syntax
- [Model Config Schema](./MODEL_CONFIG_SCHEMA.md) - Database schema
