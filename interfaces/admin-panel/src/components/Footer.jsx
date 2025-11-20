export default function Footer() {
  return (
    <footer className="bg-white border-t border-gray-200 mt-12">
      <div className="container mx-auto px-4 py-6">
        <div className="flex flex-col md:flex-row justify-between items-center">
          <div className="text-gray-600 text-sm">
            <p>Built with Claude Code | Powered by Cloudflare Workers</p>
          </div>

          <div className="text-gray-500 text-sm mt-2 md:mt-0">
            <p>Autonomous Multi-Agent Development</p>
          </div>

          <div className="mt-2 md:mt-0">
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
              <span className="text-sm text-gray-600">Mock API Active</span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}
