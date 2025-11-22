// Monitoring API Service with Mock Data Support

const USE_MOCK = true // Toggle for parallel development

// Helper to generate time series data
const generateTimeSeriesData = (hours = 24, baseValue = 100, variance = 0.3) => {
  return Array.from({ length: hours }, (_, i) => {
    const timestamp = new Date(Date.now() - (hours - 1 - i) * 60 * 60 * 1000)
    const variation = (Math.random() - 0.5) * variance * baseValue
    const value = Math.max(0, baseValue + variation)

    return {
      timestamp: timestamp.toISOString(),
      value: Math.round(value)
    }
  })
}

// Helper to simulate API delay
const delay = (ms = 500) => new Promise(resolve => setTimeout(resolve, ms))

// Generate mock metrics data
const generateMockMetrics = (instance, timeRange) => {
  const hours = timeRange === '24h' ? 24 : timeRange === '7d' ? 168 : timeRange === '30d' ? 720 : 1

  // Generate time series for different metrics
  const requestsData = generateTimeSeriesData(hours, 150, 0.4)
  const errorsData = generateTimeSeriesData(hours, 5, 0.6)

  // Calculate totals
  const totalRequests = requestsData.reduce((sum, d) => sum + d.value, 0)
  const totalErrors = errorsData.reduce((sum, d) => sum + d.value, 0)
  const errorRate = totalRequests > 0 ? (totalErrors / totalRequests * 100).toFixed(2) : 0

  // Provider distribution
  const providers = [
    { name: 'Ideogram', requests: Math.floor(totalRequests * 0.45), errors: Math.floor(totalErrors * 0.3), color: '#3B82F6' },
    { name: 'Replicate', requests: Math.floor(totalRequests * 0.35), errors: Math.floor(totalErrors * 0.4), color: '#10B981' },
    { name: 'Stability AI', requests: Math.floor(totalRequests * 0.20), errors: Math.floor(totalErrors * 0.3), color: '#F59E0B' }
  ]

  // Rate limit data
  const rateLimitData = generateTimeSeriesData(hours, 80, 0.2).map(d => ({
    ...d,
    limit: 100,
    usage: d.value
  }))

  // Calculate average response time
  const avgResponseTime = (Math.random() * 500 + 200).toFixed(0)

  return {
    timestamp: new Date().toISOString(),
    instance,
    timeRange,
    stats: {
      totalRequests,
      totalErrors,
      errorRate: parseFloat(errorRate),
      avgResponseTime: parseInt(avgResponseTime),
      successRate: (100 - parseFloat(errorRate)).toFixed(2)
    },
    requests: {
      labels: requestsData.map(d => new Date(d.timestamp).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      })),
      datasets: [{
        label: 'Requests',
        data: requestsData.map(d => d.value),
        borderColor: '#3B82F6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        fill: true,
        tension: 0.4
      }]
    },
    errors: {
      labels: errorsData.map(d => new Date(d.timestamp).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      })),
      datasets: [{
        label: 'Errors',
        data: errorsData.map(d => d.value),
        borderColor: '#EF4444',
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        fill: true,
        tension: 0.4
      }]
    },
    providers: {
      labels: providers.map(p => p.name),
      datasets: [{
        label: 'Requests by Provider',
        data: providers.map(p => p.requests),
        backgroundColor: providers.map(p => p.color),
        borderWidth: 0
      }]
    },
    rateLimits: {
      labels: rateLimitData.map(d => new Date(d.timestamp).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      })),
      datasets: [
        {
          label: 'Usage',
          data: rateLimitData.map(d => d.usage),
          borderColor: '#8B5CF6',
          backgroundColor: 'rgba(139, 92, 246, 0.1)',
          fill: true,
          tension: 0.4
        },
        {
          label: 'Limit',
          data: rateLimitData.map(d => d.limit),
          borderColor: '#EF4444',
          borderDash: [5, 5],
          fill: false,
          tension: 0
        }
      ]
    }
  }
}

// API Service
class MonitoringApiService {
  constructor() {
    this.baseUrl = 'https://config-service.solamp.workers.dev'
  }

  getAuthHeader() {
    const apiKey = localStorage.getItem('monitoringApiKey')
    return {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  }

  async getAllMetrics(instance = 'production', timeRange = '24h') {
    if (USE_MOCK) {
      await delay(800) // Simulate network delay
      return generateMockMetrics(instance, timeRange)
    }

    const params = new URLSearchParams({ instance, timeRange })
    const response = await fetch(`${this.baseUrl}/api/monitoring/metrics?${params}`, {
      headers: this.getAuthHeader()
    })

    if (!response.ok) throw new Error('Failed to fetch metrics')
    return await response.json()
  }

  async getRequestMetrics(instance = 'production', timeRange = '24h') {
    if (USE_MOCK) {
      await delay()
      const metrics = generateMockMetrics(instance, timeRange)
      return { requests: metrics.requests }
    }

    const params = new URLSearchParams({ instance, timeRange })
    const response = await fetch(`${this.baseUrl}/api/monitoring/requests?${params}`, {
      headers: this.getAuthHeader()
    })

    if (!response.ok) throw new Error('Failed to fetch request metrics')
    return await response.json()
  }

  async getErrorMetrics(instance = 'production', timeRange = '24h') {
    if (USE_MOCK) {
      await delay()
      const metrics = generateMockMetrics(instance, timeRange)
      return { errors: metrics.errors }
    }

    const params = new URLSearchParams({ instance, timeRange })
    const response = await fetch(`${this.baseUrl}/api/monitoring/errors?${params}`, {
      headers: this.getAuthHeader()
    })

    if (!response.ok) throw new Error('Failed to fetch error metrics')
    return await response.json()
  }

  async getProviderMetrics(instance = 'production', timeRange = '24h') {
    if (USE_MOCK) {
      await delay()
      const metrics = generateMockMetrics(instance, timeRange)
      return { providers: metrics.providers }
    }

    const params = new URLSearchParams({ instance, timeRange })
    const response = await fetch(`${this.baseUrl}/api/monitoring/providers?${params}`, {
      headers: this.getAuthHeader()
    })

    if (!response.ok) throw new Error('Failed to fetch provider metrics')
    return await response.json()
  }

  async getRateLimitMetrics(instance = 'production', timeRange = '24h') {
    if (USE_MOCK) {
      await delay()
      const metrics = generateMockMetrics(instance, timeRange)
      return { rateLimits: metrics.rateLimits }
    }

    const params = new URLSearchParams({ instance, timeRange })
    const response = await fetch(`${this.baseUrl}/api/monitoring/rate-limits?${params}`, {
      headers: this.getAuthHeader()
    })

    if (!response.ok) throw new Error('Failed to fetch rate limit metrics')
    return await response.json()
  }
}

export default new MonitoringApiService()
