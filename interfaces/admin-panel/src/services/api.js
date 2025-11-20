// API Service with Mock Data Support

const USE_MOCK = true // Toggle for parallel development

// Mock Data
const mockInstances = [
  {
    instance_id: 'production',
    org_id: 'solamp',
    name: 'Production Instance',
    status: 'active',
    api_keys: { ideogram: 'ide_***' },
    rate_limits: { ideogram: { rpm: 500, tpm: 100000 } },
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
    api_keys: { ideogram: 'ide_dev_***' },
    rate_limits: { ideogram: { rpm: 100, tpm: 50000 } },
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

// Helper to simulate API delay
const delay = (ms = 500) => new Promise(resolve => setTimeout(resolve, ms))

// API Service
class ApiService {
  constructor() {
    this.baseUrl = 'https://config-service.workers.dev'
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
}

export default new ApiService()
