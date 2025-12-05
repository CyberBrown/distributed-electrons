# Model Configuration Management Guide

## Overview

The Dynamic Model Configuration System allows administrators to add, modify, and manage AI model configurations without code changes. This guide covers all aspects of model management through the Admin Panel.

## Table of Contents

1. [Accessing the Admin Panel](#accessing-the-admin-panel)
2. [Understanding Model Configurations](#understanding-model-configurations)
3. [Adding a New Model](#adding-a-new-model)
4. [Editing Existing Models](#editing-existing-models)
5. [Model Configuration Reference](#model-configuration-reference)
6. [Payload Mapping Templates](#payload-mapping-templates)
7. [Testing Model Configurations](#testing-model-configurations)
8. [Troubleshooting](#troubleshooting)

---

## Accessing the Admin Panel

### URL
Navigate to: **https://admin.distributedelectrons.com**

### Authentication
1. Enter your API key in the login form
2. The API key must have admin privileges in the Config Service

### Navigation
- Click **Models** in the top navigation bar to access model management

---

## Understanding Model Configurations

Each model configuration consists of:

### Core Properties
- **Model ID**: Unique identifier (e.g., `gpt-4o`, `ideogram-v2`)
- **Provider ID**: Provider system (e.g., `openai`, `anthropic`, `ideogram`)
- **Display Name**: Human-readable name shown in UI
- **Description**: Brief description of model capabilities
- **Status**: `active`, `beta`, or `deprecated`

### Capabilities
Boolean flags indicating what the model can do:
- **Image**: Can generate images
- **Video**: Can generate videos
- **Text**: Can generate text
- **Audio**: Can generate audio
- **Inpainting**: Supports image inpainting
- **Upscaling**: Supports image upscaling

### Pricing
Cost structure for the model:
- **Cost per Image/Video/Tokens**: Unit pricing
- **Currency**: Usually `USD`
- **Notes**: Additional pricing information

### Rate Limits
Provider-imposed limits:
- **RPM**: Requests per minute
- **TPM**: Tokens per minute
- **Concurrent Requests**: Maximum simultaneous requests

### Payload Mapping
Template defining how to transform requests and responses (see detailed section below)

---

## Adding a New Model

### Step 1: Click "Add Model Config"

In the Models page, click the **+ Add Model Config** button at the top right.

### Step 2: Fill in Basic Information

#### Example: Adding GPT-4 Turbo

```
Model ID: gpt-4-turbo
Provider ID: openai
Display Name: GPT-4 Turbo
Description: OpenAI's fast and powerful GPT-4 model optimized for speed
Status: active
```

### Step 3: Configure Capabilities

Select applicable capabilities:
- ☑ Text
- ☐ Image
- ☐ Video
- ☐ Audio

### Step 4: Set Pricing

```json
{
  "cost_per_1k_tokens": 0.01,
  "currency": "USD",
  "notes": "Combined input/output pricing"
}
```

### Step 5: Configure Rate Limits

```json
{
  "rpm": 500,
  "tpm": 150000,
  "concurrent_requests": 100
}
```

### Step 6: Define Payload Mapping

See [Payload Mapping Templates](#payload-mapping-templates) section below.

### Step 7: Save

Click **Save Model Config** to create the configuration.

---

## Editing Existing Models

### To Edit a Model:

1. Navigate to the **Models** page
2. Find the model in the provider-grouped list
3. Click **Expand** to view full details
4. Click **Edit** button
5. Make your changes in the modal
6. Click **Save Changes**

### Common Edits:

#### Update Pricing
When provider changes their pricing:
```json
{
  "cost_per_1k_tokens": 0.008,  // Updated from 0.01
  "currency": "USD"
}
```

#### Adjust Rate Limits
If you need to throttle usage:
```json
{
  "rpm": 100,  // Reduced from 500
  "tpm": 50000
}
```

#### Change Status
Deprecate an old model:
- Change status from `active` to `deprecated`

---

## Model Configuration Reference

### Model ID Format

**Rules:**
- Use lowercase with hyphens
- Include version numbers when applicable
- Format: `provider-model-version`

**Examples:**
- ✅ `gpt-4o-mini`
- ✅ `claude-sonnet-4-20250514`
- ✅ `ideogram-v2`
- ❌ `GPT4oMini` (wrong case)
- ❌ `gpt_4o_mini` (use hyphens, not underscores)

### Provider ID Values

Standard provider identifiers:
- `openai` - OpenAI models
- `anthropic` - Anthropic Claude models
- `ideogram` - Ideogram image models
- `elevenlabs` - ElevenLabs audio models
- `gemini` - Google Gemini models
- `stability` - Stability AI models

### Status Values

- **active**: Model is production-ready and available
- **beta**: Model is in testing, may have issues
- **deprecated**: Model is being phased out

---

## Payload Mapping Templates

Payload mappings define how user inputs are transformed into provider-specific API requests and how responses are standardized.

### Template Syntax

Use `{variable_name}` for template variables:
- `{api_key}` - API key for authentication
- `{user_prompt}` - User's input prompt
- `{max_tokens}` - Token limit
- `{temperature}` - Sampling temperature
- Custom variables from request options

### Text Generation Example (OpenAI)

```json
{
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
    "temperature": "{temperature}"
  },
  "response_mapping": {
    "text": "$.choices[0].message.content",
    "model": "$.model",
    "tokens_used": "$.usage.total_tokens"
  },
  "defaults": {
    "max_tokens": 1000,
    "temperature": 0.7
  }
}
```

### Image Generation Example (DALL-E 3)

```json
{
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
    "quality": "{quality}"
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

### Audio Generation Example (ElevenLabs)

```json
{
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
      "similarity_boost": "{similarity_boost}"
    }
  },
  "response_mapping": {
    "audio_data": "$",
    "content_type": "audio/mpeg"
  },
  "defaults": {
    "voice_id": "21m00Tcm4TlvDq8ikWAM",
    "stability": 0.5,
    "similarity_boost": 0.75
  }
}
```

### Response Mapping (JSONPath)

Extract fields from provider responses using JSONPath syntax:

| JSONPath | Description | Example |
|----------|-------------|---------|
| `$.field` | Top-level field | `$.model` |
| `$.nested.field` | Nested field | `$.usage.total_tokens` |
| `$.array[0]` | Array element | `$.choices[0]` |
| `$.array[0].field` | Field in array | `$.choices[0].message.content` |
| `$` | Entire response | For binary data |

### Common Response Mappings

**Text Generation:**
```json
{
  "text": "$.choices[0].message.content",
  "model": "$.model",
  "tokens_used": "$.usage.total_tokens",
  "finish_reason": "$.choices[0].finish_reason"
}
```

**Image Generation:**
```json
{
  "image_url": "$.data[0].url",
  "job_id": "$.id",
  "status": "$.status"
}
```

### Defaults Section

Provide fallback values for optional parameters:

```json
{
  "defaults": {
    "max_tokens": 1000,
    "temperature": 0.7,
    "top_p": 1.0,
    "aspect_ratio": "1:1"
  }
}
```

---

## Testing Model Configurations

### Step 1: Save the Configuration

Ensure the model config is saved in the Admin Panel.

### Step 2: Test via Testing GUI

#### For Text Models:
1. Navigate to **https://text-testing.distributedelectrons.com**
2. Select your instance
3. Choose your newly added model from dropdown
4. Enter a test prompt
5. Click **Generate Text**

#### For Image Models:
1. Navigate to **https://testing.distributedelectrons.com**
2. Select your instance
3. Choose your newly added model from dropdown
4. Enter a test prompt
5. Click **Generate Image**

### Step 3: Verify Response

Check that:
- ✅ Request completes successfully
- ✅ Response is formatted correctly
- ✅ Metadata is populated (provider, model, tokens/time)
- ✅ Pricing calculations are accurate

### Step 4: Test Edge Cases

Test with:
- Very long prompts
- Special characters in prompts
- Maximum token limits
- Different parameter combinations

---

## Troubleshooting

### Issue: Model Not Appearing in Dropdown

**Possible Causes:**
1. Model config not saved properly
2. Model status is `deprecated`
3. Cache not cleared in testing GUI

**Solutions:**
1. Verify model exists in Admin Panel
2. Check that status is `active`
3. Hard refresh the testing GUI (Ctrl+Shift+R)
4. Check browser console for errors

### Issue: "Invalid Payload Mapping" Error

**Possible Causes:**
1. Malformed JSON in payload mapping
2. Missing required fields
3. Invalid JSONPath in response mapping

**Solutions:**
1. Validate JSON syntax using online validator
2. Ensure all required fields present:
   - `endpoint`
   - `method`
   - `headers`
   - `body`
   - `response_mapping`
3. Test JSONPath expressions against actual API responses

### Issue: "API Key Not Configured"

**Possible Causes:**
1. Provider not configured in instance settings
2. Wrong provider_id in model config

**Solutions:**
1. Verify instance has API key for the provider
2. Check provider_id matches exactly (case-sensitive)
3. Update instance configuration to include provider

### Issue: Model Works But Returns Wrong Data

**Possible Causes:**
1. Incorrect response mapping
2. Provider API changed response format

**Solutions:**
1. Review actual API response from provider
2. Update response_mapping to match current format
3. Test response mapping with sample data

### Issue: Rate Limit Errors

**Possible Causes:**
1. Rate limits set too high
2. Multiple users hitting same limits

**Solutions:**
1. Reduce RPM/TPM in model config
2. Implement per-user rate limiting
3. Contact provider to increase limits

---

## Best Practices

### 1. Model Naming

- Use consistent naming conventions
- Include version numbers
- Match provider's official model names

### 2. Testing

- Always test new configurations before production
- Use small prompts for initial tests
- Verify pricing calculations are accurate

### 3. Documentation

- Add detailed descriptions for each model
- Include pricing notes for transparency
- Document any special requirements

### 4. Versioning

- Create new model configs for major version changes
- Deprecate old versions gracefully
- Communicate changes to users

### 5. Security

- Never expose API keys in config
- Use template variables for sensitive data
- Restrict admin access appropriately

---

## Advanced Topics

### Multi-Step Workflows

Some providers require multiple API calls (submit job → poll status). Handle this by:

1. Creating separate configs for each step
2. Using response_mapping to extract job IDs
3. Implementing polling logic in workers

### Custom Providers

To add a completely new provider:

1. Choose a unique provider_id
2. Add API base URL to worker code
3. Create model configs with proper payload mappings
4. Test thoroughly

### Cost Optimization

Track usage and optimize costs by:

1. Setting accurate pricing in configs
2. Monitoring token usage via metadata
3. Using cheaper models for simple tasks
4. Implementing usage quotas

---

## API Reference

### Get All Model Configs

```bash
curl https://api.distributedelectrons.com/model-config
```

### Get Model by ID

```bash
curl https://api.distributedelectrons.com/model-config/gpt-4o
```

### Filter by Type

```bash
# Text models only
curl https://api.distributedelectrons.com/model-config?type=text

# Image models only
curl https://api.distributedelectrons.com/model-config?type=image
```

### Create Model Config

```bash
curl -X POST https://api.distributedelectrons.com/model-config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model_id": "new-model",
    "provider_id": "openai",
    "display_name": "New Model",
    "capabilities": {"text": true},
    "pricing": {"cost_per_1k_tokens": 0.01},
    "rate_limits": {"rpm": 100},
    "payload_mapping": { ... }
  }'
```

### Update Model Config

```bash
curl -X PUT https://api.distributedelectrons.com/model-config/gpt-4o \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "pricing": {"cost_per_1k_tokens": 0.008}
  }'
```

### Delete Model Config

```bash
curl -X DELETE https://api.distributedelectrons.com/model-config/old-model \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

## Related Documentation

- [Payload Mapping Specification](../PAYLOAD_MAPPING_SPEC.md)
- [Model Configuration Schema](../MODEL_CONFIG_SCHEMA.md)
- [API Documentation](../api/README.md)
- [Deployment Guide](../DEPLOYMENT_GUIDE.md)

---

## Support

For issues or questions:
1. Check the [Troubleshooting](#troubleshooting) section
2. Review existing model configs for examples
3. Consult the API documentation
4. Contact the development team

---

**Last Updated**: December 5, 2025
**Version**: 1.0
