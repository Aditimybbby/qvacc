// Shared by the browser and server. No Node or DOM dependencies.
export const SAMPLE_RATE = 16000;
export const MAX_SECONDS = 180;
export const MAX_WAV_BYTES = 44 + SAMPLE_RATE * MAX_SECONDS * 2;

function bytesOf(input) {
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new Error('Expected WAV audio bytes.');
}

export function inspectWav(input) {
  const bytes = bytesOf(input);
  if (bytes.length < 44) throw new Error('The WAV file is empty or incomplete.');
  if (bytes.length > MAX_WAV_BYTES) throw new Error('Audio is too large. Keep it under 3 minutes.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Expected a RIFF/WAVE audio file.');
  if (view.getUint32(4, true) + 8 !== bytes.length) throw new Error('The WAV file size is invalid.');
  let formatSeen = false;
  let pcm;
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) throw new Error('The WAV chunk header is incomplete.');
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + size;
    const next = end + (size % 2);
    if (next > bytes.length) throw new Error('The WAV chunk is incomplete.');
    if (tag(offset) === 'fmt ') {
      if (formatSeen || size < 16) throw new Error('The WAV format chunk is invalid.');
      formatSeen = true;
      if (view.getUint16(start, true) !== 1 || view.getUint16(start + 2, true) !== 1 ||
          view.getUint32(start + 4, true) !== SAMPLE_RATE || view.getUint32(start + 8, true) !== SAMPLE_RATE * 2 ||
          view.getUint16(start + 12, true) !== 2 || view.getUint16(start + 14, true) !== 16) {
        throw new Error('Audio must be 16 kHz mono PCM16. Import it through Hush to convert it.');
      }
    } else if (tag(offset) === 'data') {
      if (pcm) throw new Error('The WAV file contains multiple audio chunks.');
      pcm = bytes.subarray(start, end);
    }
    offset = next;
  }
  if (!formatSeen || !pcm || !pcm.length || pcm.length % 2) throw new Error('The WAV file has no valid PCM16 audio.');
  const seconds = pcm.length / (SAMPLE_RATE * 2);
  if (seconds > MAX_SECONDS) throw new Error('Keep recordings under 3 minutes.');
  return { pcm, seconds, sampleRate: SAMPLE_RATE };
}

export function encodeWav(samples) {
  if (!(samples instanceof Float32Array) || !samples.length) throw new Error('No audio samples were provided.');
  if (samples.length > SAMPLE_RATE * MAX_SECONDS) throw new Error('Keep recordings under 3 minutes.');
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const tag = (offset, text) => { for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i); };
  tag(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); tag(8, 'WAVE');
  tag(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  tag(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    if (!Number.isFinite(samples[i])) throw new Error('Audio contains invalid samples.');
    const value = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}
