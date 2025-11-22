# Model Configuration System - Implementation Plan

## Overview

This document outlines the implementation plan for a centralized Model Configuration System that enables flexible, admin-managed model configurations with unified payload mapping across multiple AI providers.

## Goals

1. **Centralized Configuration**: Store all model configurations in the Config Service
2. **Model-Variant Granularity**: Support separate configs for each model version (e.g., Gemini Veo 3.1 vs 2.5 Flash)
3. **Unified User Experience**: Users provide standard inputs; system maps to provider-specific formats
4. **Admin-Defined Mappings**: Admins configure payload mappings; users don't worry about formatting
5. **Rapid Evolution**: Easy addition of new models/providers without code changes
6. **Rich Metadata**: Display capabilities, pricing, rate limits, and status for each model

## Problem Statement

Current limitations:
- Provider API keys stored, but no model-level configuration
- Hardcoded payload formatting in each provider adapter
- No model variant differentiation (e.g., GPT-4 vs GPT-4-turbo)
- Static model selection in testing GUI
- Different providers use different payload structures:
  - OpenAI uses `input` field
  - Gemini uses `contents` field
  - Gemini Veo 3.1 and 2.5 Flash share API keys but need different payloads

## Architecture

### Database Schema

New table: `model_configs`

```sql
CREATE TABLE model_configs (
    config_id TEXT PRIMARY KEY,
    model_id TEXT NOT NULL,           -- e.g., "gemini-veo-3.1", "ideogram-v2"
    provider_id TEXT NOT NULL,        -- e.g., "gemini", "ideogram"
    display_name TEXT NOT NULL,       -- "Gemini Veo 3.1"
    description TEXT,                 -- "Latest video generation model"
    capabilities JSON NOT NULL,       -- { "image": true, "video": true, ... }
    pricing JSON,                     -- { "cost_per_1k_tokens": 0.01, ... }
    rate_limits JSON,                 -- { "rpm": 100, "tpm": 50000 }
    payload_mapping JSON NOT NULL,    -- Template for input transformation
    status TEXT CHECK(status IN ('active', 'deprecated', 'beta')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_model_configs_model_id ON model_configs(model_id);
CREATE INDEX idx_model_configs_provider_id ON model_configs(provider_id);
```

### Payload Mapping Format

The `payload_mapping` JSON defines how to transform unified user inputs into provider-specific API calls:

```json
{
  "endpoint": "/v1/generate",
  "method": "POST",
  "headers": {
    "Authorization": "Bearer {api_key}",
    "Content-Type": "application/json"
  },
  "body": {
    "model": "gemini-2.5-flash-preview-04-25",
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
      "responseModality": "image"
    }
  },
  "response_mapping": {
    "job_id": "$.id",
    "status": "$.status",
    "result_url": "$.candidates[0].content"
  }
}
```

**Template Variables**: `{user_prompt}`, `{aspect_ratio}`, `{api_key}`, etc. are replaced at runtime

### Request Flow

1. User submits request via Testing GUI:
   ```json
   {
     "prompt": "A mountain landscape",
     "model": "gemini-veo-3.1",
     "aspect_ratio": "16:9"
   }
   ```

2. Image-gen worker receives request:
   - Fetches model config for `gemini-veo-3.1`
   - Gets provider ID from config (`gemini`)
   - Gets API key for provider from instance config

3. Payload Mapper applies transformation:
   - Replaces `{user_prompt}` with "A mountain landscape"
   - Replaces `{aspect_ratio}` with "16:9"
   - Replaces `{api_key}` with actual API key
   - Generates provider-specific request

4. Provider adapter sends formatted request
5. Response is mapped back using `response_mapping`

## Implementation Phases

### Phase 0: Documentation Cleanup & Planning ✓

**Sub-Agent 1: Documentation Auditor** ✓
- [x] Scan project for all .md files
- [x] Archive outdated team reports to `archive/team-reports/`
- [x] Archive old planning docs to `archive/worker_project/`

**Sub-Agent 2: Plan Documentation** (Current)
- [ ] Create `MODEL_CONFIGURATION_PLAN.md` (this document)
- [ ] Create `PAYLOAD_MAPPING_SPEC.md`
- [ ] Create `MODEL_CONFIG_SCHEMA.md`

### Phase 1: Database Schema & Config Service Backend

**Timeline**: Parallel implementation (3 sub-agents)

**Sub-Agent 1: Database Schema**
- Add `model_configs` table to `infrastructure/database/schema.sql`
- Create migration script if needed
- Add TypeScript types in `infrastructure/config-service/types.ts`:
  ```typescript
  interface ModelConfig {
    config_id: string;
    model_id: string;
    provider_id: string;
    display_name: string;
    description?: string;
    capabilities: {
      image?: boolean;
      video?: boolean;
      text?: boolean;
      audio?: boolean;
      inpainting?: boolean;
    };
    pricing?: {
      cost_per_1k_tokens?: number;
      cost_per_image?: number;
      currency?: string;
    };
    rate_limits?: {
      rpm?: number;
      tpm?: number;
    };
    payload_mapping: PayloadMapping;
    status: 'active' | 'beta' | 'deprecated';
    created_at: string;
    updated_at: string;
  }

  interface PayloadMapping {
    endpoint: string;
    method: string;
    headers: Record<string, string>;
    body: any;
    response_mapping: Record<string, string>;
  }
  ```

**Sub-Agent 2: Config Service Handlers**
- Create `infrastructure/config-service/handlers/model-config-handlers.ts`
- Implement functions:
  - `listModelConfigs(providerId?: string, env: Env): Promise<ModelConfig[]>`
  - `getModelConfig(configId: string, env: Env): Promise<ModelConfig>`
  - `createModelConfig(request: Request, env: Env): Promise<Response>`
  - `updateModelConfig(configId: string, request: Request, env: Env): Promise<Response>`
  - `deleteModelConfig(configId: string, env: Env): Promise<Response>`
- Add validation:
  - Required fields check
  - Payload mapping JSON structure validation
  - Provider ID validation against existing providers

**Sub-Agent 3: Config Service Routes**
- Update `infrastructure/config-service/index.ts`
- Add routes:
  ```typescript
  // GET /model-config?provider_id=gemini
  // GET /model-config/{config_id}
  // POST /model-config
  // PUT /model-config/{config_id}
  // DELETE /model-config/{config_id}
  ```
- Add CORS handling
- Create test suite with example requests

### Phase 2: Admin Panel UI

**Timeline**: Parallel implementation (4 sub-agents)

**Sub-Agent 1: Models Page Core**
- Create `interfaces/admin-panel/src/pages/Models.jsx`
- Layout structure:
  ```
  Models Page
  ├── Header (title, "Add Model" button)
  ├── Provider Sections (grouped)
  │   ├── Ideogram Section
  │   │   ├── Model Card (Ideogram V2)
  │   │   ├── Model Card (Ideogram V2 Turbo)
  │   ├── OpenAI Section
  │   │   ├── Model Card (GPT-4)
  │   │   ├── Model Card (DALL-E 3)
  │   ├── Anthropic Section
  │   ├── Gemini Section
  │       ├── Model Card (Gemini Veo 3.1)
  │       ├── Model Card (Gemini 2.5 Flash)
  └── Footer (stats, help links)
  ```
- Add navigation:
  - Update `components/Navbar.jsx`: Add "Models" link
  - Update `App.jsx`: Add route `<Route path="/models" element={<Models />} />`
- Use existing Tailwind styling patterns (blue-600, gray-50, shadows)

**Sub-Agent 2: Model Config Modal**
- Create `interfaces/admin-panel/src/components/ModelConfigModal.jsx`
- Form sections:
  1. **Basic Info**:
     - Model ID (text input, slug format)
     - Display Name (text input)
     - Provider (dropdown: ideogram, openai, anthropic, gemini)
     - Description (textarea)
     - Status (select: active, beta, deprecated)

  2. **Capabilities** (checkboxes):
     - Image generation
     - Video generation
     - Text generation
     - Audio generation
     - Inpainting support

  3. **Pricing** (optional):
     - Cost per 1K tokens (number)
     - Cost per image (number)
     - Currency (dropdown: USD, EUR, etc.)

  4. **Rate Limits** (optional):
     - Requests per minute (number)
     - Tokens per minute (number)

  5. **Payload Mapping** (JSON editor):
     - Syntax-highlighted JSON editor (use `<textarea>` with `font-mono`)
     - Template variable guide (show available variables)
     - "Test Mapping" button
- Validation:
  - Required fields check
  - JSON syntax validation
  - Model ID format check (alphanumeric + hyphens)
- Save/Cancel buttons

**Sub-Agent 3: Model Display Components**
- Create `interfaces/admin-panel/src/components/ModelCard.jsx`:
  ```jsx
  <ModelCard>
    ├── Header (icon, name, status badge)
    ├── Description
    ├── Capabilities (badges: Image, Video, etc.)
    ├── Metadata (pricing, rate limits)
    ├── Payload Preview (collapsible)
    └── Actions (Edit, Delete buttons)
  </ModelCard>
  ```

- Create `interfaces/admin-panel/src/components/PayloadMappingViewer.jsx`:
  - Shows user input → provider mapping visually
  - Example:
    ```
    User Input          →  Provider Payload
    ───────────────────────────────────────
    prompt              →  contents[0].parts[0].text
    aspect_ratio        →  generationConfig.aspectRatio
    style               →  generationConfig.mode
    ```

- Create utility functions in `interfaces/admin-panel/src/utils/modelConfig.js`:
  - `formatModelId(name)` - Convert name to slug
  - `validatePayloadMapping(mapping)` - Validate JSON structure
  - `extractTemplateVars(mapping)` - Find all `{variable}` placeholders

**Sub-Agent 4: API Service Integration**
- Update `interfaces/admin-panel/src/services/api.js`
- Add methods:
  ```javascript
  // Model Configs
  async getModelConfigs(providerId = null) {
    const url = providerId
      ? `${this.baseUrl}/model-config?provider_id=${providerId}`
      : `${this.baseUrl}/model-config`;
    // ... fetch and return
  }

  async getModelConfig(configId) { ... }
  async createModelConfig(data) { ... }
  async updateModelConfig(configId, data) { ... }
  async deleteModelConfig(configId) { ... }
  async testModelConfig(configId, testPayload) { ... }
  ```
- Add mock data for development:
  ```javascript
  const mockModelConfigs = [
    {
      config_id: 'cfg_gemini_veo_31',
      model_id: 'gemini-veo-3.1',
      provider_id: 'gemini',
      display_name: 'Gemini Veo 3.1',
      description: 'Latest video generation model from Google',
      capabilities: { video: true, image: false },
      pricing: { cost_per_video: 0.05, currency: 'USD' },
      rate_limits: { rpm: 60 },
      status: 'active',
      payload_mapping: { /* ... */ }
    },
    // ... more examples
  ];
  ```
- Update config if needed

### Phase 3: Worker Integration

**Timeline**: Parallel implementation (3 sub-agents)

**Sub-Agent 1: Payload Mapping Utility**
- Create `workers/shared/utils/payload-mapper.ts`
- Core function:
  ```typescript
  export function applyPayloadMapping(
    mapping: PayloadMapping,
    userInputs: Record<string, any>,
    apiKey: string
  ): ProviderRequest {
    // 1. Clone the mapping.body structure
    const payload = JSON.parse(JSON.stringify(mapping.body));

    // 2. Replace template variables recursively
    const replaced = replaceTemplateVars(payload, {
      ...userInputs,
      api_key: apiKey
    });

    // 3. Build headers with API key
    const headers = Object.entries(mapping.headers).reduce((acc, [key, val]) => {
      acc[key] = val.replace('{api_key}', apiKey);
      return acc;
    }, {} as Record<string, string>);

    // 4. Return formatted request
    return {
      endpoint: mapping.endpoint,
      method: mapping.method,
      headers,
      body: replaced
    };
  }

  function replaceTemplateVars(obj: any, vars: Record<string, any>): any {
    if (typeof obj === 'string') {
      // Replace {var_name} with actual value
      return obj.replace(/\{(\w+)\}/g, (match, key) => {
        return vars[key] !== undefined ? vars[key] : match;
      });
    }
    if (Array.isArray(obj)) {
      return obj.map(item => replaceTemplateVars(item, vars));
    }
    if (typeof obj === 'object' && obj !== null) {
      return Object.entries(obj).reduce((acc, [key, val]) => {
        acc[key] = replaceTemplateVars(val, vars);
        return acc;
      }, {} as any);
    }
    return obj;
  }

  export function applyResponseMapping(
    response: any,
    mapping: Record<string, string>
  ): Record<string, any> {
    // Use JSONPath or simple dot notation to extract fields
    // Example: "$.data[0].url" -> response.data[0].url
    return Object.entries(mapping).reduce((acc, [key, path]) => {
      acc[key] = extractByPath(response, path);
      return acc;
    }, {} as Record<string, any>);
  }
  ```
- Add unit tests with example mappings

**Sub-Agent 2: Image-Gen Worker Updates**
- Update `workers/image-gen/index.ts`
- Modify request handling:
  ```typescript
  // OLD:
  const provider = env.DEFAULT_PROVIDER || 'ideogram';
  const adapter = providerRegistry.getAdapter(provider);

  // NEW:
  const modelId = body.model || 'ideogram-v2'; // from request or default
  const modelConfig = await getModelConfig(modelId, env);
  const provider = modelConfig.provider_id;
  const apiKey = instanceConfig.api_keys[provider];

  // Apply payload mapping
  const providerRequest = applyPayloadMapping(
    modelConfig.payload_mapping,
    {
      user_prompt: body.prompt,
      aspect_ratio: body.options?.aspect_ratio || '1:1',
      style: body.options?.style || 'auto',
      // ... other user inputs
    },
    apiKey
  );

  // Use provider adapter to send request
  const adapter = providerRegistry.getAdapter(provider);
  const result = await adapter.sendRequest(providerRequest);

  // Map response back
  const mappedResponse = applyResponseMapping(
    result,
    modelConfig.payload_mapping.response_mapping
  );
  ```
- Add helper function:
  ```typescript
  async function getModelConfig(
    modelId: string,
    env: Env
  ): Promise<ModelConfig> {
    const configServiceUrl = env.CONFIG_SERVICE_URL;
    const response = await fetch(
      `${configServiceUrl}/model-config?model_id=${modelId}`
    );
    const configs = await response.json();
    if (configs.length === 0) {
      throw new Error(`Model config not found: ${modelId}`);
    }
    return configs[0];
  }
  ```
- Add error handling for missing configs

**Sub-Agent 3: Provider Adapter Enhancement**
- Update adapters in `workers/shared/provider-adapters/`
- Modify base interface:
  ```typescript
  abstract class ProviderAdapter {
    // NEW: Generic request sender
    async sendRequest(request: ProviderRequest): Promise<any> {
      const response = await fetch(request.endpoint, {
        method: request.method,
        headers: request.headers,
        body: JSON.stringify(request.body)
      });
      return response.json();
    }

    // Keep existing methods for backward compatibility
    abstract formatRequest(...): ProviderRequest
    abstract submitJob(...): Promise<string>
    abstract checkStatus(...): Promise<JobStatus>
    abstract fetchResult(...): Promise<ImageResult>
  }
  ```
- Update existing adapters to support both approaches:
  - Old: Direct formatRequest() with hardcoded logic
  - New: Use sendRequest() with model config payload
- Remove hardcoded model defaults

### Phase 4: Testing GUI Enhancement & Documentation

**Timeline**: Parallel implementation (3 sub-agents)

**Sub-Agent 1: Testing GUI Updates**
- Update `interfaces/testing-gui/public/app.js`
- Add model loading on instance selection:
  ```javascript
  async function loadModels(instanceId) {
    const configServiceUrl = document.getElementById('configServiceUrl').value;
    const response = await fetch(`${configServiceUrl}/model-config`);
    const configs = await response.json();

    // Store configs globally
    window.modelConfigs = configs;

    // Populate model dropdown
    const modelSelect = document.getElementById('model');
    modelSelect.innerHTML = '<option value="">Select a model...</option>';

    // Group by provider
    const byProvider = configs.reduce((acc, cfg) => {
      if (!acc[cfg.provider_id]) acc[cfg.provider_id] = [];
      acc[cfg.provider_id].push(cfg);
      return acc;
    }, {});

    // Create optgroups
    for (const [provider, models] of Object.entries(byProvider)) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = provider.toUpperCase();

      models.forEach(cfg => {
        const option = document.createElement('option');
        option.value = cfg.model_id;
        option.textContent = `${cfg.display_name} (${cfg.status})`;
        option.dataset.capabilities = JSON.stringify(cfg.capabilities);
        option.dataset.pricing = JSON.stringify(cfg.pricing);
        optgroup.appendChild(option);
      });

      modelSelect.appendChild(optgroup);
    }
  }
  ```
- Add dynamic option visibility:
  ```javascript
  function onModelChange() {
    const modelSelect = document.getElementById('model');
    const selected = modelSelect.selectedOptions[0];

    if (!selected) return;

    const capabilities = JSON.parse(selected.dataset.capabilities);

    // Show/hide options based on capabilities
    document.getElementById('videoOptions').style.display =
      capabilities.video ? 'block' : 'none';

    document.getElementById('inpaintingOptions').style.display =
      capabilities.inpainting ? 'block' : 'none';

    // Show pricing info
    const pricing = JSON.parse(selected.dataset.pricing);
    if (pricing) {
      document.getElementById('pricingInfo').textContent =
        `Cost: ${pricing.cost_per_image || pricing.cost_per_1k_tokens} ${pricing.currency}`;
    }
  }
  ```
- Update form submission to include model_id:
  ```javascript
  const requestBody = {
    prompt: document.getElementById('prompt').value,
    model: document.getElementById('model').value, // NEW
    instance_id: instanceId,
    options: {
      aspect_ratio: document.getElementById('aspectRatio').value,
      style: document.getElementById('style').value,
      // ... other options
    }
  };
  ```

**Sub-Agent 2: Seed Data & Examples**
- Create `infrastructure/database/seed-model-configs.sql`
- Example model configs:

  1. **Ideogram V2**:
  ```sql
  INSERT INTO model_configs VALUES (
    'cfg_ideogram_v2',
    'ideogram-v2',
    'ideogram',
    'Ideogram V2',
    'High-quality image generation with text rendering',
    '{"image": true, "video": false, "text": false}',
    '{"cost_per_image": 0.08, "currency": "USD"}',
    '{"rpm": 100, "tpm": 50000}',
    '{"endpoint": "/generate", "method": "POST", "headers": {"Api-Key": "{api_key}"}, "body": {"image_request": {"model": "V_2", "prompt": "{user_prompt}", "aspect_ratio": "{aspect_ratio}"}}, "response_mapping": {"job_id": "$.data.id", "status": "$.data.status"}}',
    'active',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  );
  ```

  2. **Gemini Veo 3.1**:
  ```sql
  INSERT INTO model_configs VALUES (
    'cfg_gemini_veo_31',
    'gemini-veo-3.1',
    'gemini',
    'Gemini Veo 3.1',
    'Advanced video generation model',
    '{"image": false, "video": true, "text": false}',
    '{"cost_per_video": 0.50, "currency": "USD"}',
    '{"rpm": 60, "tpm": 30000}',
    '{"endpoint": "/v1/models/gemini-veo-3.1:generateContent", "method": "POST", "headers": {"Authorization": "Bearer {api_key}", "Content-Type": "application/json"}, "body": {"contents": [{"parts": [{"text": "{user_prompt}"}]}], "generationConfig": {"aspectRatio": "{aspect_ratio}", "responseModality": "video"}}, "response_mapping": {"job_id": "$.name", "video_url": "$.candidates[0].content.parts[0].videoUrl"}}',
    'active',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  );
  ```

  3. **Gemini 2.5 Flash (Nano Banana)**:
  ```sql
  INSERT INTO model_configs VALUES (
    'cfg_gemini_25_flash',
    'gemini-2.5-flash-nano-banana',
    'gemini',
    'Gemini 2.5 Flash Image (Nano Banana)',
    'Fast image generation with Gemini',
    '{"image": true, "video": false, "text": false}',
    '{"cost_per_image": 0.02, "currency": "USD"}',
    '{"rpm": 120, "tpm": 60000}',
    '{"endpoint": "/v1/models/gemini-2.5-flash:generateContent", "method": "POST", "headers": {"Authorization": "Bearer {api_key}"}, "body": {"prompt": "{user_prompt}", "parameters": {"aspect_ratio": "{aspect_ratio}", "quality": "standard"}}, "response_mapping": {"image_url": "$.data[0].url"}}',
    'beta',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  );
  ```

  4. **OpenAI DALL-E 3**:
  ```sql
  INSERT INTO model_configs VALUES (
    'cfg_dalle3',
    'dall-e-3',
    'openai',
    'DALL-E 3',
    'OpenAI text-to-image generation',
    '{"image": true, "video": false, "text": false}',
    '{"cost_per_image": 0.04, "currency": "USD"}',
    '{"rpm": 50, "tpm": 25000}',
    '{"endpoint": "/v1/images/generations", "method": "POST", "headers": {"Authorization": "Bearer {api_key}"}, "body": {"model": "dall-e-3", "prompt": "{user_prompt}", "size": "{aspect_ratio}", "quality": "standard"}, "response_mapping": {"image_url": "$.data[0].url"}}',
    'active',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  );
  ```

- Create seed script: `infrastructure/database/seed.sh`

**Sub-Agent 3: Final Documentation**
- Create `/docs/admin/MODEL_CONFIGURATION_GUIDE.md`:
  - How to add a new model
  - How to create payload mappings
  - How to test configurations
  - Troubleshooting common issues

- Create `/docs/api/MODEL_CONFIG_API.md`:
  - API endpoint documentation
  - Request/response examples
  - Error codes

- Update `/docs/README.md`:
  - Add link to Model Configuration documentation
  - Update architecture diagrams

- Update main `/README.md`:
  - Add "Model Configuration" section
  - Update feature list
  - Add screenshots

## Success Criteria

1. **Database**: `model_configs` table exists with proper schema
2. **Config Service**: CRUD endpoints functional and tested
3. **Admin Panel**: Models page allows full model management
4. **Worker**: Image-gen worker uses model configs for payload formatting
5. **Testing GUI**: Dynamic model selection with capability-based UI
6. **Documentation**: Complete guides for admins and users
7. **Seed Data**: Example configs for 4+ models across 3+ providers
8. **End-to-End**: User can request image from any configured model without knowing payload format

## Rollout Plan

1. **Phase 1**: Deploy database schema and config service (backend only)
2. **Phase 2**: Deploy admin panel UI (admins can configure models)
3. **Phase 3**: Update workers to use configs (maintain backward compatibility)
4. **Phase 4**: Update testing GUI and enable for all users

## Backward Compatibility

- Keep existing provider adapters functional
- Support both old (hardcoded) and new (config-based) approaches during transition
- Default to `ideogram-v2` if no model specified
- Gradual migration path

## Future Enhancements

1. **Model Testing**: Built-in test suite in admin panel
2. **Usage Analytics**: Track which models are most used
3. **Cost Tracking**: Monitor spending per model
4. **Auto-Discovery**: Fetch available models from provider APIs
5. **Version Management**: Support model versioning and deprecation workflows
6. **A/B Testing**: Configure multiple variants for testing
7. **Webhooks**: Notify on model status changes

## References

- [Payload Mapping Specification](./PAYLOAD_MAPPING_SPEC.md)
- [Model Config Schema](./MODEL_CONFIG_SCHEMA.md)
- [Admin Guide](./admin/MODEL_CONFIGURATION_GUIDE.md)
- [API Documentation](./api/MODEL_CONFIG_API.md)
