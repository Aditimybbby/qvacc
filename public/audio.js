import { encodeWav, SAMPLE_RATE, MAX_SECONDS } from './wav.js';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export async function prepareAudio(blob, { trimToLimit = false } = {}) {
  if (!blob.size) throw new Error('This recording is empty. Try recording again.');
  if (blob.size > MAX_FILE_BYTES) throw new Error('Choose an audio file no larger than 25 MB.');
  const context = new AudioContext();
  try {
    let decoded;
    try { decoded = await context.decodeAudioData(await blob.arrayBuffer()); }
    catch { throw new Error('This browser could not read that audio format. Try a WAV or MP3 file.'); }
    if (!decoded.length || !Number.isFinite(decoded.duration)) throw new Error('This recording contains no audio.');
    if (decoded.duration > MAX_SECONDS && !trimToLimit) throw new Error('Choose a recording up to 3 minutes long.');
    const frames = Math.min(SAMPLE_RATE * MAX_SECONDS, Math.round(decoded.duration * SAMPLE_RATE));
    if (!frames) throw new Error('This recording is too short.');
    const offline = new OfflineAudioContext(1, frames, SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    const samples = rendered.getChannelData(0);
    const wav = encodeWav(samples);
    return { wav, samples, seconds: frames / SAMPLE_RATE, blob: new Blob([wav], { type: 'audio/wav' }) };
  } finally {
    await context.close();
  }
}

export function drawWaveform(canvas, samples) {
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = '#477362';
  context.lineWidth = 2;
  context.beginPath();
  for (let x = 0; x < canvas.width; x += 3) {
    const start = Math.floor(x / canvas.width * samples.length);
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor((x + 3) / canvas.width * samples.length)));
    let peak = 0;
    for (let i = start; i < end; i++) peak = Math.max(peak, Math.abs(samples[i]));
    const height = Math.max(1, peak * canvas.height * 0.46);
    context.moveTo(x, canvas.height / 2 - height);
    context.lineTo(x, canvas.height / 2 + height);
  }
  context.stroke();
}
