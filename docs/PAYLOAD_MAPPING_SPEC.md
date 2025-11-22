# Payload Mapping Specification

## Overview

The Payload Mapping system provides a flexible, template-based approach to transform unified user inputs into provider-specific API requests. This enables a consistent user experience across different AI providers that have varying API formats.

## Core Concepts

### 1. Template Variables

Template variables are placeholders in the payload mapping that get replaced with actual values at runtime.

**Syntax**: `{variable_name}`

**Standard Variables**:
- `{api_key}` - Provider API key from instance config
- `{user_prompt}` - User's text prompt
- `{aspect_ratio}` - Image/video aspect ratio (e.g., "16:9", "1:1")
- `{style}` - Style preference (e.g., "realistic", "artistic")
- `{quality}` - Quality setting (e.g., "standard", "hd")
- `{num_images}` - Number of images to generate
- `{seed}` - Random seed for reproducibility
- `{negative_prompt}` - Negative prompt for what to avoid

**Custom Variables**:
- Model configs can define custom variables specific to their needs
- Variables not provided default to empty string or can have default values

### 2. Payload Mapping Structure

A complete payload mapping consists of:

```typescript
interface PayloadMapping {
  endpoint: string;              // API endpoint path
  method: string;                // HTTP method (GET, POST, PUT, etc.)
  headers: Record<string, string>; // HTTP headers with template support
  body: any;                     // Request body structure with template support
  response_mapping: Record<string, string>; // JSONPath for extracting response fields
  defaults?: Record<string, any>; // Default values for optional variables
}
```

## Payload Mapping Examples

### Example 1: Ideogram V2

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
    "status": "$.data.status"
  },
  "defaults": {
    "aspect_ratio": "1:1",
    "magic_prompt_option": "AUTO"
  }
}
```

**User Input**:
```json
{
  "user_prompt": "A serene mountain landscape",
  "aspect_ratio": "16:9"
}
```

**Generated Request**:
```http
POST /generate
Api-Key: ide_actual_api_key_here
Content-Type: application/json

{
  "image_request": {
    "model": "V_2",
    "prompt": "A serene mountain landscape",
    "aspect_ratio": "16:9",
    "magic_prompt_option": "AUTO"
  }
}
```

### Example 2: Gemini Veo 3.1 (Video Generation)

```json
{
  "endpoint": "/v1/models/gemini-veo-3.1:generateContent",
  "method": "POST",
  "headers": {
    "Authorization": "Bearer {api_key}",
    "Content-Type": "application/json",
    "X-Goog-Api-Key": "{api_key}"
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
    },
    "safetySettings": [
      {
        "category": "HARM_CATEGORY_DANGEROUS_CONTENT",
        "threshold": "BLOCK_ONLY_HIGH"
      }
    ]
  },
  "response_mapping": {
    "job_id": "$.name",
    "status": "$.status",
    "video_url": "$.candidates[0].content.parts[0].videoUrl",
    "error_message": "$.error.message"
  },
  "defaults": {
    "aspect_ratio": "16:9",
    "video_length": "8s"
  }
}
```

**User Input**:
```json
{
  "user_prompt": "A cinematic shot of a sunrise over mountains",
  "aspect_ratio": "21:9",
  "video_length": "10s"
}
```

**Generated Request**:
```http
POST /v1/models/gemini-veo-3.1:generateContent
Authorization: Bearer actual_gemini_api_key
Content-Type: application/json

{
  "contents": [
    {
      "role": "user",
      "parts": [
        {
          "text": "A cinematic shot of a sunrise over mountains"
        }
      ]
    }
  ],
  "generationConfig": {
    "aspectRatio": "21:9",
    "responseModality": "video",
    "videoLength": "10s",
    "personGeneration": "allow"
  },
  "safetySettings": [...]
}
```

### Example 3: OpenAI DALL-E 3

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

**Note**: OpenAI uses `size` (e.g., "1024x1024") instead of aspect ratio. The system can include a transformation layer:

```javascript
// Convert aspect_ratio to size
const aspectToSize = {
  "1:1": "1024x1024",
  "16:9": "1792x1024",
  "9:16": "1024x1792"
};
```

### Example 4: Anthropic Claude (Text Generation)

```json
{
  "endpoint": "/v1/messages",
  "method": "POST",
  "headers": {
    "x-api-key": "{api_key}",
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json"
  },
  "body": {
    "model": "claude-3-5-sonnet-20250219",
    "max_tokens": 1024,
    "messages": [
      {
        "role": "user",
        "content": "{user_prompt}"
      }
    ],
    "temperature": "{temperature}",
    "top_p": "{top_p}"
  },
  "response_mapping": {
    "text": "$.content[0].text",
    "usage_tokens": "$.usage.output_tokens",
    "stop_reason": "$.stop_reason"
  },
  "defaults": {
    "temperature": "1.0",
    "top_p": "0.9"
  }
}
```

## Response Mapping

Response mapping uses JSONPath syntax to extract fields from provider responses.

### JSONPath Syntax

- `$` - Root object
- `.field` - Object field access
- `[index]` - Array index access
- `[*]` - All array elements

**Examples**:
- `$.data[0].url` - First URL in data array
- `$.candidates[0].content.parts[0].videoUrl` - Nested video URL
- `$.error.message` - Error message
- `$.usage.total_tokens` - Usage stats

### Response Mapping Example

**Provider Response**:
```json
{
  "name": "operations/generate-12345",
  "status": "processing",
  "candidates": [
    {
      "content": {
        "parts": [
          {
            "videoUrl": "https://storage.googleapis.com/video-12345.mp4"
          }
        ]
      }
    }
  ],
  "usage": {
    "totalTokens": 1024
  }
}
```

**Response Mapping**:
```json
{
  "job_id": "$.name",
  "status": "$.status",
  "video_url": "$.candidates[0].content.parts[0].videoUrl",
  "tokens_used": "$.usage.totalTokens"
}
```

**Extracted Values**:
```json
{
  "job_id": "operations/generate-12345",
  "status": "processing",
  "video_url": "https://storage.googleapis.com/video-12345.mp4",
  "tokens_used": 1024
}
```

## Template Variable Replacement Algorithm

```typescript
function replaceTemplateVars(
  obj: any,
  vars: Record<string, any>,
  defaults: Record<string, any> = {}
): any {
  // Merge vars with defaults (vars take precedence)
  const allVars = { ...defaults, ...vars };

  if (typeof obj === 'string') {
    // Replace all {var_name} occurrences
    return obj.replace(/\{(\w+)\}/g, (match, key) => {
      if (allVars[key] !== undefined) {
        return String(allVars[key]);
      }
      // Variable not provided and no default
      console.warn(`Template variable not provided: ${key}`);
      return match; // Keep placeholder
    });
  }

  if (Array.isArray(obj)) {
    return obj.map(item => replaceTemplateVars(item, vars, defaults));
  }

  if (typeof obj === 'object' && obj !== null) {
    return Object.entries(obj).reduce((acc, [key, val]) => {
      acc[key] = replaceTemplateVars(val, vars, defaults);
      return acc;
    }, {} as any);
  }

  return obj;
}
```

## Advanced Features

### 1. Conditional Fields

Some fields should only be included if a variable is provided:

```json
{
  "body": {
    "prompt": "{user_prompt}",
    "negative_prompt": "{negative_prompt}",  // Only include if provided
    "seed": "{seed}"  // Only include if provided
  }
}
```

**Implementation**: Filter out fields with unreplaced template variables before sending.

### 2. Type Conversions

Template variables are strings by default. Support type hints:

```json
{
  "num_images": "{num_images:int}",
  "temperature": "{temperature:float}",
  "enabled": "{enabled:bool}"
}
```

### 3. Array Expansion

Support expanding arrays from comma-separated values:

```json
{
  "sizes": "{sizes:array}"
}
```

**Input**: `sizes: "1024x1024,512x512,2048x2048"`
**Output**: `sizes: ["1024x1024", "512x512", "2048x2048"]`

### 4. Nested Object Support

Support dot notation for nested variable assignment:

```json
{
  "config.style": "{style}",
  "config.quality": "{quality}"
}
```

Becomes:
```json
{
  "config": {
    "style": "realistic",
    "quality": "hd"
  }
}
```

### 5. Transformations

Support simple transformations:

```json
{
  "aspect_ratio": "{aspect_ratio|aspectToSize}"
}
```

With transformation function:
```javascript
const transformations = {
  aspectToSize: (ratio) => {
    const map = { "1:1": "1024x1024", "16:9": "1792x1024" };
    return map[ratio] || "1024x1024";
  }
};
```

## Validation Rules

### Required Fields
- `endpoint`: Must be a valid URL path
- `method`: Must be valid HTTP method (GET, POST, PUT, PATCH, DELETE)
- `body`: Can be any valid JSON structure
- `response_mapping`: Must be object with JSONPath values

### Best Practices

1. **Use Descriptive Variable Names**: `{user_prompt}` not `{p}`
2. **Provide Defaults**: Always include defaults for optional fields
3. **Document Custom Variables**: Add comments in model description
4. **Test Response Mappings**: Verify paths exist in actual responses
5. **Handle Errors**: Include error field mapping (`$.error.message`)
6. **Validate Before Save**: Check JSON syntax and template variables

### Common Mistakes

❌ **Hardcoded Values** (defeats purpose):
```json
{
  "prompt": "A mountain landscape"  // Should use {user_prompt}
}
```

❌ **Invalid JSONPath**:
```json
{
  "image_url": "data.0.url"  // Missing $ root
}
```

❌ **Missing API Key**:
```json
{
  "headers": {
    "Authorization": "Bearer actual_key_here"  // Should use {api_key}
  }
}
```

✅ **Correct Approach**:
```json
{
  "headers": {
    "Authorization": "Bearer {api_key}"
  },
  "body": {
    "prompt": "{user_prompt}",
    "aspect_ratio": "{aspect_ratio}"
  },
  "defaults": {
    "aspect_ratio": "1:1"
  }
}
```

## Testing Payload Mappings

### Manual Testing

1. **Create Test Config**: Add model config with payload mapping
2. **Send Test Request**: Use Testing GUI or curl
3. **Verify Request**: Check worker logs for formatted request
4. **Verify Response**: Check that response mapping extracts correct fields

### Automated Testing

```javascript
// Test payload mapping
const mapping = {
  endpoint: "/v1/generate",
  method: "POST",
  headers: { "Api-Key": "{api_key}" },
  body: { "prompt": "{user_prompt}" },
  response_mapping: { "url": "$.data[0].url" }
};

const userInputs = {
  user_prompt: "Test prompt",
  api_key: "test_key"
};

const result = applyPayloadMapping(mapping, userInputs, "test_key");

assert.equal(result.headers["Api-Key"], "test_key");
assert.equal(result.body.prompt, "Test prompt");
```

## Migration Guide

### From Hardcoded to Config-Based

**Before** (in provider adapter):
```typescript
formatRequest(prompt: string, options: any) {
  return {
    endpoint: "/generate",
    headers: { "Api-Key": this.apiKey },
    body: {
      image_request: {
        model: "V_2",
        prompt: prompt,
        aspect_ratio: options.aspect_ratio || "1:1"
      }
    }
  };
}
```

**After** (in payload mapping):
```json
{
  "endpoint": "/generate",
  "method": "POST",
  "headers": {
    "Api-Key": "{api_key}"
  },
  "body": {
    "image_request": {
      "model": "V_2",
      "prompt": "{user_prompt}",
      "aspect_ratio": "{aspect_ratio}"
    }
  },
  "defaults": {
    "aspect_ratio": "1:1"
  }
}
```

## Future Extensions

1. **Webhook Support**: Payload mappings for webhook callbacks
2. **Multi-Step Flows**: Chain multiple API calls
3. **Rate Limit Headers**: Extract rate limit info from response headers
4. **Pagination**: Support for paginated responses
5. **Batch Requests**: Map to provider batch endpoints
6. **Streaming**: Support for streaming responses
7. **File Uploads**: Handle multipart/form-data payloads

## Reference Implementations

- Payload Mapper Utility: `workers/shared/utils/payload-mapper.ts`
- Model Config Handlers: `infrastructure/config-service/handlers/model-config-handlers.ts`
- Testing Suite: `tests/payload-mapping.test.ts`

## See Also

- [Model Configuration Plan](./MODEL_CONFIGURATION_PLAN.md)
- [Model Config Schema](./MODEL_CONFIG_SCHEMA.md)
- [Admin Guide](./admin/MODEL_CONFIGURATION_GUIDE.md)
