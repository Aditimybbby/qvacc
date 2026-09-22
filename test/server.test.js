import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { once } from 'node:events';
import { makeServer } from '../src/server.js';
import { encodeWav, inspectWav, MAX_WAV_BYTES } from '../public/wav.js';

async function start(t, engine = { state: 'idle', busy: false }) {
  const server = makeServer(engine);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}
const options = (body, headers = {}) => ({ method: 'POST', headers: { 'content-type': 'audio/wav', 'x-hush-local': '1', ...headers }, body });

test('startup serves every browser asset and runtime status', async (t) => {
  const base = await start(t);
  for (const [path, type] of [['/', 'text/html'], ['/app.js', 'text/javascript'], ['/audio.js', 'text/javascript'], ['/wav.js', 'text/javascript'], ['/style.css', 'text/css'], ['/icon.svg', 'image/svg+xml']]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('content-type').split(';')[0], type);
    assert.ok((await response.text()).length > 0, path);
  }
  const response = await fetch(base + '/api/status');
  assert.equal((await response.json()).state, 'idle');
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('rejects foreign hosts and origins', async (t) => {
  const base = await start(t);
  const origin = await fetch(base + '/api/status', { headers: { origin: 'https://example.com' } });
  assert.equal(origin.status, 403);
  const status = await new Promise((resolve, reject) => {
    const req = request(base + '/api/status', { headers: { host: 'example.com' } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(status, 403);
});

test('rejects invalid audio, language, media type, and missing local header', async (t) => {
  const base = await start(t);
  const wav = encodeWav(Float32Array.of(0));
  assert.equal((await fetch(base + '/api/transcribe', options('not wav'))).status, 400);
  assert.equal((await fetch(base + '/api/transcribe?language=invalid', options(wav))).status, 400);
  assert.equal((await fetch(base + '/api/transcribe', options(wav, { 'content-type': 'application/json' }))).status, 415);
  assert.equal((await fetch(base + '/api/transcribe', options(wav, { 'x-hush-local': '' }))).status, 415);
  assert.equal((await fetch(base + '/src/server.js')).status, 404);
});

test('rejects oversized uploads before invoking transcription', async (t) => {
  const base = await start(t);
  const response = await fetch(base + '/api/transcribe', options(new Uint8Array(MAX_WAV_BYTES + 1)));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /too large/);
});

test('streams a transcript from validated WAV input and clears server bytes', async (t) => {
  let received;
  const base = await start(t, {
    state: 'idle', busy: false,
    async transcribe(wav, language, report) {
      received = wav;
      assert.equal(inspectWav(wav).seconds, 1);
      assert.equal(language, 'en');
      report({ type: 'status', stage: 'transcribing', message: 'Testing' });
      return { text: 'Test transcript' };
    },
  });
  const response = await fetch(base + '/api/transcribe?language=en', options(encodeWav(new Float32Array(16000).fill(0.2))));
  assert.equal(response.status, 200);
  const events = (await response.text()).trim().split('\n').map(JSON.parse);
  assert.deepEqual(events.map((event) => event.type), ['status', 'done']);
  assert.equal(events[1].transcript.text, 'Test transcript');
  assert.ok(received.every((byte) => byte === 0));
});

test('returns a busy error and streams engine failures honestly', async (t) => {
  const engine = { state: 'idle', busy: true, async transcribe() { throw new Error('Model unavailable'); } };
  const base = await start(t, engine);
  const wav = encodeWav(Float32Array.of(0));
  assert.equal((await fetch(base + '/api/transcribe', options(wav))).status, 409);
  engine.busy = false;
  const response = await fetch(base + '/api/transcribe', options(wav));
  assert.deepEqual(JSON.parse((await response.text()).trim()), { type: 'error', message: 'Model unavailable' });
});
