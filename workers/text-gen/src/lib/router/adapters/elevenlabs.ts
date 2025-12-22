/**
 * ElevenLabs Provider Adapter
 * Text-to-speech with natural voices
 */

import type { AdapterContext, MediaOptions, AudioResult, AudioOptions } from '../types';
import { AudioAdapter } from './base';

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

  async execute(
    prompt: string,
    options: MediaOptions,
    context: AdapterContext
  ): Promise<AudioResult> {
    const audioOptions = options as AudioOptions;
    const { model, apiKey } = context;

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

    const response = await this.makeRequest(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
          Accept: audioOptions.output_format === 'pcm' ? 'audio/pcm' : 'audio/mpeg',
        },
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
      const response = await fetch('https://api.elevenlabs.io/v1/user', {
        method: 'GET',
        headers: {
          'xi-api-key': context.apiKey,
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
