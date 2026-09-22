import { fileURLToPath } from 'node:url';
export default {
  plugins: ['llamacpp-completion'],
  cacheDirectory: fileURLToPath(new URL('./.qvac/models', import.meta.url)),
  loggerConsoleOutput: false,
  loggerLevel: 'error',
  httpDownloadConcurrency: 3,
  httpConnectionTimeoutMs: 15000,
  registryDownloadMaxRetries: 2,
  registryStreamTimeoutMs: 60000,
};
