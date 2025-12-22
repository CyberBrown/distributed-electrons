/**
 * ElevenLabs Provider Adapter
 * Text-to-speech with natural voices
 * Routes through AI Gateway when available
 */

import type { AdapterContext, MediaOptions, AudioResult, AudioOptions } from '../types';
import { AudioAdapter } from './base';

// AI Gateway endpoint for ElevenLabs
const GATEWAY_ELEVENLABS_URL = 'https://gateway.ai.cloudflare.com/v1/52b1c60ff2a24fb21c1ef9a429e63261/de-gateway/elevenlabs';

export class ElevenLabsAdapter extends AudioAdapter {
  readonly providerId = 'elevenlabs';

  // Default voice IDs
  private readonly DEFAULT_VOICES: Record<string, string> = {
    alloy: 'EXAVITQu4vr4xnSDxMaL', // Sarah
    echo: 'IKne3meq5aSn9XLyUdCD', // Charlie
    fable: 'XB0fDUnXU5powFXDhCwa', // Charlotte
    onyx: 'pqHfZKP75CvOlQylNhV4', // Bill
    nova: 'pFZP5JQG7iQjIQuC4Bku', // Lily
    shimmer: 'XrExE9yKIg1WjnnlVkGX', // Matilda
  };

  private getBaseUrl(context: AdapterContext): string {
    // Use AI Gateway if token is available
    if (context.gatewayToken) {
      return GATEWAY_ELEVENLABS_URL;
    }
    // Fall back to direct API
    return 'https://api.elevenlabs.io';
  }

  private getHeaders(context: AdapterContext, accept: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: accept,
    };

    if (context.gatewayToken) {
      // AI Gateway handles the API key via BYOK
      headers['cf-aig-authorization'] = `Bearer ${context.gatewayToken}`;
    } else {
      // Direct API call
      headers['xi-api-key'] = context.apiKey;
    }

    return headers;
  }

  async execute(
    prompt: string,
    options: MediaOptions,
    context: AdapterContext
  ): Promise<AudioResult> {
    const audioOptions = options as AudioOptions;
    const { model } = context;

    // Get voice ID - use provided, map from OpenAI voice name, or use default
    let voiceId = audioOptions.voice_id;
    if (!voiceId) {
      voiceId = this.DEFAULT_VOICES.alloy; // Default voice
    } else if (this.DEFAULT_VOICES[voiceId]) {
      voiceId = this.DEFAULT_VOICES[voiceId];
    }

    const requestBody: Record<string, any> = {
      text: prompt,
      model_id: model.model_id,
      voice_settings: {
        stability: audioOptions.stability ?? 0.5,
        similarity_boost: audioOptions.similarity_boost ?? 0.75,
        style: 0,
        use_speaker_boost: true,
      },
    };

    const accept = audioOptions.output_format === 'pcm' ? 'audio/pcm' : 'audio/mpeg';

    const response = await this.makeRequest(
      `${this.getBaseUrl(context)}/v1/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: this.getHeaders(context, accept),
        body: JSON.stringify(requestBody),
      }
    );

    // Response is audio data
    const audioBuffer = await response.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(audioBuffer)));

    return {
      base64,
      provider: this.providerId,
      model: model.model_id,
    };
  }

  async checkHealth(context: AdapterContext): Promise<boolean> {
    try {
      const headers: Record<string, string> = {};
      if (context.gatewayToken) {
        headers['cf-aig-authorization'] = `Bearer ${context.gatewayToken}`;
      } else {
        headers['xi-api-key'] = context.apiKey;
      }

      const response = await fetch(`${this.getBaseUrl(context)}/v1/user`, {
        method: 'GET',
        headers,
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
