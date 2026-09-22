import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { availableParallelism } from 'node:os';
import { inspectWav } from '../public/wav.js';

process.env.QVAC_CONFIG_PATH ??= fileURLToPath(new URL('../qvac.config.js', import.meta.url));
export const SDK_VERSION = '0.20.0';
export const LANGUAGES = ['auto', 'en', 'uk', 'sk', 'hi', 'es', 'fr', 'de', 'pt', 'ja'];
export const MODEL_NAME = process.env.QVAC_MODEL_PATH ? 'Custom local Whisper model' : 'Whisper Tiny';

export class LocalTranscriber {
  constructor({ sdkLoader = () => import('@qvac/sdk') } = {}) { this.sdkLoader = sdkLoader; }
  sdk = null;
  modelId = null;
  language = null;
  activeRequest = null;
  busy = false;
  state = 'idle';

  async transcribe(wav, language, report = () => {}, signal) {
    if (this.busy) throw new Error('Another recording is being transcribed. Please wait.');
    if (!LANGUAGES.includes(language)) throw new Error('Choose a supported language.');
    const { pcm, seconds } = inspectWav(wav);
    this.busy = true;
    const stop = () => {
      if (this.activeRequest && this.sdk) void this.sdk.cancel({ requestId: this.activeRequest }).catch(() => {});
    };
    const checkAbort = () => { if (signal?.aborted) throw new Error('Transcription stopped.'); };
    signal?.addEventListener('abort', stop, { once: true });
    try {
      checkAbort();
      this.sdk ??= await this.sdkLoader();
      const { loadModel, transcribe, unloadModel, WHISPER_TINY } = this.sdk;
      checkAbort();
      if (this.modelId && this.language !== language) {
        await unloadModel({ modelId: this.modelId });
        this.modelId = null;
      }
      if (!this.modelId) {
        this.state = 'loading';
        report({ type: 'status', stage: 'loading', message: 'Preparing Whisper Tiny. The first run downloads about 78 MB.' });
        const loading = loadModel({
          modelSrc: process.env.QVAC_MODEL_PATH ? resolve(process.env.QVAC_MODEL_PATH) : WHISPER_TINY,
          modelType: 'whisper',
          modelConfig: {
            audio_format: 's16le', language, translate: false,
            strategy: 'greedy', n_threads: Math.min(4, availableParallelism()),
            no_timestamps: true, no_context: true, suppress_blank: true,
            contextParams: { use_gpu: false },
          },
          onProgress: (p) => report({ type: 'progress', percentage: p.percentage, downloaded: p.downloaded, total: p.total }),
        });
        this.activeRequest = loading.requestId;
        this.modelId = await loading;
        this.language = language;
        this.activeRequest = null;
      }
      checkAbort();
      this.state = 'transcribing';
      report({ type: 'status', stage: 'transcribing', message: 'Listening on your device. Your audio stays here.' });
      const started = performance.now();
      // QVAC treats in-memory bytes as raw PCM, not a WAV container. Strip the
      // validated header and send PCM16 matching modelConfig.audio_format.
      const operation = transcribe({ modelId: this.modelId, audioChunk: Buffer.from(pcm) });
      this.activeRequest = operation.requestId;
      const text = (await operation).trim();
      checkAbort();
      if (!text || text === '[BLANK_AUDIO]' || text === '[No speech detected]') throw new Error('No speech was detected. Try a clearer recording.');
      return {
        text,
        meta: {
          model: MODEL_NAME, sdkVersion: SDK_VERSION, functions: ['loadModel', 'transcribe'],
          runtime: 'local-cpu', language, audioSeconds: +seconds.toFixed(2),
          inferenceSeconds: +((performance.now() - started) / 1000).toFixed(2),
          generatedAt: new Date().toISOString(),
        },
      };
    } finally {
      this.activeRequest = null;
      this.busy = false;
      this.state = this.modelId ? 'ready' : 'idle';
      signal?.removeEventListener('abort', stop);
    }
  }

  async close() {
    if (this.activeRequest && this.sdk) await this.sdk.cancel({ requestId: this.activeRequest }).catch(() => {});
    if (this.modelId && this.sdk) await this.sdk.unloadModel({ modelId: this.modelId, autoClose: true });
    this.modelId = null;
    this.state = 'idle';
  }
}
