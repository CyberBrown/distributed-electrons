import { useState, useEffect } from 'react'
import api from '../services/api'

export default function Instances() {
  const [instances, setInstances] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingInstance, setEditingInstance] = useState(null)

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
            Manage your Cloudflare Worker instances
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

      <div className="bg-white shadow overflow-hidden sm:rounded-lg">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Instance ID
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Rate Limit
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {instances.map((instance) => (
              <tr key={instance.instance_id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                  {instance.instance_id}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {instance.name}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                    instance.status === 'active'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-gray-100 text-gray-800'
                  }`}>
                    {instance.status}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {instance.rate_limits?.ideogram?.rpm || 0} rpm
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                  <button
                    onClick={() => setEditingInstance(instance)}
                    className="text-blue-600 hover:text-blue-900 mr-4"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(instance.instance_id)}
                    className="text-red-600 hover:text-red-900"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {instances.length === 0 && !loading && (
          <div className="text-center py-12">
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

      {editingInstance && (
        <EditInstanceModal
          instance={editingInstance}
          onClose={() => setEditingInstance(null)}
          onSuccess={() => {
            setEditingInstance(null)
            loadInstances()
          }}
        />
      )}
    </div>
  )
}

function CreateInstanceModal({ onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    instance_id: '',
    name: '',
    org_id: 'solamp',
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
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              value={formData.instance_id}
              onChange={(e) => setFormData({ ...formData, instance_id: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Name</label>
            <input
              type="text"
              required
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">R2 Bucket</label>
            <input
              type="text"
              required
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              value={formData.r2_bucket}
              onChange={(e) => setFormData({ ...formData, r2_bucket: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Rate Limit (RPM)</label>
            <input
              type="number"
              required
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              value={formData.rate_limits.ideogram.rpm}
              onChange={(e) => setFormData({
                ...formData,
                rate_limits: {
                  ideogram: {
                    ...formData.rate_limits.ideogram,
                    rpm: parseInt(e.target.value)
                  }
                }
              })}
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

function EditInstanceModal({ instance, onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    rate_limits: instance.rate_limits
  })
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)

    try {
      await api.updateInstance(instance.instance_id, formData)
      onSuccess()
    } catch (err) {
      alert(`Error updating instance: ${err.message}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-8 max-w-md w-full">
        <h2 className="text-2xl font-bold mb-4">Edit Instance: {instance.instance_id}</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Rate Limit (RPM)</label>
            <input
              type="number"
              required
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              value={formData.rate_limits.ideogram.rpm}
              onChange={(e) => setFormData({
                ...formData,
                rate_limits: {
                  ideogram: {
                    ...formData.rate_limits.ideogram,
                    rpm: parseInt(e.target.value)
                  }
                }
              })}
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-medium disabled:bg-gray-400"
            >
              {submitting ? 'Saving...' : 'Save'}
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
