import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalGenerator, validateNotes, buildHistory, MAX_TEXT_BYTES } from '../src/generator.js';
function fixture(overrides = {}) {
  const calls = { loads: [], completions: [], cancellations: [], unloads: [] };
  const sdk = {
    QWEN3_600M_INST_Q4: { engine: 'llamacpp-completion', name: 'test-model' },
    loadModel(input) { calls.loads.push(input); return Object.assign(Promise.resolve('model-1'), { requestId: 'load-1' }); },
    completion(input) {
      calls.completions.push(input);
      return { requestId: 'run-1', events: (async function* () { yield { type: 'contentDelta', text: 'Test output' }; })(),
        final: Promise.resolve({ contentText: 'Test output', stopReason: 'eos' }) };
    },
    async cancel(input) { calls.cancellations.push(input); },
    async unloadModel(input) { calls.unloads.push(input); },
    ...overrides,
  };
  return { calls, sdk, engine: new LocalGenerator({ sdkLoader: async () => sdk }) };
}
test('validates empty, non-string, and oversized UTF-8 notes', () => {
  for (const input of [null, 23, '', ' \n ']) assert.throws(() => validateNotes(input), /Paste/);
  assert.equal(validateNotes('  test  '), 'test');
  assert.equal(validateNotes('a'.repeat(MAX_TEXT_BYTES)).length, MAX_TEXT_BYTES);
  assert.throws(() => validateNotes('a'.repeat(MAX_TEXT_BYTES + 1)), /too long/);
  assert.throws(() => validateNotes('界'.repeat(2100)), /too long/);
});
test('separates source material from the system instructions', () => {
  const history = buildHistory('A note with <tags> and "quotes".');
  assert.equal(history[0].role, 'system');
  assert.equal(history[1].role, 'user');
  assert.ok(history[1].content.includes('A note with <tags> and "quotes".'));
});
test('calls completion with CPU configuration and streams content', async () => {
  const { calls, engine } = fixture();
  const events = [];
  const result = await engine.generate('Seeds grow into plants.', (event) => events.push(event));
  assert.equal(calls.loads[0].modelType, 'llamacpp-completion');
  assert.equal(calls.loads[0].modelConfig.device, 'cpu');
  assert.equal(calls.loads[0].modelConfig.gpu_layers, 0);
  assert.equal(calls.completions[0].modelId, 'model-1');
  assert.equal(calls.completions[0].kvCache, false);
  assert.equal(result.text, 'Test output');
  assert.deepEqual(result.meta.functions, ['loadModel', 'completion']);
  assert.ok(events.some((event) => event.type === 'delta'));
  assert.equal(engine.busy, false);
});
test('reuses the model and unloads it on close', async () => {
  const { calls, engine } = fixture();
  await engine.generate('One note.'); await engine.generate('Another note.');
  assert.equal(calls.loads.length, 1); assert.equal(calls.completions.length, 2);
  await engine.close();
  assert.deepEqual(calls.unloads, [{ modelId: 'model-1', autoClose: true }]);
  assert.equal(engine.state, 'idle');
});
test('reports download failures and permits retry', async () => {
  let attempts = 0;
  const { engine } = fixture({ loadModel() { if (++attempts === 1) return Promise.reject(new Error('Download failed')); return Promise.resolve('model-1'); } });
  await assert.rejects(engine.generate('A note.'), /Download failed/);
  assert.equal(engine.busy, false); assert.equal(engine.state, 'idle');
  assert.equal((await engine.generate('A note.')).text, 'Test output');
});
test('empty output and SDK errors are not replaced by preset summaries', async () => {
  const empty = fixture({ completion: () => ({ requestId: 'run', events: (async function* () {})(), final: Promise.resolve({ contentText: '' }) }) });
  await assert.rejects(empty.engine.generate('A note.'), /no text/);
  const failure = fixture({ completion: () => ({ requestId: 'run', events: (async function* () { throw new Error('Native error'); })(), final: Promise.reject(new Error('Native error')) }) });
  await assert.rejects(failure.engine.generate('A note.'), /Native error/);
  assert.equal(failure.engine.busy, false);
});
test('pre-aborted work does not load the SDK', async () => {
  const controller = new AbortController(); controller.abort();
  const engine = new LocalGenerator({ sdkLoader: () => { throw new Error('Must not load'); } });
  await assert.rejects(engine.generate('A note.', () => {}, controller.signal), /stopped/);
  assert.equal(engine.busy, false);
});
test('rejects concurrent requests and cancels loading by requestId', async () => {
  let finish;
  const loading = Object.assign(new Promise((resolve) => { finish = resolve; }), { requestId: 'load-active' });
  const { engine, calls } = fixture({ loadModel: () => loading });
  const controller = new AbortController();
  const first = engine.generate('First note.', () => {}, controller.signal);
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(engine.generate('Second note.'), /Another note/);
  controller.abort(); finish('model-1');
  await assert.rejects(first, /stopped/);
  assert.deepEqual(calls.cancellations, [{ requestId: 'load-active' }]);
  assert.equal(calls.completions.length, 0); assert.equal(engine.busy, false);
});
