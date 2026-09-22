import '../src/transcriber.js'; // Set the same QVAC configuration as the server.

try {
  const sdk = await import('@qvac/sdk');
  for (const name of ['loadModel', 'transcribe', 'cancel', 'unloadModel']) {
    if (typeof sdk[name] !== 'function') throw new Error(`Missing QVAC function: ${name}`);
  }
  if (!sdk.WHISPER_TINY) throw new Error('Missing QVAC model constant: WHISPER_TINY');
  console.log('QVAC exports verified. This check does not run native inference.');
} catch (error) {
  console.error(`QVAC check failed: ${error.message}\nRun npm ci and check the QVAC system requirements.`);
  process.exitCode = 1;
}
