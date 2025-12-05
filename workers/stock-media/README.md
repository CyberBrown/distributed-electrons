# Stock Media Worker

Search for stock videos and images using Pexels API.

## Endpoints

### POST /search

Search both videos and photos.

**Request:**
```json
{
  "keywords": ["nature", "forest", "trees"],
  "orientation": "landscape",
  "size": "large",
  "options": {
    "per_page": 10,
    "page": 1
  }
}
```

**Response:**
```json
{
  "success": true,
  "media": [
    {
      "id": "12345",
      "type": "video",
      "url": "https://...",
      "preview_url": "https://...",
      "duration": 15,
      "width": 1920,
      "height": 1080,
      "provider": "pexels",
      "photographer": "John Doe",
      "photographer_url": "https://..."
    }
  ],
  "total_results": 100,
  "page": 1,
  "per_page": 20,
  "metadata": {
    "provider": "pexels",
    "query": "nature forest trees",
    "search_time_ms": 250
  },
  "request_id": "uuid",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### POST /search/videos

Search only videos.

### POST /search/photos

Search only photos.

### GET /health

Health check endpoint.

## Configuration

### Secrets

Set using `wrangler secret put`:

- `PEXELS_API_KEY` - Your Pexels API key (get from https://www.pexels.com/api/)

## Deployment

```bash
cd workers/stock-media
wrangler deploy
```

## Usage in Living Arts

The workflow calls this to find stock footage for each script section:

```typescript
const response = await fetch(`${DE_API_URL}/stock-media/search`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    keywords: section.keywords,
    duration: section.duration
  })
});
```
