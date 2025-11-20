# Testing GUI

A simple web interface for testing the Cloudflare Multi-Agent Image Generation System.

## Features

- **Simple Form Interface**: Easy-to-use form for image generation requests
- **Real-time Results**: Display generated images with metadata
- **Mock API Support**: Test the interface without backend dependencies
- **Error Handling**: Clear error messages and status indicators
- **Local Storage**: Saves API key and instance ID for convenience
- **Responsive Design**: Works on desktop and mobile devices

## Tech Stack

- **HTML5** - Structure
- **Tailwind CSS** - Styling (via CDN)
- **Vanilla JavaScript** - Functionality
- **Cloudflare Pages** - Deployment

## Local Development

### Prerequisites
- Node.js 18+
- npm or yarn

### Run Locally

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

The app will be available at `http://localhost:8080`

## Deployment

### Deploy to Cloudflare Pages

```bash
# Using Wrangler CLI
npm run deploy

# Or manually through Cloudflare Dashboard:
# 1. Go to Cloudflare Pages
# 2. Create new project
# 3. Connect to Git or upload folder
# 4. Set build command: (none needed)
# 5. Set output directory: public
```

## Usage

### Mock API Mode (Default)

By default, the GUI uses a mock API that simulates the backend responses. This is useful for:
- Testing the interface before backend is ready
- Development without API credentials
- Demonstrating the UI flow

### Production Mode

Toggle "Mock API" off to connect to real workers:
- Requires valid API key
- Requires deployed infrastructure (Teams 1 & 2)
- Calls actual Cloudflare Workers endpoints

## API Integration

The GUI expects the following API endpoint:

```
POST https://image-gen-{instance}.workers.dev/generate
Authorization: Bearer {api_key}
Content-Type: application/json

{
  "prompt": "A serene mountain landscape",
  "instance_id": "production",
  "model": "ideogram-v2",
  "options": {
    "aspect_ratio": "16:9",
    "style": "realistic"
  }
}
```

See `/docs/specs/api-contracts.md` for full API specification.

## Features Breakdown

### Form Fields
- **API Key**: Bearer token for authentication (saved to localStorage)
- **Instance ID**: Select production/development/staging instance
- **Prompt**: Text description for image generation
- **Model**: Optional model selection (defaults to instance default)
- **Advanced Options**: Aspect ratio and style preferences

### Results Display
- Generated image preview (click to open full size)
- CDN URL (copyable)
- R2 storage path
- Metadata: provider, model, dimensions, generation time
- Request ID for debugging

### Error Handling
- Invalid API key warnings
- Rate limit exceeded messages
- Instance not found errors
- Network error handling
- Mock error simulation (10% rate for testing)

## File Structure

```
testing-gui/
├── public/
│   ├── index.html      # Main HTML file
│   ├── styles.css      # Custom styles
│   └── app.js          # Application logic
├── package.json        # Dependencies and scripts
└── README.md           # This file
```

## Environment Variables

No environment variables required. API endpoints are constructed dynamically based on instance ID.

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Mobile browsers (responsive design)

## Accessibility

- Semantic HTML
- ARIA labels where needed
- Keyboard navigation support
- Screen reader friendly

## Performance

- Minimal dependencies (Tailwind via CDN)
- Fast load times (< 100KB total)
- Efficient JavaScript (vanilla, no framework overhead)
- Optimized for Cloudflare's edge network

## Security

- API keys stored in localStorage (client-side only)
- No sensitive data transmitted to third parties
- HTTPS enforced via Cloudflare Pages
- Content Security Policy headers (configured in Pages)

## Future Enhancements

- [ ] History of generated images
- [ ] Batch generation support
- [ ] Image editing/filters
- [ ] Download button
- [ ] Share functionality
- [ ] Dark mode

## Team 4 - Agent 4.1

This component was built by Agent 4.1 as part of the Team 4 Interface Team, led by Team Leader 4.

**Status**: ✅ Complete and ready for deployment
