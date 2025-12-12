# Render Service Worker

Video rendering using Shotstack API.

## Endpoints

### POST /render

Submit a video render job.

**Request:**
```json
{
  "timeline": {
    "soundtrack": {
      "src": "https://example.com/music.mp3",
      "effect": "fadeInFadeOut",
      "volume": 0.5
    },
    "tracks": [
      {
        "clips": [
          {
            "asset": {
              "type": "video",
              "src": "https://example.com/clip1.mp4"
            },
            "start": 0,
            "length": 5
          },
          {
            "asset": {
              "type": "title",
              "text": "Hello World",
              "style": "minimal"
            },
            "start": 5,
            "length": 3
          }
        ]
      }
    ]
  },
  "output": {
    "format": "mp4",
    "resolution": "hd",
    "fps": 25
  }
}
```

**Response:**
```json
{
  "success": true,
  "render_id": "abc123",
  "status": "queued",
  "metadata": {
    "provider": "shotstack",
    "format": "mp4",
    "resolution": "hd"
  },
  "request_id": "uuid",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### GET /render/:id

Check render status.

**Response:**
```json
{
  "success": true,
  "render_id": "abc123",
  "status": "done",
  "progress": 100,
  "url": "https://cdn.shotstack.io/...",
  "request_id": "uuid",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

Status values: `queued`, `fetching`, `rendering`, `saving`, `done`, `failed`

### GET /health

Health check endpoint.

## Configuration

### Secrets

Set using `wrangler secret put`:

- `SHOTSTACK_API_KEY` - Your Shotstack API key

### Environment Variables

- `SHOTSTACK_ENV` - `v1` (production) or `stage` (sandbox)

## Deployment

```bash
cd workers/render-service
wrangler deploy
```

## Timeline Format

The timeline follows Shotstack's format. See [Shotstack API docs](https://shotstack.io/docs/api/) for full reference.

### Asset Types

- `video` - Video file with src URL
- `image` - Image file with src URL
- `audio` - Audio file with src URL
- `title` - Text overlay
- `html` - HTML/CSS overlay

### Clip Properties

- `start` - Start time in seconds
- `length` - Duration in seconds
- `fit` - crop, cover, contain, none
- `position` - center, top, bottom, etc.
- `transition` - in/out transitions
- `effect` - Visual effects
- `filter` - Color filters
- `opacity` - 0-1
