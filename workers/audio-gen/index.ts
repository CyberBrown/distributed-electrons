/**
 * Audio Generation Worker
 * Synthesizes speech from text using ElevenLabs API
 */

import type {
  Env,
  SynthesizeRequest,
  SynthesizeResponse,
  ErrorResponse,
  AudioResult,
} from './types';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestId = crypto.randomUUID();

    try {
      const url = new URL(request.url);

      // Handle CORS preflight
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, Authorization',
            'Access-Control-Max-Age': '86400',
          },
        });
      }

      // Route handling
      if (url.pathname === '/synthesize' && request.method === 'POST') {
        const response = await handleSynthesize(request, env, requestId, url);
        return addCorsHeaders(response);
      }

      if (url.pathname === '/voices' && request.method === 'GET') {
        const response = await handleGetVoices(env, requestId);
        return addCorsHeaders(response);
      }

      // Serve audio files from R2
      if (url.pathname.startsWith('/audio/') && request.method === 'GET') {
        const key = url.pathname.replace('/audio/', 'audio/');
        const object = await env.AUDIO_STORAGE.get(key);

        if (!object) {
          return addCorsHeaders(createErrorResponse(
            'Audio file not found',
            'NOT_FOUND',
            requestId,
            404
          ));
        }

        const headers = new Headers();
        headers.set('Content-Type', object.httpMetadata?.contentType || 'audio/mpeg');
        headers.set('Cache-Control', 'public, max-age=31536000');
        headers.set('Access-Control-Allow-Origin', '*');

        return new Response(object.body, { headers });
      }

      if (url.pathname === '/health' && request.method === 'GET') {
        return addCorsHeaders(Response.json({
          status: 'healthy',
          service: 'audio-gen',
          timestamp: new Date().toISOString(),
        }));
      }

      return addCorsHeaders(createErrorResponse(
        'Not Found',
        'ROUTE_NOT_FOUND',
        requestId,
        404
      ));
    } catch (error) {
      console.error('Unhandled error:', error);
      return addCorsHeaders(createErrorResponse(
        error instanceof Error ? error.message : 'Internal Server Error',
        'INTERNAL_ERROR',
        requestId,
        500
      ));
    }
  },
};

function addCorsHeaders(response: Response): Response {
  const newResponse = new Response(response.body, response);
  newResponse.headers.set('Access-Control-Allow-Origin', '*');
  newResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  newResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, Authorization');
  return newResponse;
}

async function handleSynthesize(
  request: Request,
  env: Env,
  requestId: string,
  requestUrl: URL
): Promise<Response> {
  const startTime = Date.now();

  try {
    const body: SynthesizeRequest = await request.json();

    // Validate request
    if (!body.text || body.text.trim() === '') {
      return createErrorResponse(
        'Text is required',
        'INVALID_REQUEST',
        requestId,
        400
      );
    }

    if (body.text.length > 5000) {
      return createErrorResponse(
        'Text exceeds maximum length of 5000 characters',
        'TEXT_TOO_LONG',
        requestId,
        400
      );
    }

    // Get API key
    const apiKey = env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return createErrorResponse(
        'ElevenLabs API key not configured',
        'MISSING_API_KEY',
        requestId,
        500
      );
    }

    // Generate audio
    const voiceId = body.voice_id || env.DEFAULT_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // Rachel
    const modelId = body.model_id || env.DEFAULT_MODEL_ID || 'eleven_monolingual_v1';

    const result = await generateWithElevenLabs(
      body.text,
      voiceId,
      modelId,
      body.options || {},
      apiKey
    );

    // Store audio in R2
    const audioKey = `audio/${requestId}.mp3`;
    await env.AUDIO_STORAGE.put(audioKey, result.audio_data, {
      httpMetadata: {
        contentType: 'audio/mpeg',
      },
      customMetadata: {
        requestId,
        voiceId,
        modelId,
        characterCount: String(body.text.length),
      },
    });

    // Generate public URL using the worker's own /audio route
    const audioUrl = `${requestUrl.origin}/${audioKey}`;

    const generationTime = Date.now() - startTime;

    const response: SynthesizeResponse = {
      success: true,
      audio_url: audioUrl,
      duration_seconds: result.duration_seconds,
      metadata: {
        provider: 'elevenlabs',
        voice_id: voiceId,
        model_id: modelId,
        character_count: body.text.length,
        generation_time_ms: generationTime,
      },
      request_id: requestId,
      timestamp: new Date().toISOString(),
    };

    return Response.json(response, {
      headers: { 'X-Request-ID': requestId },
    });
  } catch (error) {
    console.error('Synthesis error:', error);

    if (error instanceof Error) {
      if (error.message.includes('429')) {
        return createErrorResponse(
          'ElevenLabs rate limit exceeded',
          'PROVIDER_RATE_LIMIT',
          requestId,
          429
        );
      }
      if (error.message.includes('401')) {
        return createErrorResponse(
          'Invalid ElevenLabs API key',
          'INVALID_API_KEY',
          requestId,
          401
        );
      }
    }

    return createErrorResponse(
      error instanceof Error ? error.message : 'Synthesis failed',
      'SYNTHESIS_ERROR',
      requestId,
      500
    );
  }
}

async function generateWithElevenLabs(
  text: string,
  voiceId: string,
  modelId: string,
  options: any,
  apiKey: string
): Promise<AudioResult> {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: {
          stability: options.stability ?? 0.5,
          similarity_boost: options.similarity_boost ?? 0.75,
          style: options.style ?? 0,
          use_speaker_boost: options.use_speaker_boost ?? true,
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`ElevenLabs API error (${response.status}): ${error}`);
  }

  const audioData = await response.arrayBuffer();

  // Estimate duration (rough estimate: ~150 words per minute, ~5 chars per word)
  const estimatedDuration = (text.length / 5 / 150) * 60;

  return {
    audio_data: audioData,
    duration_seconds: estimatedDuration,
    provider: 'elevenlabs',
    voice_id: voiceId,
    model_id: modelId,
    character_count: text.length,
  };
}

async function handleGetVoices(env: Env, requestId: string): Promise<Response> {
  const apiKey = env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return createErrorResponse(
      'ElevenLabs API key not configured',
      'MISSING_API_KEY',
      requestId,
      500
    );
  }

  try {
    const response = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': apiKey },
    });

    if (!response.ok) {
      throw new Error(`ElevenLabs API error: ${response.status}`);
    }

    const data = await response.json();
    return Response.json({
      success: true,
      voices: data,
      request_id: requestId,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to fetch voices',
      'VOICES_FETCH_ERROR',
      requestId,
      500
    );
  }
}

function createErrorResponse(
  message: string,
  code: string,
  requestId: string,
  status: number,
  details?: Record<string, any>
): Response {
  const errorResponse: ErrorResponse = {
    error: message,
    error_code: code,
    request_id: requestId,
    details,
  };

  return Response.json(errorResponse, {
    status,
    headers: { 'X-Request-ID': requestId },
  });
}
