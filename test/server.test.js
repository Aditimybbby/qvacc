import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { makeServer } from '../src/server.js';
async function start(t, engine = { state: 'idle', busy: false }) {
  const server = makeServer(engine); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return 'http://127.0.0.1:' + server.address().port;
}
const options = (value, headers = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', 'x-clarity-local': '1', ...headers }, body: JSON.stringify(value) });
test('serves all frontend assets and blocks microphone access', async (t) => {
  const base = await start(t);
  for (const path of ['/', '/app.js', '/style.css', '/icon.svg', '/api/status']) {
    const res = await fetch(base + path); assert.equal(res.status, 200, path); assert.ok((await res.text()).length);
    assert.match(res.headers.get('permissions-policy'), /microphone=\(\)/);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  }
  for (const path of ['/audio.js', '/wav.js', '/src/generator.js']) assert.equal((await fetch(base + path)).status, 404);
});
test('rejects foreign origins and hostnames', async (t) => {
  const base = await start(t);
  assert.equal((await fetch(base + '/api/status', { headers: { origin: 'https://example.com' } })).status, 403);
  const code = await new Promise((resolve, reject) => {
    const req = request(base, { headers: { host: 'example.com' } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(code, 403);
});
test('rejects invalid and oversized input and missing local headers', async (t) => {
  const base = await start(t);
  for (const value of [null, {}, { text: '' }, { text: 2 }, { text: 'a'.repeat(6001) }, { text: 'a'.repeat(33000) }]) assert.equal((await fetch(base + '/api/organize', options(value))).status, 400);
  assert.equal((await fetch(base + '/api/organize', options({ text: 'Hello' }, { 'x-clarity-local': '' }))).status, 415);
  assert.equal((await fetch(base + '/api/organize', options({ text: 'Hello' }, { 'content-type': 'text/plain' }))).status, 415);
});
test('streams engine output across the HTTP boundary', async (t) => {
  const base = await start(t, { state: 'idle', busy: false, async generate(text, report) {
    assert.equal(text, 'A real input.'); report({ type: 'delta', text: 'Output' });
    return { text: 'Output', meta: { runtime: 'test' } };
  } });
  const response = await fetch(base + '/api/organize', options({ text: ' A real input. ' }));
  assert.equal(response.status, 200);
  const events = (await response.text()).trim().split('\n').map(JSON.parse);
  assert.deepEqual(events.map((e) => e.type), ['delta', 'done']);
  assert.equal(events[1].result.text, 'Output');
});
test('exposes busy and native failures without fabricated results', async (t) => {
  const engine = { state: 'idle', busy: true, async generate() { throw new Error('Native failure'); } };
  const base = await start(t, engine);
  assert.equal((await fetch(base + '/api/organize', options({ text: 'Notes' }))).status, 409);
  engine.busy = false;
  const response = await fetch(base + '/api/organize', options({ text: 'Notes' }));
  assert.deepEqual(JSON.parse((await response.text()).trim()), { type: 'error', message: 'Native failure' });
});
