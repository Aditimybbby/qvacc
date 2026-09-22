import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalTranscriber, MODEL_NAME, SDK_VERSION, LANGUAGES } from './transcriber.js';
import { inspectWav, MAX_WAV_BYTES } from '../public/wav.js';

const assets = new Map([
  ['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']],
  ['/audio.js', ['audio.js', 'text/javascript']], ['/wav.js', ['wav.js', 'text/javascript']],
  ['/style.css', ['style.css', 'text/css']], ['/icon.svg', ['icon.svg', 'image/svg+xml']],
]);
const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };

async function readAudio(req) {
  if (Number(req.headers['content-length']) > MAX_WAV_BYTES) throw new Error('Audio is too large. Keep it under 3 minutes.');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_WAV_BYTES) throw new Error('Audio is too large. Keep it under 3 minutes.');
    chunks.push(chunk);
  }
  const data = Buffer.concat(chunks);
  inspectWav(data);
  return data;
}

export function createHandler(engine, getPort) {
  return async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('permissions-policy', 'microphone=(self), camera=(), geolocation=()');
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const hosts = [`127.0.0.1:${getPort()}`, `localhost:${getPort()}`];
    if (!hosts.includes(req.headers.host)) return json(res, 403, { error: 'Open Hush at its localhost address.' });
    if (req.headers.origin && !hosts.some((host) => req.headers.origin === `http://${host}`)) return json(res, 403, { error: 'Only the local Hush app can access transcription.' });
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (req.method === 'GET' && url.pathname === '/api/status') return json(res, 200, { state: engine.state, model: MODEL_NAME, sdkVersion: SDK_VERSION, runtime: 'local-cpu' });
      if (req.method === 'GET' && assets.has(url.pathname)) {
        const [file, type] = assets.get(url.pathname);
        const data = await readFile(new URL(`../public/${file}`, import.meta.url));
        res.writeHead(200, { 'content-type': `${type}; charset=utf-8` });
        return res.end(data);
      }
      if (url.pathname !== '/api/transcribe' || req.method !== 'POST') return json(res, 404, { error: 'Not found.' });
      if (!/^audio\/wav(?:;|$)/i.test(req.headers['content-type'] || '') || req.headers['x-hush-local'] !== '1') return json(res, 415, { error: 'Use Hush to prepare and submit your recording.' });
      const language = url.searchParams.get('language') || 'auto';
      if (!LANGUAGES.includes(language)) return json(res, 400, { error: 'Choose a supported language.' });
      if (engine.busy) return json(res, 409, { error: 'Another recording is being transcribed. Please wait.' });
      let wav;
      try { wav = await readAudio(req); } catch (error) { return json(res, 400, { error: error.message }); }
      if (engine.busy) return json(res, 409, { error: 'Another recording is being transcribed. Please wait.' });
      res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'x-accel-buffering': 'no' });
      res.flushHeaders();
      const controller = new AbortController();
      res.on('close', () => { if (!res.writableEnded) controller.abort(); });
      const report = (event) => { if (!res.destroyed) res.write(JSON.stringify(event) + '\n'); };
      const heartbeat = setInterval(() => report({ type: 'heartbeat' }), 10000);
      try {
        const transcript = await engine.transcribe(wav, language, report, controller.signal);
        report({ type: 'done', transcript });
      } catch (error) {
        report({ type: 'error', message: error.message || 'Transcription failed. Check the terminal.' });
      } finally {
        clearInterval(heartbeat);
        wav.fill(0); // The server keeps no audio files, transcript database, or request logs.
        res.end();
      }
    } catch {
      if (!res.headersSent) json(res, 500, { error: 'Hush could not complete the request.' });
      else res.end();
    }
  };
}

export function makeServer(engine = new LocalTranscriber()) {
  const server = createServer(createHandler(engine, () => server.address()?.port));
  server.requestTimeout = 30000;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  const engine = new LocalTranscriber();
  const server = makeServer(engine);
  server.listen(port, '127.0.0.1', () => console.log(`Hush → http://127.0.0.1:${port}\nQVAC ${SDK_VERSION} · local CPU · Ctrl+C to quit`));
  server.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
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
