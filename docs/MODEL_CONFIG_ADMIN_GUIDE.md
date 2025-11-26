# Model Configuration - Admin Guide

This guide explains how to manage AI model configurations using the Admin Panel.

## Overview

The Model Configuration system allows administrators to:
- Add new AI models without code changes
- Configure payload mappings for different providers
- Set pricing, rate limits, and capabilities
- Manage model lifecycle (active, beta, deprecated)

## Accessing the Models Page

1. Open the Admin Panel: `https://admin.distributedelectrons.com`
2. Log in with your API key
3. Click **Models** in the navigation bar

## Understanding Model Configurations

Each model configuration contains:

### Basic Information
- **Model ID**: Unique identifier (e.g., `ideogram-v2`, `gemini-veo-3.1`)
- **Provider ID**: Provider name (e.g., `ideogram`, `openai`, `gemini`)
- **Display Name**: User-friendly name shown in UI
- **Description**: Brief explanation of model capabilities
- **Status**: `active`, `beta`, or `deprecated`

### Capabilities
Checkboxes indicating what the model can do:
- **Image**: Generates images
- **Video**: Generates videos
- **Text**: Generates text
- **Audio**: Generates audio
- **Inpainting**: Supports inpainting/editing
- **Upscaling**: Supports image upscaling

### Pricing
Cost information for billing/display:
- **Cost Per Image**: Cost for image generation (USD)
- **Cost Per Video**: Cost for video generation (USD)
- **Cost Per 1K Tokens**: Cost for text generation (USD)
- **Currency**: Usually "USD"
- **Notes**: Additional pricing details

### Rate Limits
Provider-imposed limits:
- **RPM**: Requests per minute
- **TPM**: Tokens per minute
- **Concurrent Requests**: Max simultaneous requests

### Payload Mapping
How user inputs map to provider API format (see detailed section below)

## Adding a New Model

### Step 1: Click "Add Model Config"

Click the blue "Add Model Config" button in the top-right corner.

### Step 2: Fill Basic Information

```
Model ID: gemini-imagen-3
Provider ID: gemini
Display Name: Gemini Imagen 3
Description: Google's latest image generation model with photorealistic outputs
Status: active
```

**Naming Conventions:**
- Model ID: lowercase, hyphenated (e.g., `provider-model-version`)
- Provider ID: lowercase, no spaces (e.g., `openai`, `anthropic`)

### Step 3: Set Capabilities

Check the boxes for what the model supports:
- ☑ Image
- ☐ Video
- ☐ Text
- ☐ Audio
- ☐ Inpainting
- ☐ Upscaling

### Step 4: Configure Pricing

```
Cost Per Image: 0.04
Currency: USD
Notes: Standard quality. HD quality costs $0.08 per image
```

### Step 5: Set Rate Limits

```
RPM: 100
TPM: 50000
Concurrent Requests: 10
```

**Note:** These should match your provider's API limits.

### Step 6: Configure Payload Mapping

This is the most important part. See "Payload Mapping Guide" below.

### Step 7: Save

Click "Add Model" to save the configuration.

## Payload Mapping Guide

Payload mapping defines how unified user inputs transform into provider-specific API requests.

### Structure

```json
{
  "endpoint": "/v1/generate",
  "method": "POST",
  "headers": {
    "Authorization": "Bearer {api_key}",
    "Content-Type": "application/json"
  },
  "body": {
    "prompt": "{user_prompt}",
    "aspect_ratio": "{aspect_ratio}",
    "model": "ideogram-v2"
  },
  "response_mapping": {
    "image_url": "$.data[0].url",
    "job_id": "$.id"
  },
  "defaults": {
    "aspect_ratio": "1:1"
  }
}
```

### Template Variables

Variables in curly braces `{variable_name}` get replaced with actual values:

**Available Variables:**
- `{api_key}` - Provider API key from instance config
- `{user_prompt}` - User's text prompt
- `{aspect_ratio}` - Image aspect ratio (e.g., "16:9", "1:1")
- `{style}` - Style preset (e.g., "realistic", "anime")
- `{quality}` - Quality setting (e.g., "standard", "hd")
- `{num_images}` - Number of images to generate
- Any custom option passed by user

### Response Mapping

Uses JSONPath-like syntax to extract values from provider responses:

```json
{
  "image_url": "$.data[0].url",
  "job_id": "$.id",
  "status": "$.status"
}
```

**Syntax:**
- `$.field` - Top-level field
- `$.nested.field` - Nested field
- `$.array[0]` - Array element
- `$.data[0].url` - Combined

### Defaults

Default values used when user doesn't provide them:

```json
{
  "aspect_ratio": "1:1",
  "quality": "standard",
  "num_images": 1
}
```

### Example: Ideogram V2

```json
{
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
      "aspect_ratio": "{aspect_ratio}",
      "magic_prompt_option": "AUTO"
    }
  },
  "response_mapping": {
    "job_id": "$.data.id",
    "status": "$.data.status",
    "image_url": "$.data.url"
  },
  "defaults": {
    "aspect_ratio": "1:1"
  }
}
```

### Example: OpenAI DALL-E 3

```json
{
  "endpoint": "/v1/images/generations",
  "method": "POST",
  "headers": {
    "Authorization": "Bearer {api_key}",
    "Content-Type": "application/json"
  },
  "body": {
    "model": "dall-e-3",
    "prompt": "{user_prompt}",
    "size": "{size}",
    "quality": "{quality}",
    "n": 1,
    "response_format": "url"
  },
  "response_mapping": {
    "image_url": "$.data[0].url",
    "revised_prompt": "$.data[0].revised_prompt"
  },
  "defaults": {
    "size": "1024x1024",
    "quality": "standard"
  }
}
```

### Example: Gemini Veo 3.1 (Video)

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
        "role": "user",
        "parts": [
          {
            "text": "{user_prompt}"
          }
        ]
      }
    ],
    "generationConfig": {
      "aspectRatio": "{aspect_ratio}",
      "responseModality": "video",
      "videoLength": "{video_length}",
      "personGeneration": "allow"
    }
  },
  "response_mapping": {
    "job_id": "$.name",
    "status": "$.status",
    "video_url": "$.candidates[0].content.parts[0].videoUrl"
  },
  "defaults": {
    "aspect_ratio": "16:9",
    "video_length": "8s"
  }
}
```

## Editing Existing Models

1. Navigate to **Models** page
2. Find the model you want to edit
3. Click **Expand** to view full details
4. Click **Edit** button
5. Modify fields as needed
6. Click **Save Changes**

## Deleting Models

1. Navigate to **Models** page
2. Find the model you want to delete
3. Click **Expand** to view full details
4. Click **Delete** button
5. Confirm deletion

**Warning:** Deleting a model that's currently in use will cause errors for users trying to use it.

## Model Lifecycle Management

### Active
- Model is fully functional
- Shown to all users
- Recommended for production use

### Beta
- Model is being tested
- May have limitations or bugs
- Shown with "(Beta)" label
- Use for early access features

### Deprecated
- Model is being phased out
- Not shown to new users
- Existing users can still use it
- Plan migration to newer model

## Best Practices

### 1. Test Before Setting to Active

1. Create model with `status: beta`
2. Test in Testing GUI with various prompts
3. Verify payload mapping works correctly
4. Check response mapping extracts correct fields
5. Once stable, change to `status: active`

### 2. Use Descriptive Names

```
Good: "Gemini Veo 3.1"
Bad: "gv3"

Good: "OpenAI DALL-E 3 HD"
Bad: "dalle3hd"
```

### 3. Document Payload Requirements

Include provider-specific requirements in description:
```
Description: "Gemini Imagen 3 - Requires aspect_ratio in format '16:9'. Supports styles: realistic, artistic, anime."
```

### 4. Keep Rate Limits Accurate

Update rate limits when your provider plan changes:
- Free tier: Lower limits
- Pro tier: Higher limits
- Enterprise: Custom limits

### 5. Version Model IDs Clearly

```
Good:
- ideogram-v2
- ideogram-v2-turbo
- gemini-veo-3.1
- gemini-veo-2.5

Bad:
- ideogram
- ideogram2
- veo
```

### 6. Test Response Mapping

Provider response structures can change. Periodically verify:
```bash
# Test actual API response structure
curl -X POST https://api.provider.com/generate \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"prompt": "test"}' | jq
```

Then update `response_mapping` if fields moved.

## Troubleshooting

### Model Not Appearing in Testing GUI

**Check:**
1. Status is `active` or `beta` (not `deprecated`)
2. Config Service is running
3. Browser console for fetch errors
4. Model ID doesn't have typos

### Payload Mapping Errors

**Common Issues:**
1. **Missing variables**: Check all `{variables}` are provided or have defaults
2. **Wrong structure**: Compare to provider's API docs
3. **Invalid JSON**: Use JSON validator on payload mapping

**Debug:**
```javascript
// Check what variables are in mapping
import { extractTemplateVariables } from './payload-mapper';
const vars = extractTemplateVariables(mapping);
console.log('Required variables:', vars);
```

### Response Mapping Extraction Fails

**Common Issues:**
1. **Wrong JSONPath**: Provider changed response structure
2. **Array index out of bounds**: Check array has elements
3. **Field renamed**: Provider updated API

**Debug:**
```javascript
// Test extraction
import { applyResponseMapping } from './payload-mapper';
const extracted = applyResponseMapping(providerResponse, mapping.response_mapping);
console.log('Extracted:', extracted);
```

### Rate Limit Errors

**Solutions:**
1. Verify RPM/TPM match your provider plan
2. Check instance-level rate limits in Admin Panel > Instances
3. Consider implementing exponential backoff

## API Reference

For programmatic access to model configs:

```bash
# List all models
GET https://config-service.distributedelectrons.com/model-config

# Get specific model
GET https://config-service.distributedelectrons.com/model-config/ideogram-v2

# Filter by provider
GET https://config-service.distributedelectrons.com/model-config?provider_id=openai

# Filter by status
GET https://config-service.distributedelectrons.com/model-config?status=active

# Create model
POST https://config-service.distributedelectrons.com/model-config
Content-Type: application/json

{
  "model_id": "new-model",
  "provider_id": "openai",
  ...
}

# Update model
PUT https://config-service.distributedelectrons.com/model-config/cfg_abc123
Content-Type: application/json

{
  "display_name": "Updated Name",
  ...
}

# Delete model
DELETE https://config-service.distributedelectrons.com/model-config/cfg_abc123
```

## See Also

- [Payload Mapping Specification](./PAYLOAD_MAPPING_SPEC.md) - Detailed syntax
- [Model Configuration Schema](./MODEL_CONFIG_SCHEMA.md) - Database schema
- [User Guide](./MODEL_CONFIG_USER_GUIDE.md) - How users select models
