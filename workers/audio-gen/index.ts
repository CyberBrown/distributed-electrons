/**
 * Audio Generation Worker
 * Synthesizes speech from text using ElevenLabs or OpenAI TTS
 *
 * Provider waterfall:
 * 1. ElevenLabs (if API key configured)
 * 2. OpenAI TTS via Cloudflare AI Gateway (fallback)
 */

import type {
  Env,
  SynthesizeRequest,
  SynthesizeResponse,
  AudioResult,
} from './types';
import {
  addCorsHeaders,
  createErrorResponse,
  handleCorsPrelight,
  fetchWithRetry,
} from '../shared/http';

// AI Gateway URL for OpenAI TTS
const AI_GATEWAY_OPENAI = 'https://gateway.ai.cloudflare.com/v1/52b1c60ff2a24fb21c1ef9a429e63261/de-gateway/openai';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestId = crypto.randomUUID();

    try {
      const url = new URL(request.url);

      // Handle CORS preflight
      if (request.method === 'OPTIONS') {
        return handleCorsPrelight();
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

// addCorsHeaders imported from shared/http

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

    // Generate audio - try ElevenLabs first, then OpenAI TTS via AI Gateway
    let result: AudioResult;
    let provider: string;

    const voiceId = body.voice_id || env.DEFAULT_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // Rachel
    const modelId = body.model_id || env.DEFAULT_MODEL_ID || 'eleven_monolingual_v1';

    if (env.ELEVENLABS_API_KEY) {
      // Try ElevenLabs first
      try {
        result = await generateWithElevenLabs(
          body.text,
          voiceId,
          modelId,
          body.options || {},
          env.ELEVENLABS_API_KEY
        );
        provider = 'elevenlabs';
      } catch (elevenLabsError) {
        console.warn('ElevenLabs failed, trying OpenAI TTS:', elevenLabsError);
        // Fallback to OpenAI TTS
        if (!env.CF_AIG_TOKEN) {
          throw elevenLabsError; // Re-throw if no fallback available
        }
        result = await generateWithOpenAI(body.text, body.voice_id, env.CF_AIG_TOKEN);
        provider = 'openai';
      }
    } else if (env.CF_AIG_TOKEN) {
      // Use OpenAI TTS via AI Gateway
      result = await generateWithOpenAI(body.text, body.voice_id, env.CF_AIG_TOKEN);
      provider = 'openai';
    } else {
      return createErrorResponse(
        'Missing API key',
        'MISSING_API_KEY',
        requestId,
        500
      );
    }

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
        provider,
        voice_id: result.voice_id,
        model_id: result.model_id,
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
  const response = await fetchWithRetry(
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
    },
    { maxRetries: 2, initialDelayMs: 1000 }
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

/**
 * Generate audio using OpenAI TTS via Cloudflare AI Gateway
 */
async function generateWithOpenAI(
  text: string,
  voiceId: string | undefined,
  aigToken: string
): Promise<AudioResult> {
  // Map voice IDs or use defaults
  // OpenAI voices: alloy, echo, fable, onyx, nova, shimmer
  const openaiVoice = voiceId?.toLowerCase() || 'nova';
  const validVoices = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
  const voice = validVoices.includes(openaiVoice) ? openaiVoice : 'nova';

  const response = await fetch(`${AI_GATEWAY_OPENAI}/v1/audio/speech`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'cf-aig-authorization': `Bearer ${aigToken}`,
    },
    body: JSON.stringify({
      model: 'tts-1',
      input: text,
      voice,
      response_format: 'mp3',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI TTS error (${response.status}): ${error}`);
  }

  const audioData = await response.arrayBuffer();

  // Estimate duration (rough: ~150 words per minute, ~5 chars per word)
  const estimatedDuration = (text.length / 5 / 150) * 60;

  return {
    audio_data: audioData,
    duration_seconds: estimatedDuration,
    provider: 'openai',
    voice_id: voice,
    model_id: 'tts-1',
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
    const response = await fetchWithRetry(
      'https://api.elevenlabs.io/v1/voices',
      { headers: { 'xi-api-key': apiKey } },
      { maxRetries: 2, initialDelayMs: 1000 }
    );

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

// createErrorResponse imported from shared/http
