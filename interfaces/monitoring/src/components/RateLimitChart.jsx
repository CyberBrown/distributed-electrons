import { Line } from 'react-chartjs-2'

function RateLimitChart({ data }) {
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'top',
        align: 'end',
        labels: {
          padding: 15,
          font: {
            size: 11
          },
          usePointStyle: true,
          pointStyle: 'circle',
          boxWidth: 6,
          boxHeight: 6
        }
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
            return `${context.dataset.label}: ${context.parsed.y}`
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
        max: 100,
        grid: {
          color: 'rgba(0, 0, 0, 0.05)'
        },
        ticks: {
          font: {
            size: 11
          },
          callback: function(value) {
            return value + '%'
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
          <h3 className="text-lg font-semibold text-gray-900">Rate Limit Usage</h3>
          <p className="text-sm text-gray-600">Usage vs configured limits</p>
        </div>
        <div className="bg-purple-50 text-purple-700 px-3 py-1 rounded-full text-sm font-medium">
          <svg className="w-4 h-4 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          Normal
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
          <p className="text-xs text-gray-600">Current Usage</p>
          <p className="text-lg font-semibold text-gray-900">
            {data?.datasets?.[0]?.data
              ? `${data.datasets[0].data[data.datasets[0].data.length - 1]}%`
              : '-'}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-600">Peak Usage</p>
          <p className="text-lg font-semibold text-gray-900">
            {data?.datasets?.[0]?.data ? `${Math.max(...data.datasets[0].data)}%` : '-'}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-600">Avg Usage</p>
          <p className="text-lg font-semibold text-gray-900">
            {data?.datasets?.[0]?.data
              ? `${Math.round(data.datasets[0].data.reduce((a, b) => a + b, 0) / data.datasets[0].data.length)}%`
              : '-'}
          </p>
        </div>
      </div>

      {/* Rate Limit Info */}
      <div className="mt-4 pt-4 border-t border-gray-200">
        <p className="text-xs text-gray-600 mb-3">Rate Limit Configuration</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-blue-50 rounded-lg p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-blue-600 mb-1">Requests per Minute</p>
                <p className="text-xl font-bold text-blue-900">500</p>
              </div>
              <svg className="w-8 h-8 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
            <div className="mt-2 flex items-center text-xs text-blue-700">
              <span className="font-medium">Current: 380</span>
              <span className="ml-auto">76%</span>
            </div>
          </div>

          <div className="bg-green-50 rounded-lg p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-green-600 mb-1">Tokens per Minute</p>
                <p className="text-xl font-bold text-green-900">100K</p>
              </div>
              <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="mt-2 flex items-center text-xs text-green-700">
              <span className="font-medium">Current: 72K</span>
              <span className="ml-auto">72%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Warning threshold indicator */}
      <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
        <div className="flex items-start gap-2">
          <svg className="w-5 h-5 text-yellow-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div>
            <p className="text-sm font-medium text-yellow-900">Rate Limit Warning</p>
            <p className="text-xs text-yellow-700 mt-1">
              Alert triggers at 85% usage. Current usage is within normal range.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default RateLimitChart
