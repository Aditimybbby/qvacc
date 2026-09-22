import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalTranscriber } from '../src/transcriber.js';
import { encodeWav, inspectWav } from '../public/wav.js';

test('passes validated PCM without its WAV header to QVAC and reuses the model', async () => {
  const wav = encodeWav(Float32Array.of(-1, 0, 1));
  let loads = 0;
  let unloaded;
  const engine = new LocalTranscriber({ sdkLoader: async () => ({
    WHISPER_TINY: 'test-model',
    async loadModel() { loads++; return 'test-model-id'; },
    async transcribe({ modelId, audioChunk }) {
      assert.equal(modelId, 'test-model-id');
      assert.deepEqual(audioChunk, Buffer.from(inspectWav(wav).pcm));
      return '  Test transcript  ';
    },
    async unloadModel({ modelId }) { unloaded = modelId; },
  }) });
  assert.equal((await engine.transcribe(wav, 'en')).text, 'Test transcript');
  await engine.transcribe(wav, 'en');
  assert.equal(loads, 1);
  assert.equal(engine.busy, false);
  await engine.close();
  assert.equal(unloaded, 'test-model-id');
});
