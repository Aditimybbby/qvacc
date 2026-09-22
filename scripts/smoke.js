import { readFile } from 'node:fs/promises';
import { LocalTranscriber } from '../src/transcriber.js';

const path = process.argv[2];
if (!path) {
  console.error('Usage: npm run smoke -- path/to/recording.wav\nProvide a 16 kHz mono PCM16 WAV, up to 3 minutes long.');
  process.exitCode = 1;
} else {
  const engine = new LocalTranscriber();
  let wav;
  try {
    wav = await readFile(path);
    const transcript = await engine.transcribe(wav, 'auto', (event) => console.error(JSON.stringify(event)));
    console.log(JSON.stringify(transcript, null, 2));
  } catch (error) {
    console.error(`Smoke check failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    wav?.fill(0);
    await engine.close();
  }
}
