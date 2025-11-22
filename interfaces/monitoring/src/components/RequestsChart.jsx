import { Line } from 'react-chartjs-2'

function RequestsChart({ data }) {
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false
      },
      title: {
        display: false
      },
      tooltip: {
        mode: 'index',
        intersect: false,
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
            return `Requests: ${context.parsed.y}`
          }
        }
      }
    },
    scales: {
      x: {
        grid: {
          display: false
        },
        ticks: {
          maxRotation: 45,
          minRotation: 45,
          font: {
            size: 10
          }
        }
      },
      y: {
        beginAtZero: true,
        grid: {
          color: 'rgba(0, 0, 0, 0.05)'
        },
        ticks: {
          font: {
            size: 11
          }
        }
      }
    },
    interaction: {
      mode: 'nearest',
      axis: 'x',
      intersect: false
    }
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Request Volume</h3>
          <p className="text-sm text-gray-600">Total requests over time</p>
        </div>
        <div className="bg-blue-50 text-blue-700 px-3 py-1 rounded-full text-sm font-medium">
          <svg className="w-4 h-4 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
          Trending Up
        </div>
      </div>

      <div className="h-64">
        {data && data.labels && data.datasets ? (
          <Line data={data} options={options} />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400">
            <div className="text-center">
              <svg className="w-12 h-12 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <p>No data available</p>
            </div>
          </div>
        )}
      </div>

      {/* Summary Stats */}
      <div className="mt-4 pt-4 border-t border-gray-200 grid grid-cols-3 gap-4">
        <div>
          <p className="text-xs text-gray-600">Peak</p>
          <p className="text-lg font-semibold text-gray-900">
            {data?.datasets?.[0]?.data ? Math.max(...data.datasets[0].data) : '-'}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-600">Average</p>
          <p className="text-lg font-semibold text-gray-900">
            {data?.datasets?.[0]?.data
              ? Math.round(data.datasets[0].data.reduce((a, b) => a + b, 0) / data.datasets[0].data.length)
              : '-'}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-600">Total</p>
          <p className="text-lg font-semibold text-gray-900">
            {data?.datasets?.[0]?.data
              ? data.datasets[0].data.reduce((a, b) => a + b, 0).toLocaleString()
              : '-'}
          </p>
        </div>
      </div>
    </div>
  )
}

export default RequestsChart
