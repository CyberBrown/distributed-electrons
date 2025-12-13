import { useState, useEffect } from 'react'
import api from '../services/api'
import ApiKeyModal from '../components/ApiKeyModal'
import { providers, getProviderById } from '../config/providers'
import { maskApiKey } from '../utils/maskKey'

export default function Instances() {
  const [instances, setInstances] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [expandedInstance, setExpandedInstance] = useState(null)

  useEffect(() => {
    loadInstances()
  }, [])

  const loadInstances = async () => {
    try {
      setLoading(true)
      const data = await api.getInstances()
      setInstances(data.instances)
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (instanceId) => {
    if (!confirm(`Are you sure you want to delete instance "${instanceId}"?`)) {
      return
    }

    try {
      await api.deleteInstance(instanceId)
      loadInstances()
    } catch (err) {
      alert(`Error deleting instance: ${err.message}`)
    }
  }

  const toggleExpand = (instanceId) => {
    setExpandedInstance(expandedInstance === instanceId ? null : instanceId)
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
          <h1 className="text-3xl font-bold text-gray-900">Instances</h1>
          <p className="mt-2 text-sm text-gray-700">
            Manage your Cloudflare Worker instances and API keys
          </p>
        </div>
        <div className="mt-4 sm:mt-0">
          <button
            onClick={() => setShowCreateModal(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-medium transition"
          >
            Create Instance
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border-l-4 border-red-400 p-4 mb-6">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      <div className="space-y-4">
        {instances.map((instance) => (
          <InstanceCard
            key={instance.instance_id}
            instance={instance}
            expanded={expandedInstance === instance.instance_id}
            onToggleExpand={() => toggleExpand(instance.instance_id)}
            onDelete={() => handleDelete(instance.instance_id)}
            onUpdate={loadInstances}
          />
        ))}

        {instances.length === 0 && !loading && (
          <div className="bg-white rounded-lg shadow-sm p-12 text-center">
            <p className="text-gray-500">No instances found</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="mt-4 text-blue-600 hover:text-blue-800 font-medium"
            >
              Create your first instance
            </button>
          </div>
        )}
      </div>

      {showCreateModal && (
        <CreateInstanceModal
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false)
            loadInstances()
          }}
        />
      )}
    </div>
  )
}

function InstanceCard({ instance, expanded, onToggleExpand, onDelete, onUpdate }) {
  const [showApiKeyModal, setShowApiKeyModal] = useState(false)
  const [editingProvider, setEditingProvider] = useState(null)

  const apiKeys = instance.api_keys || {}
  const configuredProviders = Object.keys(apiKeys)

  const handleAddKey = () => {
    setEditingProvider(null)
    setShowApiKeyModal(true)
  }

  const handleEditKey = (providerId) => {
    setEditingProvider(providerId)
    setShowApiKeyModal(true)
  }

  const handleSaveKey = async (providerId, apiKey) => {
    try {
      await api.updateProviderApiKey(instance.instance_id, providerId, apiKey)
      onUpdate()
    } catch (err) {
      alert(`Error saving API key: ${err.message}`)
    }
  }

  const handleDeleteKey = async (providerId) => {
    const providerName = getProviderById(providerId)?.name || providerId
    if (!confirm(`Are you sure you want to delete the ${providerName} API key?`)) {
      return
    }

    try {
      await api.deleteProviderApiKey(instance.instance_id, providerId)
      onUpdate()
    } catch (err) {
      alert(`Error deleting API key: ${err.message}`)
    }
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <div className="flex items-center space-x-3">
              <h3 className="text-lg font-semibold text-gray-900">{instance.name}</h3>
              <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                instance.status === 'active'
                  ? 'bg-green-100 text-green-800'
                  : 'bg-gray-100 text-gray-800'
              }`}>
                {instance.status}
              </span>
              <span className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded-full">
                {configuredProviders.length} provider{configuredProviders.length !== 1 ? 's' : ''}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              Instance ID: <code className="text-xs bg-gray-100 px-2 py-0.5 rounded">{instance.instance_id}</code>
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={onToggleExpand}
              className="px-3 py-1.5 text-sm bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-md transition"
            >
              {expanded ? 'Collapse' : 'Expand'}
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
        <div className="border-t border-gray-200 bg-gray-50 px-6 py-4">
          {/* API Keys Section */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-sm font-semibold text-gray-900">API Keys</h4>
              <button
                onClick={handleAddKey}
                className="text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                + Add API Key
              </button>
            </div>

            {configuredProviders.length === 0 ? (
              <div className="bg-white border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                <p className="text-gray-500 text-sm mb-3">No API keys configured</p>
                <button
                  onClick={handleAddKey}
                  className="text-blue-600 hover:text-blue-800 font-medium text-sm"
                >
                  Add your first API key
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {configuredProviders.map(providerId => {
                  const provider = getProviderById(providerId)
                  const maskedKey = maskApiKey(apiKeys[providerId])

                  return (
                    <div key={providerId} className="bg-white border border-gray-200 rounded-md p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3 flex-1">
                          <span className="text-2xl">{provider?.icon || '🔑'}</span>
                          <div>
                            <div className="font-medium text-gray-900">
                              {provider?.name || providerId}
                            </div>
                            <div className="text-sm text-gray-500 font-mono">
                              {maskedKey}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => handleEditKey(providerId)}
                            className="text-sm text-blue-600 hover:text-blue-800"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteKey(providerId)}
                            className="text-sm text-red-600 hover:text-red-800"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Instance Details */}
          <div className="mt-6 pt-6 border-t border-gray-200">
            <h4 className="text-sm font-semibold text-gray-900 mb-3">Instance Details</h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500">Organization:</span>
                <span className="ml-2 text-gray-900">{instance.org_id}</span>
              </div>
              <div>
                <span className="text-gray-500">R2 Bucket:</span>
                <span className="ml-2 text-gray-900">{instance.r2_bucket}</span>
              </div>
              <div>
                <span className="text-gray-500">Created:</span>
                <span className="ml-2 text-gray-900">
                  {new Date(instance.created_at).toLocaleDateString()}
                </span>
              </div>
              <div>
                <span className="text-gray-500">Authorized Users:</span>
                <span className="ml-2 text-gray-900">{instance.authorized_users?.length || 0}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* API Key Modal */}
      {showApiKeyModal && (
        <ApiKeyModal
          isOpen={showApiKeyModal}
          onClose={() => setShowApiKeyModal(false)}
          onSave={handleSaveKey}
          provider={editingProvider}
          existingKey={editingProvider ? apiKeys[editingProvider] : null}
        />
      )}
    </div>
  )
}

function CreateInstanceModal({ onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    instance_id: '',
    name: '',
    org_id: 'your-org-id',
    r2_bucket: '',
    rate_limits: {
      ideogram: {
        rpm: 100,
        tpm: 50000
      }
    }
  })
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)

    try {
      await api.createInstance(formData)
      onSuccess()
    } catch (err) {
      alert(`Error creating instance: ${err.message}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-8 max-w-md w-full">
        <h2 className="text-2xl font-bold mb-4">Create Instance</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Instance ID</label>
            <input
              type="text"
              required
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              value={formData.instance_id}
              onChange={(e) => setFormData({ ...formData, instance_id: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Name</label>
            <input
              type="text"
              required
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">R2 Bucket</label>
            <input
              type="text"
              required
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              value={formData.r2_bucket}
              onChange={(e) => setFormData({ ...formData, r2_bucket: e.target.value })}
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-medium disabled:bg-gray-400"
            >
              {submitting ? 'Creating...' : 'Create'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 px-4 py-2 rounded-md font-medium"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
