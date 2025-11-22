import { useState, useEffect } from 'react'
import { providers } from '../config/providers'

export default function ModelConfigModal({ isOpen, onClose, onSave, existingConfig = null }) {
  const [formData, setFormData] = useState({
    model_id: '',
    provider_id: '',
    display_name: '',
    description: '',
    status: 'active',
    capabilities: {
      image: false,
      video: false,
      text: false,
      audio: false,
      inpainting: false,
      upscaling: false,
    },
    pricing: {
      cost_per_image: '',
      cost_per_video: '',
      cost_per_1k_tokens: '',
      currency: 'USD',
    },
    rate_limits: {
      rpm: '',
      tpm: '',
    },
    payload_mapping: {
      endpoint: '',
      method: 'POST',
      headers: {},
      body: {},
      response_mapping: {},
      defaults: {},
    },
  })
  const [errors, setErrors] = useState({})
  const [payloadMappingJson, setPayloadMappingJson] = useState('')
  const [headersJson, setHeadersJson] = useState('')
  const [bodyJson, setBodyJson] = useState('')
  const [responseMappingJson, setResponseMappingJson] = useState('')
  const [defaultsJson, setDefaultsJson] = useState('')

  useEffect(() => {
    if (isOpen) {
      if (existingConfig) {
        setFormData({
          model_id: existingConfig.model_id,
          provider_id: existingConfig.provider_id,
          display_name: existingConfig.display_name,
          description: existingConfig.description || '',
          status: existingConfig.status,
          capabilities: existingConfig.capabilities,
          pricing: existingConfig.pricing || { currency: 'USD' },
          rate_limits: existingConfig.rate_limits || {},
          payload_mapping: existingConfig.payload_mapping,
        })
        setHeadersJson(JSON.stringify(existingConfig.payload_mapping.headers, null, 2))
        setBodyJson(JSON.stringify(existingConfig.payload_mapping.body, null, 2))
        setResponseMappingJson(JSON.stringify(existingConfig.payload_mapping.response_mapping, null, 2))
        setDefaultsJson(JSON.stringify(existingConfig.payload_mapping.defaults || {}, null, 2))
      } else {
        // Reset form
        setFormData({
          model_id: '',
          provider_id: '',
          display_name: '',
          description: '',
          status: 'active',
          capabilities: {
            image: false,
            video: false,
            text: false,
            audio: false,
          },
          pricing: { currency: 'USD' },
          rate_limits: {},
          payload_mapping: {
            endpoint: '',
            method: 'POST',
            headers: {},
            body: {},
            response_mapping: {},
            defaults: {},
          },
        })
        setHeadersJson('{\n  "Authorization": "Bearer {api_key}",\n  "Content-Type": "application/json"\n}')
        setBodyJson('{\n  "prompt": "{user_prompt}"\n}')
        setResponseMappingJson('{\n  "image_url": "$.data[0].url"\n}')
        setDefaultsJson('{}')
      }
      setErrors({})
    }
  }, [isOpen, existingConfig])

  if (!isOpen) return null

  const isEditing = !!existingConfig

  const handleSubmit = async (e) => {
    e.preventDefault()
    setErrors({})

    // Validate required fields
    const newErrors = {}
    if (!formData.model_id) newErrors.model_id = 'Model ID is required'
    if (!formData.provider_id) newErrors.provider_id = 'Provider is required'
    if (!formData.display_name) newErrors.display_name = 'Display name is required'
    if (!formData.payload_mapping.endpoint) newErrors.endpoint = 'API endpoint is required'

    // Validate model_id format
    if (formData.model_id && !/^[a-z0-9-]+$/.test(formData.model_id)) {
      newErrors.model_id = 'Model ID must be lowercase alphanumeric with hyphens only'
    }

    // Validate at least one capability
    const hasCapability = Object.values(formData.capabilities).some(v => v === true)
    if (!hasCapability) {
      newErrors.capabilities = 'At least one capability must be selected'
    }

    // Parse and validate JSON fields
    try {
      const headers = JSON.parse(headersJson)
      const body = JSON.parse(bodyJson)
      const response_mapping = JSON.parse(responseMappingJson)
      const defaults = JSON.parse(defaultsJson)

      formData.payload_mapping = {
        endpoint: formData.payload_mapping.endpoint,
        method: formData.payload_mapping.method,
        headers,
        body,
        response_mapping,
        defaults,
      }
    } catch (err) {
      newErrors.payload_mapping = 'Invalid JSON in payload mapping fields'
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    // Clean up pricing (remove empty fields)
    const pricing = {}
    if (formData.pricing.cost_per_image) pricing.cost_per_image = parseFloat(formData.pricing.cost_per_image)
    if (formData.pricing.cost_per_video) pricing.cost_per_video = parseFloat(formData.pricing.cost_per_video)
    if (formData.pricing.cost_per_1k_tokens) pricing.cost_per_1k_tokens = parseFloat(formData.pricing.cost_per_1k_tokens)
    if (Object.keys(pricing).length > 0) {
      pricing.currency = formData.pricing.currency || 'USD'
    }

    // Clean up rate limits
    const rate_limits = {}
    if (formData.rate_limits.rpm) rate_limits.rpm = parseInt(formData.rate_limits.rpm)
    if (formData.rate_limits.tpm) rate_limits.tpm = parseInt(formData.rate_limits.tpm)

    const submitData = {
      ...formData,
      pricing: Object.keys(pricing).length > 0 ? pricing : undefined,
      rate_limits: Object.keys(rate_limits).length > 0 ? rate_limits : undefined,
    }

    try {
      await onSave(submitData)
      onClose()
    } catch (err) {
      setErrors({ submit: err.message })
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 rounded-t-lg sticky top-0 z-10">
          <h2 className="text-xl font-bold text-white">
            {isEditing ? `Edit ${existingConfig.display_name}` : 'Add Model Configuration'}
          </h2>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Basic Info */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Basic Information</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Model ID * <span className="text-xs text-gray-500">(lowercase-with-hyphens)</span>
                </label>
                <input
                  type="text"
                  value={formData.model_id}
                  onChange={(e) => setFormData({ ...formData, model_id: e.target.value })}
                  disabled={isEditing}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                  placeholder="gemini-veo-3.1"
                />
                {errors.model_id && <p className="text-xs text-red-600 mt-1">{errors.model_id}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Provider *</label>
                <select
                  value={formData.provider_id}
                  onChange={(e) => setFormData({ ...formData, provider_id: e.target.value })}
                  disabled={isEditing}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                >
                  <option value="">Select provider...</option>
                  {providers.map(p => (
                    <option key={p.id} value={p.id}>{p.icon} {p.name}</option>
                  ))}
                </select>
                {errors.provider_id && <p className="text-xs text-red-600 mt-1">{errors.provider_id}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Display Name *</label>
                <input
                  type="text"
                  value={formData.display_name}
                  onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Gemini Veo 3.1"
                />
                {errors.display_name && <p className="text-xs text-red-600 mt-1">{errors.display_name}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status *</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="active">Active</option>
                  <option value="beta">Beta</option>
                  <option value="deprecated">Deprecated</option>
                </select>
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows="2"
                  placeholder="Brief description of the model..."
                />
              </div>
            </div>
          </div>

          {/* Capabilities */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Capabilities *</h3>
            <div className="grid grid-cols-4 gap-3">
              {Object.keys(formData.capabilities).map(cap => (
                <label key={cap} className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.capabilities[cap] || false}
                    onChange={(e) => setFormData({
                      ...formData,
                      capabilities: { ...formData.capabilities, [cap]: e.target.checked }
                    })}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700 capitalize">{cap.replace('_', ' ')}</span>
                </label>
              ))}
            </div>
            {errors.capabilities && <p className="text-xs text-red-600 mt-1">{errors.capabilities}</p>}
          </div>

          {/* Pricing */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Pricing (Optional)</h3>
            <div className="grid grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Cost/Image</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.pricing.cost_per_image || ''}
                  onChange={(e) => setFormData({
                    ...formData,
                    pricing: { ...formData.pricing, cost_per_image: e.target.value }
                  })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0.08"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Cost/Video</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.pricing.cost_per_video || ''}
                  onChange={(e) => setFormData({
                    ...formData,
                    pricing: { ...formData.pricing, cost_per_video: e.target.value }
                  })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0.50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Cost/1K Tokens</label>
                <input
                  type="number"
                  step="0.001"
                  value={formData.pricing.cost_per_1k_tokens || ''}
                  onChange={(e) => setFormData({
                    ...formData,
                    pricing: { ...formData.pricing, cost_per_1k_tokens: e.target.value }
                  })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0.01"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
                <input
                  type="text"
                  value={formData.pricing.currency || 'USD'}
                  onChange={(e) => setFormData({
                    ...formData,
                    pricing: { ...formData.pricing, currency: e.target.value }
                  })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="USD"
                />
              </div>
            </div>
          </div>

          {/* Rate Limits */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Rate Limits (Optional)</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Requests/Minute</label>
                <input
                  type="number"
                  value={formData.rate_limits.rpm || ''}
                  onChange={(e) => setFormData({
                    ...formData,
                    rate_limits: { ...formData.rate_limits, rpm: e.target.value }
                  })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tokens/Minute</label>
                <input
                  type="number"
                  value={formData.rate_limits.tpm || ''}
                  onChange={(e) => setFormData({
                    ...formData,
                    rate_limits: { ...formData.rate_limits, tpm: e.target.value }
                  })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="50000"
                />
              </div>
            </div>
          </div>

          {/* Payload Mapping */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Payload Mapping *</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Endpoint *</label>
                  <input
                    type="text"
                    value={formData.payload_mapping.endpoint}
                    onChange={(e) => setFormData({
                      ...formData,
                      payload_mapping: { ...formData.payload_mapping, endpoint: e.target.value }
                    })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="/v1/generate"
                  />
                  {errors.endpoint && <p className="text-xs text-red-600 mt-1">{errors.endpoint}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Method</label>
                  <select
                    value={formData.payload_mapping.method}
                    onChange={(e) => setFormData({
                      ...formData,
                      payload_mapping: { ...formData.payload_mapping, method: e.target.value }
                    })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                    <option value="PATCH">PATCH</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Headers (JSON) *
                </label>
                <textarea
                  value={headersJson}
                  onChange={(e) => setHeadersJson(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows="3"
                  placeholder='{"Authorization": "Bearer {api_key}"}'
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Body (JSON) *
                </label>
                <textarea
                  value={bodyJson}
                  onChange={(e) => setBodyJson(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows="5"
                  placeholder='{"prompt": "{user_prompt}"}'
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Response Mapping (JSON) *
                </label>
                <textarea
                  value={responseMappingJson}
                  onChange={(e) => setResponseMappingJson(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows="3"
                  placeholder='{"image_url": "$.data[0].url"}'
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Defaults (JSON, Optional)
                </label>
                <textarea
                  value={defaultsJson}
                  onChange={(e) => setDefaultsJson(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows="2"
                  placeholder='{"aspect_ratio": "1:1"}'
                />
              </div>
            </div>
            {errors.payload_mapping && <p className="text-xs text-red-600 mt-1">{errors.payload_mapping}</p>}
          </div>

          {errors.submit && (
            <div className="bg-red-50 border border-red-200 rounded-md p-3">
              <p className="text-sm text-red-800">{errors.submit}</p>
            </div>
          )}

          {/* Footer */}
          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-100 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition"
            >
              {isEditing ? 'Update Configuration' : 'Create Configuration'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
