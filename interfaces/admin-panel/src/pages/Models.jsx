import { useState, useEffect } from 'react'
import api from '../services/api'
import ModelConfigModal from '../components/ModelConfigModal'

export default function Models() {
  const [modelConfigs, setModelConfigs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingConfig, setEditingConfig] = useState(null)
  const [expandedModel, setExpandedModel] = useState(null)

  useEffect(() => {
    loadModelConfigs()
  }, [])

  const loadModelConfigs = async () => {
    try {
      setLoading(true)
      const data = await api.getModelConfigs()
      setModelConfigs(data.configs || [])
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = () => {
    setEditingConfig(null)
    setShowCreateModal(true)
  }

  const handleEdit = (config) => {
    setEditingConfig(config)
    setShowCreateModal(true)
  }

  const handleDelete = async (configId, modelName) => {
    if (!confirm(`Are you sure you want to delete the "${modelName}" model configuration?`)) {
      return
    }

    try {
      await api.deleteModelConfig(configId)
      loadModelConfigs()
    } catch (err) {
      alert(`Error deleting model config: ${err.message}`)
    }
  }

  const handleSave = async (configData) => {
    try {
      if (editingConfig) {
        await api.updateModelConfig(editingConfig.config_id, configData)
      } else {
        await api.createModelConfig(configData)
      }
      setShowCreateModal(false)
      loadModelConfigs()
    } catch (err) {
      throw err
    }
  }

  // Group models by provider
  const modelsByProvider = modelConfigs.reduce((acc, config) => {
    if (!acc[config.provider_id]) {
      acc[config.provider_id] = []
    }
    acc[config.provider_id].push(config)
    return acc
  }, {})

  const providerIcons = {
    ideogram: '🎨',
    openai: '🤖',
    anthropic: '🧠',
    gemini: '✨',
  }

  const providerNames = {
    ideogram: 'Ideogram',
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    gemini: 'Google Gemini',
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div>
      <div className="sm:flex sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Model Configurations</h1>
          <p className="mt-2 text-sm text-gray-700">
            Manage AI model configurations, capabilities, and payload mappings
          </p>
        </div>
        <div className="mt-4 sm:mt-0">
          <button
            onClick={handleCreate}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-medium transition"
          >
            + Add Model Config
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border-l-4 border-red-400 p-4 mb-6">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {Object.keys(modelsByProvider).length === 0 && !loading && (
        <div className="bg-white rounded-lg shadow-sm p-12 text-center">
          <p className="text-gray-500 mb-4">No model configurations found</p>
          <button
            onClick={handleCreate}
            className="text-blue-600 hover:text-blue-800 font-medium"
          >
            Create your first model configuration
          </button>
        </div>
      )}

      <div className="space-y-8">
        {Object.entries(modelsByProvider).map(([providerId, models]) => (
          <div key={providerId} className="bg-white shadow-md rounded-lg overflow-hidden">
            {/* Provider Header */}
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4">
              <div className="flex items-center space-x-3">
                <span className="text-4xl">{providerIcons[providerId] || '🔧'}</span>
                <div>
                  <h2 className="text-xl font-bold text-white">
                    {providerNames[providerId] || providerId}
                  </h2>
                  <p className="text-blue-100 text-sm">
                    {models.length} model{models.length !== 1 ? 's' : ''} configured
                  </p>
                </div>
              </div>
            </div>

            {/* Models List */}
            <div className="p-6 space-y-4">
              {models.map(config => (
                <ModelCard
                  key={config.config_id}
                  config={config}
                  expanded={expandedModel === config.config_id}
                  onToggleExpand={() => setExpandedModel(
                    expandedModel === config.config_id ? null : config.config_id
                  )}
                  onEdit={() => handleEdit(config)}
                  onDelete={() => handleDelete(config.config_id, config.display_name)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {showCreateModal && (
        <ModelConfigModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSave={handleSave}
          existingConfig={editingConfig}
        />
      )}
    </div>
  )
}

function ModelCard({ config, expanded, onToggleExpand, onEdit, onDelete }) {
  const statusColors = {
    active: 'bg-green-100 text-green-800',
    beta: 'bg-yellow-100 text-yellow-800',
    deprecated: 'bg-red-100 text-red-800',
  }

  const capabilityIcons = {
    image: '🖼️',
    video: '🎥',
    text: '📝',
    audio: '🔊',
    inpainting: '🎨',
    upscaling: '⬆️',
  }

  const capabilities = Object.entries(config.capabilities)
    .filter(([_, enabled]) => enabled)
    .map(([cap]) => cap)

  return (
    <div className="border border-gray-200 rounded-lg">
      {/* Card Header */}
      <div className="px-4 py-3 bg-gray-50">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <div className="flex items-center space-x-3">
              <h3 className="text-lg font-semibold text-gray-900">{config.display_name}</h3>
              <span className={`px-2 py-1 text-xs font-semibold rounded-full ${statusColors[config.status]}`}>
                {config.status}
              </span>
              {capabilities.length > 0 && (
                <div className="flex items-center space-x-1">
                  {capabilities.map(cap => (
                    <span key={cap} title={cap} className="text-lg">
                      {capabilityIcons[cap] || '🔧'}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <p className="text-sm text-gray-500 mt-1">
              Model ID: <code className="text-xs bg-gray-200 px-2 py-0.5 rounded">{config.model_id}</code>
            </p>
            {config.description && (
              <p className="text-sm text-gray-600 mt-1">{config.description}</p>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={onToggleExpand}
              className="px-3 py-1.5 text-sm bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-md transition"
            >
              {expanded ? 'Collapse' : 'Expand'}
            </button>
            <button
              onClick={onEdit}
              className="px-3 py-1.5 text-sm bg-gray-50 text-gray-700 hover:bg-gray-100 rounded-md transition"
            >
              Edit
            </button>
            <button
              onClick={onDelete}
              className="px-3 py-1.5 text-sm bg-red-50 text-red-700 hover:bg-red-100 rounded-md transition"
            >
              Delete
            </button>
          </div>
        </div>
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="px-4 py-4 space-y-4 border-t border-gray-200">
          {/* Metadata Grid */}
          <div className="grid grid-cols-2 gap-4">
            {/* Pricing */}
            {config.pricing && (
              <div>
                <h4 className="text-sm font-semibold text-gray-900 mb-2">Pricing</h4>
                <div className="text-sm text-gray-700 space-y-1">
                  {config.pricing.cost_per_image && (
                    <div>Cost per image: ${config.pricing.cost_per_image} {config.pricing.currency || 'USD'}</div>
                  )}
                  {config.pricing.cost_per_video && (
                    <div>Cost per video: ${config.pricing.cost_per_video} {config.pricing.currency || 'USD'}</div>
                  )}
                  {config.pricing.cost_per_1k_tokens && (
                    <div>Cost per 1K tokens: ${config.pricing.cost_per_1k_tokens} {config.pricing.currency || 'USD'}</div>
                  )}
                  {config.pricing.notes && (
                    <div className="text-xs text-gray-500 italic">{config.pricing.notes}</div>
                  )}
                </div>
              </div>
            )}

            {/* Rate Limits */}
            {config.rate_limits && (
              <div>
                <h4 className="text-sm font-semibold text-gray-900 mb-2">Rate Limits</h4>
                <div className="text-sm text-gray-700 space-y-1">
                  {config.rate_limits.rpm && <div>Requests/min: {config.rate_limits.rpm}</div>}
                  {config.rate_limits.tpm && <div>Tokens/min: {config.rate_limits.tpm}</div>}
                  {config.rate_limits.concurrent_requests && (
                    <div>Concurrent: {config.rate_limits.concurrent_requests}</div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Payload Mapping */}
          <div>
            <h4 className="text-sm font-semibold text-gray-900 mb-2">Payload Mapping</h4>
            <div className="bg-gray-900 rounded-md p-4 overflow-x-auto">
              <pre className="text-xs text-gray-100">
                {JSON.stringify(config.payload_mapping, null, 2)}
              </pre>
            </div>
          </div>

          {/* Timestamps */}
          <div className="text-xs text-gray-500 pt-2 border-t border-gray-200">
            Created: {new Date(config.created_at).toLocaleString()} •
            Updated: {new Date(config.updated_at).toLocaleString()}
          </div>
        </div>
      )}
    </div>
  )
}
