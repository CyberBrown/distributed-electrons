// API Service with Mock Data Support

const USE_MOCK = false // Toggle for parallel development

// Mock Data
const mockInstances = [
  {
    instance_id: 'production',
    org_id: 'solamp',
    name: 'Production Instance',
    status: 'active',
    api_keys: {
      ideogram: 'ide_prod123456789',
      openai: 'sk-proj-abcdef1234567890',
      anthropic: 'sk-ant-api03-xyz789',
      gemini: 'AIzaSyABCDEF1234567890'
    },
    rate_limits: {
      ideogram: { rpm: 500, tpm: 100000 },
      openai: { rpm: 1000, tpm: 500000 },
      anthropic: { rpm: 800, tpm: 400000 },
      gemini: { rpm: 600, tpm: 300000 }
    },
    worker_urls: { image_gen: 'https://image-gen-production.workers.dev' },
    r2_bucket: 'prod-images',
    authorized_users: ['user_123', 'user_456'],
    created_at: '2025-01-15T10:00:00Z'
  },
  {
    instance_id: 'development',
    org_id: 'solamp',
    name: 'Development Instance',
    status: 'active',
    api_keys: {
      ideogram: 'ide_dev987654321',
      openai: 'sk-test-1234567890abcdef'
    },
    rate_limits: {
      ideogram: { rpm: 100, tpm: 50000 },
      openai: { rpm: 200, tpm: 100000 }
    },
    worker_urls: { image_gen: 'https://image-gen-development.workers.dev' },
    r2_bucket: 'dev-images',
    authorized_users: ['user_123'],
    created_at: '2025-01-10T10:00:00Z'
  }
]

const mockUsers = [
  {
    user_id: 'user_123',
    email: 'admin@example.com',
    role: 'admin',
    org_id: 'solamp',
    instances: ['production', 'development'],
    created_at: '2025-01-01T00:00:00Z'
  },
  {
    user_id: 'user_456',
    email: 'developer@example.com',
    role: 'user',
    org_id: 'solamp',
    instances: ['production'],
    created_at: '2025-01-05T00:00:00Z'
  }
]

const mockApiKeys = [
  {
    key_id: 'key_abc123',
    name: 'Production API Key',
    user_id: 'user_123',
    api_key: 'sk_live_***abc123',
    created_at: '2025-01-15T10:00:00Z',
    last_used: '2025-01-20T12:00:00Z',
    status: 'active'
  },
  {
    key_id: 'key_def456',
    name: 'Dev API Key',
    user_id: 'user_456',
    api_key: 'sk_dev_***def456',
    created_at: '2025-01-10T10:00:00Z',
    last_used: '2025-01-19T08:00:00Z',
    status: 'active'
  }
]

const mockLogs = Array.from({ length: 50 }, (_, i) => ({
  log_id: `log_${i}`,
  timestamp: new Date(Date.now() - i * 1000 * 60 * 10).toISOString(),
  level: ['info', 'error', 'warn', 'debug'][Math.floor(Math.random() * 4)],
  message: [
    'Image generation successful',
    'Rate limit exceeded',
    'Provider API timeout',
    'Instance config updated',
    'User created successfully'
  ][Math.floor(Math.random() * 5)],
  instance_id: ['production', 'development'][Math.floor(Math.random() * 2)],
  request_id: `req_${Math.random().toString(36).substring(7)}`,
  metadata: {
    user_id: 'user_123',
    endpoint: '/generate'
  }
}))

const mockModelConfigs = [
  {
    config_id: 'cfg_ideogram_v2',
    model_id: 'ideogram-v2',
    provider_id: 'ideogram',
    display_name: 'Ideogram V2',
    description: 'High-quality image generation with excellent text rendering',
    capabilities: { image: true, video: false, text: false },
    pricing: { cost_per_image: 0.08, currency: 'USD' },
    rate_limits: { rpm: 100, tpm: 50000 },
    payload_mapping: {
      endpoint: '/generate',
      method: 'POST',
      headers: { 'Api-Key': '{api_key}', 'Content-Type': 'application/json' },
      body: { image_request: { model: 'V_2', prompt: '{user_prompt}', aspect_ratio: '{aspect_ratio}' } },
      response_mapping: { job_id: '$.data.id', image_url: '$.data.url' },
      defaults: { aspect_ratio: '1:1' }
    },
    status: 'active',
    created_at: '2025-01-15T10:00:00Z',
    updated_at: '2025-01-15T10:00:00Z'
  },
  {
    config_id: 'cfg_gemini_veo_31',
    model_id: 'gemini-veo-3.1',
    provider_id: 'gemini',
    display_name: 'Gemini Veo 3.1',
    description: 'Advanced video generation model from Google',
    capabilities: { image: false, video: true, text: false },
    pricing: { cost_per_video: 0.50, currency: 'USD' },
    rate_limits: { rpm: 60, tpm: 30000 },
    payload_mapping: {
      endpoint: '/v1/models/gemini-veo-3.1:generateContent',
      method: 'POST',
      headers: { 'Authorization': 'Bearer {api_key}', 'Content-Type': 'application/json' },
      body: {
        contents: [{ parts: [{ text: '{user_prompt}' }] }],
        generationConfig: { aspectRatio: '{aspect_ratio}', responseModality: 'video' }
      },
      response_mapping: { job_id: '$.name', video_url: '$.candidates[0].content.parts[0].videoUrl' },
      defaults: { aspect_ratio: '16:9' }
    },
    status: 'active',
    created_at: '2025-01-16T10:00:00Z',
    updated_at: '2025-01-16T10:00:00Z'
  },
  {
    config_id: 'cfg_dalle3',
    model_id: 'dall-e-3',
    provider_id: 'openai',
    display_name: 'DALL-E 3',
    description: 'OpenAI premier text-to-image generation model',
    capabilities: { image: true, video: false, text: false },
    pricing: { cost_per_image: 0.04, currency: 'USD' },
    rate_limits: { rpm: 50, tpm: 25000 },
    payload_mapping: {
      endpoint: '/v1/images/generations',
      method: 'POST',
      headers: { 'Authorization': 'Bearer {api_key}', 'Content-Type': 'application/json' },
      body: { model: 'dall-e-3', prompt: '{user_prompt}', size: '{size}', quality: '{quality}' },
      response_mapping: { image_url: '$.data[0].url', revised_prompt: '$.data[0].revised_prompt' },
      defaults: { size: '1024x1024', quality: 'standard' }
    },
    status: 'active',
    created_at: '2025-01-17T10:00:00Z',
    updated_at: '2025-01-17T10:00:00Z'
  }
]

// Helper to simulate API delay
const delay = (ms = 500) => new Promise(resolve => setTimeout(resolve, ms))

// API Service
class ApiService {
  constructor() {
    this.baseUrl = 'https://config-service.solamp.workers.dev'
  }

  getAuthHeader() {
    const apiKey = localStorage.getItem('adminApiKey')
    return {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  }

  // Instances
  async getInstances() {
    if (USE_MOCK) {
      await delay()
      return { instances: mockInstances }
    }

    const response = await fetch(`${this.baseUrl}/api/instances`, {
      headers: this.getAuthHeader()
    })

    if (!response.ok) throw new Error('Failed to fetch instances')
    return await response.json()
  }

  async getInstance(instanceId) {
    if (USE_MOCK) {
      await delay()
      const instance = mockInstances.find(i => i.instance_id === instanceId)
      if (!instance) throw new Error('Instance not found')
      return instance
    }

    const response = await fetch(`${this.baseUrl}/api/instances/${instanceId}`, {
      headers: this.getAuthHeader()
    })

    if (!response.ok) throw new Error('Failed to fetch instance')
    return await response.json()
  }

  async createInstance(data) {
    if (USE_MOCK) {
      await delay()
      const newInstance = {
        ...data,
        status: 'active',
        created_at: new Date().toISOString(),
        worker_urls: {
          image_gen: `https://image-gen-${data.instance_id}.workers.dev`
        }
      }
      mockInstances.push(newInstance)
      return newInstance
    }

    const response = await fetch(`${this.baseUrl}/api/instances`, {
      method: 'POST',
      headers: this.getAuthHeader(),
      body: JSON.stringify(data)
    })

    if (!response.ok) throw new Error('Failed to create instance')
    return await response.json()
  }

  async updateInstance(instanceId, data) {
    if (USE_MOCK) {
      await delay()
      const index = mockInstances.findIndex(i => i.instance_id === instanceId)
      if (index === -1) throw new Error('Instance not found')

      mockInstances[index] = { ...mockInstances[index], ...data }
      return {
        instance_id: instanceId,
        updated_at: new Date().toISOString(),
        message: 'Instance updated successfully'
      }
    }

    const response = await fetch(`${this.baseUrl}/api/instances/${instanceId}`, {
      method: 'PATCH',
      headers: this.getAuthHeader(),
      body: JSON.stringify(data)
    })

    if (!response.ok) throw new Error('Failed to update instance')
    return await response.json()
  }

  async deleteInstance(instanceId) {
    if (USE_MOCK) {
      await delay()
      const index = mockInstances.findIndex(i => i.instance_id === instanceId)
      if (index === -1) throw new Error('Instance not found')

      mockInstances.splice(index, 1)
      return { message: 'Instance deleted successfully' }
    }

    const response = await fetch(`${this.baseUrl}/api/instances/${instanceId}`, {
      method: 'DELETE',
      headers: this.getAuthHeader()
    })

    if (!response.ok) throw new Error('Failed to delete instance')
    return { message: 'Instance deleted successfully' }
  }

  // Users
  async getUsers() {
    if (USE_MOCK) {
      await delay()
      return { users: mockUsers }
    }

    const response = await fetch(`${this.baseUrl}/api/users`, {
      headers: this.getAuthHeader()
    })

    if (!response.ok) throw new Error('Failed to fetch users')
    return await response.json()
  }

  async createUser(data) {
    if (USE_MOCK) {
      await delay()
      const newUser = {
        ...data,
        user_id: `user_${Math.random().toString(36).substring(7)}`,
        api_key: `ak_${Math.random().toString(36).substring(2, 15)}`,
        created_at: new Date().toISOString()
      }
      mockUsers.push(newUser)
      return newUser
    }

    const response = await fetch(`${this.baseUrl}/api/users`, {
      method: 'POST',
      headers: this.getAuthHeader(),
      body: JSON.stringify(data)
    })

    if (!response.ok) throw new Error('Failed to create user')
    return await response.json()
  }

  // API Keys
  async getApiKeys(instanceId) {
    if (USE_MOCK) {
      await delay()
      return { keys: mockApiKeys }
    }

    const response = await fetch(`${this.baseUrl}/api/keys?instance_id=${instanceId}`, {
      headers: this.getAuthHeader()
    })

    if (!response.ok) throw new Error('Failed to fetch API keys')
    return await response.json()
  }

  async generateApiKey(data) {
    if (USE_MOCK) {
      await delay()
      const newKey = {
        key_id: `key_${Math.random().toString(36).substring(7)}`,
        name: data.name,
        user_id: data.user_id,
        api_key: `sk_${data.instance_id}_${Math.random().toString(36).substring(2, 15)}`,
        created_at: new Date().toISOString(),
        expires_at: data.expires_in_days ? new Date(Date.now() + data.expires_in_days * 24 * 60 * 60 * 1000).toISOString() : null,
        status: 'active'
      }
      mockApiKeys.push(newKey)
      return newKey
    }

    const response = await fetch(`${this.baseUrl}/api/keys`, {
      method: 'POST',
      headers: this.getAuthHeader(),
      body: JSON.stringify(data)
    })

    if (!response.ok) throw new Error('Failed to generate API key')
    return await response.json()
  }

  async revokeApiKey(keyId) {
    if (USE_MOCK) {
      await delay()
      const index = mockApiKeys.findIndex(k => k.key_id === keyId)
      if (index === -1) throw new Error('API key not found')

      mockApiKeys.splice(index, 1)
      return { message: 'API key revoked successfully' }
    }

    const response = await fetch(`${this.baseUrl}/api/keys/${keyId}`, {
      method: 'DELETE',
      headers: this.getAuthHeader()
    })

    if (!response.ok) throw new Error('Failed to revoke API key')
    return { message: 'API key revoked successfully' }
  }

  // Logs
  async getLogs(filters = {}) {
    if (USE_MOCK) {
      await delay()
      let filteredLogs = [...mockLogs]

      if (filters.instance_id) {
        filteredLogs = filteredLogs.filter(log => log.instance_id === filters.instance_id)
      }

      if (filters.level) {
        filteredLogs = filteredLogs.filter(log => log.level === filters.level)
      }

      if (filters.search) {
        filteredLogs = filteredLogs.filter(log =>
          log.message.toLowerCase().includes(filters.search.toLowerCase())
        )
      }

      return {
        logs: filteredLogs.slice(0, 20),
        total: filteredLogs.length,
        has_more: filteredLogs.length > 20
      }
    }

    const params = new URLSearchParams(filters).toString()
    const response = await fetch(`${this.baseUrl}/api/logs?${params}`, {
      headers: this.getAuthHeader()
    })

    if (!response.ok) throw new Error('Failed to fetch logs')
    return await response.json()
  }

  // Metrics
  async getMetrics(params) {
    if (USE_MOCK) {
      await delay()

      const data_points = Array.from({ length: 24 }, (_, i) => ({
        timestamp: new Date(Date.now() - (23 - i) * 60 * 60 * 1000).toISOString(),
        value: Math.floor(Math.random() * 300) + 50
      }))

      return {
        metric: params.metric,
        instance_id: params.instance_id,
        timeframe: params.timeframe,
        data_points,
        summary: {
          total: data_points.reduce((sum, dp) => sum + dp.value, 0),
          average: Math.floor(data_points.reduce((sum, dp) => sum + dp.value, 0) / data_points.length),
          peak: Math.max(...data_points.map(dp => dp.value))
        }
      }
    }

    const queryParams = new URLSearchParams(params).toString()
    const response = await fetch(`${this.baseUrl}/api/metrics?${queryParams}`, {
      headers: this.getAuthHeader()
    })

    if (!response.ok) throw new Error('Failed to fetch metrics')
    return await response.json()
  }

  // Provider API Key Management (using KV storage)
  async updateProviderApiKey(instanceId, providerId, apiKey) {
    if (USE_MOCK) {
      await delay(300)
      const instance = mockInstances.find(i => i.instance_id === instanceId)
      if (!instance) throw new Error('Instance not found')

      if (!instance.api_keys) {
        instance.api_keys = {}
      }

      instance.api_keys[providerId] = apiKey

      return {
        success: true,
        message: `${providerId} API key updated successfully`,
        instance_id: instanceId,
        provider: providerId
      }
    }

    // Use new provider-key endpoint (stores in KV with encryption)
    const response = await fetch(`${this.baseUrl}/provider-key`, {
      method: 'POST',
      headers: this.getAuthHeader(),
      body: JSON.stringify({
        instance_id: instanceId,
        provider: providerId,
        api_key: apiKey
      })
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to store provider API key')
    }

    const result = await response.json()
    return {
      success: true,
      message: `${providerId} API key stored successfully`,
      ...result.data
    }
  }

  async getProviderKeyStatus(instanceId, providerId) {
    if (USE_MOCK) {
      await delay(200)
      const instance = mockInstances.find(i => i.instance_id === instanceId)
      return {
        instance_id: instanceId,
        provider: providerId,
        configured: !!(instance?.api_keys?.[providerId]),
        updated_at: new Date().toISOString()
      }
    }

    const response = await fetch(`${this.baseUrl}/provider-key/${instanceId}/${providerId}`, {
      headers: this.getAuthHeader()
    })

    if (!response.ok) throw new Error('Failed to check provider key status')
    const result = await response.json()
    return result.data
  }

  async listProviderKeys(instanceId) {
    if (USE_MOCK) {
      await delay(200)
      const instance = mockInstances.find(i => i.instance_id === instanceId)
      const providers = Object.keys(instance?.api_keys || {}).map(p => ({
        provider: p,
        configured: true,
        updated_at: new Date().toISOString()
      }))
      return { instance_id: instanceId, providers }
    }

    const response = await fetch(`${this.baseUrl}/provider-key/${instanceId}`, {
      headers: this.getAuthHeader()
    })

    if (!response.ok) throw new Error('Failed to list provider keys')
    const result = await response.json()
    return result.data
  }

  async deleteProviderApiKey(instanceId, providerId) {
    if (USE_MOCK) {
      await delay(300)
      const instance = mockInstances.find(i => i.instance_id === instanceId)
      if (!instance) throw new Error('Instance not found')

      if (instance.api_keys && instance.api_keys[providerId]) {
        delete instance.api_keys[providerId]
      }

      return {
        success: true,
        message: `${providerId} API key deleted successfully`,
        instance_id: instanceId,
        provider: providerId
      }
    }

    const response = await fetch(`${this.baseUrl}/provider-key/${instanceId}/${providerId}`, {
      method: 'DELETE',
      headers: this.getAuthHeader()
    })

    if (!response.ok) throw new Error('Failed to delete provider API key')
    return await response.json()
  }

  async testProviderApiKey(providerId, apiKey) {
    // This would call the actual provider API to validate the key
    // For now, just simulate the test
    await delay(1500)

    // Simple validation: check if it's not empty and matches basic format
    if (!apiKey || apiKey.length < 10) {
      return {
        success: false,
        message: 'API key appears to be invalid (too short)'
      }
    }

    // Provider-specific validation
    const validations = {
      openai: apiKey.startsWith('sk-'),
      anthropic: apiKey.startsWith('sk-ant-'),
      google: apiKey.startsWith('AIza'),
      ideogram: apiKey.startsWith('ide_') || apiKey.length > 20,
    }

    const isValid = validations[providerId] ?? true

    return {
      success: isValid,
      message: isValid
        ? `${providerId} API key format is valid`
        : `${providerId} API key format appears invalid`
    }
  }

  // Model Configurations
  async getModelConfigs(providerId = null, status = null) {
    if (USE_MOCK) {
      await delay()
      let filtered = [...mockModelConfigs]

      if (providerId) {
        filtered = filtered.filter(c => c.provider_id === providerId)
      }

      if (status) {
        filtered = filtered.filter(c => c.status === status)
      }

      return { configs: filtered, total: filtered.length }
    }

    const params = new URLSearchParams()
    if (providerId) params.append('provider_id', providerId)
    if (status) params.append('status', status)

    const response = await fetch(`${this.baseUrl}/model-config?${params.toString()}`, {
      headers: this.getAuthHeader()
    })

    if (!response.ok) throw new Error('Failed to fetch model configs')
    const result = await response.json()
    return result.data || result
  }

  async getModelConfig(configId) {
    if (USE_MOCK) {
      await delay()
      const config = mockModelConfigs.find(c => c.config_id === configId || c.model_id === configId)
      if (!config) throw new Error('Model config not found')
      return config
    }

    const response = await fetch(`${this.baseUrl}/model-config/${configId}`, {
      headers: this.getAuthHeader()
    })

    if (!response.ok) throw new Error('Failed to fetch model config')
    const result = await response.json()
    return result.data || result
  }

  async createModelConfig(data) {
    if (USE_MOCK) {
      await delay()
      const configId = `cfg_${data.provider_id}_${data.model_id.replace(/-/g, '_')}`
      const newConfig = {
        config_id: configId,
        ...data,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
      mockModelConfigs.push(newConfig)
      return newConfig
    }

    const response = await fetch(`${this.baseUrl}/model-config`, {
      method: 'POST',
      headers: this.getAuthHeader(),
      body: JSON.stringify(data)
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to create model config')
    }
    const result = await response.json()
    return result.data || result
  }

  async updateModelConfig(configId, data) {
    if (USE_MOCK) {
      await delay()
      const index = mockModelConfigs.findIndex(c => c.config_id === configId || c.model_id === configId)
      if (index === -1) throw new Error('Model config not found')

      mockModelConfigs[index] = {
        ...mockModelConfigs[index],
        ...data,
        updated_at: new Date().toISOString()
      }

      return mockModelConfigs[index]
    }

    const response = await fetch(`${this.baseUrl}/model-config/${configId}`, {
      method: 'PUT',
      headers: this.getAuthHeader(),
      body: JSON.stringify(data)
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to update model config')
    }
    const result = await response.json()
    return result.data || result
  }

  async deleteModelConfig(configId) {
    if (USE_MOCK) {
      await delay()
      const index = mockModelConfigs.findIndex(c => c.config_id === configId || c.model_id === configId)
      if (index === -1) throw new Error('Model config not found')

      mockModelConfigs.splice(index, 1)
      return { success: true, message: 'Model config deleted successfully' }
    }

    const response = await fetch(`${this.baseUrl}/model-config/${configId}`, {
      method: 'DELETE',
      headers: this.getAuthHeader()
    })

    if (!response.ok) throw new Error('Failed to delete model config')
    return await response.json()
  }
}


export default new ApiService()
