import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav, inspectWav, MAX_SECONDS, MAX_WAV_BYTES, SAMPLE_RATE } from '../public/wav.js';

test('encodes little-endian mono PCM16 with clamped samples', () => {
  const wav = encodeWav(Float32Array.of(-2, -1, -0.5, 0, 0.5, 1, 2));
  const { pcm, seconds, sampleRate } = inspectWav(wav);
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  assert.deepEqual(Array.from({ length: 7 }, (_, i) => view.getInt16(i * 2, true)), [-32768, -32768, -16384, 0, 16384, 32767, 32767]);
  assert.equal(seconds, 7 / 16000);
  assert.equal(sampleRate, 16000);
  assert.equal(new TextDecoder().decode(wav.subarray(0, 4)), 'RIFF');
});

test('accepts ArrayBuffer and respects offsets in Node Buffer views', () => {
  const wav = encodeWav(new Float32Array(16000));
  const padded = Buffer.alloc(wav.length + 40, 0xff);
  padded.set(wav, 17);
  assert.equal(inspectWav(wav.buffer).seconds, 1);
  assert.deepEqual(inspectWav(padded.subarray(17, 17 + wav.length)).pcm, inspectWav(wav).pcm);
});

test('accepts the three-minute boundary and rejects longer audio', () => {
  const wav = encodeWav(new Float32Array(SAMPLE_RATE * MAX_SECONDS));
  assert.equal(wav.length, MAX_WAV_BYTES);
  assert.equal(inspectWav(wav).seconds, MAX_SECONDS);
  assert.throws(() => encodeWav(new Float32Array(SAMPLE_RATE * MAX_SECONDS + 1)), /3 minutes/);
  assert.throws(() => inspectWav(new Uint8Array(MAX_WAV_BYTES + 1)), /too large/);
});

test('rejects non-audio, truncated containers, and inconsistent file sizes', () => {
  assert.throws(() => inspectWav('audio'), /bytes/);
  assert.throws(() => inspectWav(new Uint8Array(43)), /incomplete/);
  const wav = encodeWav(Float32Array.of(0, 1));
  assert.throws(() => inspectWav(wav.subarray(0, wav.length - 1)), /size/);
  wav[0] = 0;
  assert.throws(() => inspectWav(wav), /RIFF/);
});

test('rejects unsupported PCM format and inconsistent channel metadata', () => {
  for (const [offset, value, width] of [[20, 3, 2], [22, 2, 2], [24, 48000, 4], [28, 64000, 4], [32, 4, 2], [34, 8, 2]]) {
    const wav = encodeWav(Float32Array.of(0, 1));
    const view = new DataView(wav.buffer);
    if (width === 4) view.setUint32(offset, value, true);
    else view.setUint16(offset, value, true);
    assert.throws(() => inspectWav(wav), /16 kHz mono PCM16/);
  }
});

test('rejects empty, missing, malformed, and duplicate data chunks', () => {
  const empty = encodeWav(Float32Array.of(0)).slice(0, 44);
  new DataView(empty.buffer).setUint32(4, 36, true);
  new DataView(empty.buffer).setUint32(40, 0, true);
  assert.throws(() => inspectWav(empty), /no valid/);
  const wav = encodeWav(Float32Array.of(0, 1));
  const missing = wav.slice(); missing[36] = 0;
  assert.throws(() => inspectWav(missing), /no valid/);
  const odd = wav.slice(); new DataView(odd.buffer).setUint32(40, 3, true);
  assert.throws(() => inspectWav(odd), /no valid/);
  const truncated = wav.slice(); new DataView(truncated.buffer).setUint32(40, 100, true);
  assert.throws(() => inspectWav(truncated), /incomplete/);
  const duplicate = new Uint8Array(wav.length + 12);
  duplicate.set(wav); duplicate.set(wav.subarray(36), wav.length);
  new DataView(duplicate.buffer).setUint32(4, duplicate.length - 8, true);
  assert.throws(() => inspectWav(duplicate), /multiple/);
});

test('skips padded ancillary RIFF chunks while preserving PCM bytes', () => {
  const wav = encodeWav(Float32Array.of(0.25, -0.25));
  const withMetadata = new Uint8Array(wav.length + 10);
  withMetadata.set(wav.subarray(0, 36));
  withMetadata.set([74, 85, 78, 75, 1, 0, 0, 0, 42, 0], 36); // JUNK + one byte + padding
  withMetadata.set(wav.subarray(36), 46);
  new DataView(withMetadata.buffer).setUint32(4, withMetadata.length - 8, true);
  assert.deepEqual(inspectWav(withMetadata).pcm, inspectWav(wav).pcm);
});

test('rejects empty and non-finite samples at encoding', () => {
  assert.throws(() => encodeWav(new Float32Array()), /No audio/);
  assert.throws(() => encodeWav(Float32Array.of(NaN)), /invalid/);
  assert.throws(() => encodeWav(Float32Array.of(Infinity)), /invalid/);
});
