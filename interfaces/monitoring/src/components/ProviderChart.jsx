import { Doughnut } from 'react-chartjs-2'

function ProviderChart({ data }) {
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          padding: 15,
          font: {
            size: 12
          },
          usePointStyle: true,
          pointStyle: 'circle'
        }
      },
      tooltip: {
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        padding: 12,
        titleFont: {
          size: 14,
          weight: 'bold'
        },
        bodyFont: {
          size: 13
        },
        callbacks: {
          label: function(context) {
            const label = context.label || ''
            const value = context.parsed || 0
            const total = context.dataset.data.reduce((a, b) => a + b, 0)
            const percentage = ((value / total) * 100).toFixed(1)
            return `${label}: ${value.toLocaleString()} (${percentage}%)`
          }
        }
      }
    },
    cutout: '65%'
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Provider Distribution</h3>
          <p className="text-sm text-gray-600">Requests by AI provider</p>
        </div>
        <div className="bg-purple-50 text-purple-700 px-3 py-1 rounded-full text-sm font-medium">
          <svg className="w-4 h-4 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
          </svg>
          Analysis
        </div>
      </div>

      <div className="h-64 flex items-center justify-center">
        {data && data.labels && data.datasets ? (
          <Doughnut data={data} options={options} />
        ) : (
          <div className="text-center text-gray-400">
            <svg className="w-12 h-12 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
            </svg>
            <p>No data available</p>
          </div>
        )}
      </div>

      {/* Provider Details */}
      <div className="mt-4 pt-4 border-t border-gray-200">
        <p className="text-xs text-gray-600 mb-3">Provider Performance</p>
        <div className="space-y-3">
          {data?.labels?.map((label, index) => {
            const value = data?.datasets?.[0]?.data?.[index] || 0
            const total = data?.datasets?.[0]?.data?.reduce((a, b) => a + b, 0) || 1
            const percentage = ((value / total) * 100).toFixed(1)
            const color = data?.datasets?.[0]?.backgroundColor?.[index] || '#3B82F6'

            return (
              <div key={index}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: color }}
                    ></div>
                    <span className="text-sm text-gray-700">{label}</span>
                  </div>
                  <span className="text-sm text-gray-900 font-medium">
                    {value.toLocaleString()}
                  </span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div
                    className="h-2 rounded-full transition-all duration-300"
                    style={{
                      width: `${percentage}%`,
                      backgroundColor: color
                    }}
                  ></div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Average response time by provider */}
      <div className="mt-4 pt-4 border-t border-gray-200">
        <p className="text-xs text-gray-600 mb-2">Avg Response Time</p>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-blue-50 rounded p-2">
            <p className="text-xs text-blue-600">Ideogram</p>
            <p className="text-sm font-semibold text-blue-900">245ms</p>
          </div>
          <div className="bg-green-50 rounded p-2">
            <p className="text-xs text-green-600">Replicate</p>
            <p className="text-sm font-semibold text-green-900">312ms</p>
          </div>
          <div className="bg-yellow-50 rounded p-2">
            <p className="text-xs text-yellow-600">Stability AI</p>
            <p className="text-sm font-semibold text-yellow-900">198ms</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ProviderChart
