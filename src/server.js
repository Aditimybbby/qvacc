import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalGenerator, validateNotes, MODEL_NAME, SDK_VERSION, MAX_TEXT_BYTES } from './generator.js';

const assets = new Map([
  ['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']],
  ['/style.css', ['style.css', 'text/css']], ['/icon.svg', ['icon.svg', 'image/svg+xml']],
]);
const json = (res, status, value) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
};
async function readNotes(req) {
  const limit = 32768;
  if (Number(req.headers['content-length']) > limit) throw new Error('These notes are too long. Try a shorter section.');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('These notes are too long. Try a shorter section.');
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('The notes request is not valid JSON.'); }
  return validateNotes(body?.text);
}
export function makeServer(engine = new LocalGenerator()) {
  const server = createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('permissions-policy', 'microphone=(), camera=(), geolocation=()');
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const port = server.address()?.port;
    const hosts = ['127.0.0.1:' + port, 'localhost:' + port];
    if (!hosts.includes(req.headers.host)) return json(res, 403, { error: 'Open Clarity at its localhost address.' });
    if (req.headers.origin && !hosts.some((host) => req.headers.origin === 'http://' + host)) return json(res, 403, { error: 'Only the local Clarity app can access your notes.' });
    try {
      const url = new URL(req.url, 'http://' + req.headers.host);
      if (req.method === 'GET' && url.pathname === '/api/status') return json(res, 200, { state: engine.state, model: MODEL_NAME, sdkVersion: SDK_VERSION, runtime: 'local-cpu', maxTextBytes: MAX_TEXT_BYTES });
      if (req.method === 'GET' && assets.has(url.pathname)) {
        const [file, type] = assets.get(url.pathname);
        const data = await readFile(new URL('../public/' + file, import.meta.url));
        res.writeHead(200, { 'content-type': type + '; charset=utf-8' });
        return res.end(data);
      }
      if (url.pathname !== '/api/organize' || req.method !== 'POST') return json(res, 404, { error: 'Not found.' });
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '') || req.headers['x-clarity-local'] !== '1') return json(res, 415, { error: 'Use Clarity to submit your notes.' });
      if (engine.busy) return json(res, 409, { error: 'Another note is being organized. Please wait.' });
      let text;
      try { text = await readNotes(req); } catch (error) { return json(res, 400, { error: error.message }); }
      if (engine.busy) return json(res, 409, { error: 'Another note is being organized. Please wait.' });
      res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'x-accel-buffering': 'no' });
      res.flushHeaders();
      const controller = new AbortController();
      const disconnect = () => { if (!res.writableEnded) controller.abort(); };
      res.on('close', disconnect);
      const report = (event) => { if (!res.destroyed) res.write(JSON.stringify(event) + '\n'); };
      const heartbeat = setInterval(() => report({ type: 'heartbeat' }), 10000);
      const timeout = setTimeout(() => controller.abort(), 600000);
      try {
        const result = await engine.generate(text, report, controller.signal);
        report({ type: 'done', result });
      } catch (error) {
        report({ type: 'error', message: error.message || 'Generation failed. Check the terminal for details.' });
      } finally {
        clearInterval(heartbeat);
        clearTimeout(timeout);
        res.off('close', disconnect);
        text = '';
        res.end();
      }
    } catch {
      if (!res.headersSent) json(res, 500, { error: 'Clarity could not complete the request.' });
      else res.end();
    }
  });
  server.requestTimeout = 30000;
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  const engine = new LocalGenerator();
  const server = makeServer(engine);
  server.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log('Clarity → http://127.0.0.1:' + port + '\nQVAC ' + SDK_VERSION + ' · text AI on this computer · Ctrl+C to quit'));
  const quit = async () => {
    server.close();
    const deadline = setTimeout(() => process.exit(0), 5000);
    deadline.unref();
    await engine.close().catch(() => {});
    process.exit(0);
  };
  process.once('SIGINT', quit);
  process.once('SIGTERM', quit);
}
