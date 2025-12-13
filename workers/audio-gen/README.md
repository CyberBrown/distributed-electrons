# Audio Generation Worker

Text-to-speech synthesis using ElevenLabs API.

## Endpoints

### POST /synthesize

Generate audio from text.

**Request:**
```json
{
  "text": "Hello, this is a test of the audio generation system.",
  "voice_id": "21m00Tcm4TlvDq8ikWAM",
  "model_id": "eleven_monolingual_v1",
  "options": {
    "stability": 0.5,
    "similarity_boost": 0.75,
    "style": 0,
    "use_speaker_boost": true
  }
}
```

**Response:**
```json
{
  "success": true,
  "audio_url": "https://audio.distributedelectrons.com/audio/uuid.mp3",
  "duration_seconds": 3.5,
  "metadata": {
    "provider": "elevenlabs",
    "voice_id": "21m00Tcm4TlvDq8ikWAM",
    "model_id": "eleven_monolingual_v1",
    "character_count": 52,
    "generation_time_ms": 1250
  },
  "request_id": "uuid",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### GET /voices

List available voices.

### GET /health

Health check endpoint.

## Configuration

### Secrets

Set using `wrangler secret put`:

- `ELEVENLABS_API_KEY` - Your ElevenLabs API key

### Environment Variables

- `DEFAULT_VOICE_ID` - Default voice (Rachel: 21m00Tcm4TlvDq8ikWAM)
- `DEFAULT_MODEL_ID` - Default model (eleven_monolingual_v1)

## Deployment

```bash
cd workers/audio-gen
wrangler deploy
```

## R2 Bucket Setup

Create the audio storage bucket:

```bash
wrangler r2 bucket create de-audio-storage
```
