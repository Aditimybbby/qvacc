import { prepareAudio, drawWaveform } from './audio.js';
import { MAX_SECONDS } from './wav.js';

const $ = (id) => document.getElementById(id);
let clip = null;
let clipUrl = null;
let mode = 'idle';
let recorder = null;
let stream = null;
let recordingTimer;
let recordingLimit;
let request = null;
const clock = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

function showError(message = '') {
  $('error').textContent = message;
  $('error').hidden = !message;
}

function setMode(next) {
  mode = next;
  const busy = mode !== 'idle';
  $('record').disabled = busy && mode !== 'recording';
  for (const id of ['import', 'audio-file', 'clear', 'language']) $(id).disabled = busy;
  $('transcribe').disabled = busy || !clip;
  $('cancel').hidden = mode !== 'transcribing';
  $('record-label').textContent = mode === 'recording' ? 'Stop recording' : 'Start recording';
  $('recorder').classList.toggle('is-recording', mode === 'recording');
  $('recording-label').textContent = mode === 'recording' ? 'RECORDING YOUR THOUGHT' : 'A LITTLE ROOM TO THINK OUT LOUD';
}

function resetResult() {
  $('result').hidden = true;
  $('working').hidden = true;
  $('empty').hidden = false;
  $('transcript-text').value = '';
  $('result-badge').textContent = 'YOUR SPACE';
  $('progress').hidden = true;
  $('work-detail').textContent = '';
}

function releaseClip() {
  $('playback').pause();
  $('playback').removeAttribute('src');
  $('playback').load();
  if (clipUrl) URL.revokeObjectURL(clipUrl);
  clipUrl = null;
  clip = null;
}

async function importAudio(blob, name, trimToLimit = false) {
  showError();
  setMode('preparing');
  $('record-help').textContent = 'Preparing your audio…';
  try {
    const prepared = await prepareAudio(blob, { trimToLimit });
    releaseClip();
    clip = { ...prepared, name };
    clipUrl = URL.createObjectURL(clip.blob);
    $('playback').src = clipUrl;
    $('clip-name').textContent = name;
    $('clip-duration').textContent = clock(clip.seconds);
    $('timer').textContent = clock(clip.seconds);
    $('clip').hidden = false;
    drawWaveform($('waveform'), clip.samples);
    resetResult();
  } catch (error) {
    showError(error.message || 'Could not prepare this recording.');
  } finally {
    $('record-help').textContent = 'Just you, your mic, and a thought.';
    setMode('idle');
  }
}

function stopTracks() {
  clearInterval(recordingTimer);
  clearTimeout(recordingLimit);
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
}

$('record').addEventListener('click', async () => {
  if (mode === 'recording') {
    setMode('preparing');
    recorder.stop();
    return;
  }
  if (mode !== 'idle') return;
  showError();
  setMode('preparing');
  try {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('Recording is unavailable in this browser. You can still import an audio file.');
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recorder = new MediaRecorder(stream);
    const chunks = [];
    let failed = false;
    recorder.addEventListener('dataavailable', (event) => { if (event.data.size) chunks.push(event.data); });
    recorder.addEventListener('error', () => {
      failed = true;
      stopTracks();
      setMode('idle');
      showError('Recording failed. Check your microphone and try again.');
    });
    recorder.addEventListener('stop', () => {
      const type = recorder.mimeType;
      stopTracks();
      recorder = null;
      if (!failed) void importAudio(new Blob(chunks, { type }), 'Voice note', true);
    }, { once: true });
    recorder.start(1000);
    const started = performance.now();
    $('timer').textContent = '00:00';
    recordingTimer = setInterval(() => { $('timer').textContent = clock(Math.min(MAX_SECONDS, (performance.now() - started) / 1000)); }, 200);
    recordingLimit = setTimeout(() => {
      if (recorder?.state === 'recording') { setMode('preparing'); recorder.stop(); }
    }, MAX_SECONDS * 1000);
    setMode('recording');
  } catch (error) {
    stopTracks();
    setMode('idle');
    showError(error.name === 'NotAllowedError' ? 'Microphone access was denied. Allow it in your browser or choose an audio file.' : error.message);
  }
});

$('import').addEventListener('click', () => $('audio-file').click());
$('audio-file').addEventListener('change', () => {
  const file = $('audio-file').files[0];
  $('audio-file').value = '';
  if (file && mode === 'idle') void importAudio(file, file.name);
});
// Prevent a dropped file from navigating away and losing the current note.
document.addEventListener('dragover', (event) => event.preventDefault());
document.addEventListener('drop', (event) => event.preventDefault());
$('import').addEventListener('drop', (event) => {
  event.preventDefault();
  const file = event.dataTransfer.files[0];
  if (file && mode === 'idle') void importAudio(file, file.name);
});
$('clear').addEventListener('click', () => {
  releaseClip();
  $('clip').hidden = true;
  $('timer').textContent = '00:00';
  resetResult();
  showError();
  setMode('idle');
});

async function readEvents(response, onEvent) {
  if (!response.body) throw new Error('The local runtime returned no response.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const line of lines) if (line.trim()) onEvent(JSON.parse(line));
      if (done) { if (pending.trim()) onEvent(JSON.parse(pending)); break; }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function updateWordCount() {
  const text = $('transcript-text').value.trim();
  const count = text ? text.split(/\s+/u).length : 0;
  $('word-count').textContent = `${count} ${count === 1 ? 'word' : 'words'}`;
  $('copy').disabled = $('export').disabled = !text;
}

$('transcribe').addEventListener('click', async () => {
  if (!clip || mode !== 'idle') return;
  showError();
  resetResult();
  setMode('transcribing');
  $('empty').hidden = true;
  $('working').hidden = false;
  $('work-title').textContent = 'Getting ready to listen.';
  $('work-text').textContent = 'Connecting to your local model…';
  request = new AbortController();
  let result;
  try {
    const response = await fetch(`/api/transcribe?language=${encodeURIComponent($('language').value)}`, {
      method: 'POST', headers: { 'content-type': 'audio/wav', 'x-hush-local': '1' },
      body: clip.wav, signal: request.signal,
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(detail.error || `The local runtime returned HTTP ${response.status}.`);
    }
    await readEvents(response, (event) => {
      if (event.type === 'error') throw new Error(event.message || 'Transcription failed.');
      if (event.type === 'status') {
        $('work-title').textContent = event.stage === 'loading' ? 'Preparing your local model.' : 'Turning your thought into text.';
        $('work-text').textContent = event.message;
        if (event.stage === 'transcribing') $('progress').hidden = true;
      }
      if (event.type === 'progress' && Number.isFinite(event.percentage)) {
        const percentage = Math.max(0, Math.min(100, event.percentage));
        $('progress').hidden = false;
        $('progress').value = percentage;
        $('work-detail').textContent = `${Math.round(percentage)}% downloaded`;
      }
      if (event.type === 'done') result = event.transcript;
    });
    if (!result?.text?.trim()) throw new Error('No transcript was returned. Try a clearer recording.');
    $('transcript-text').value = result.text;
    $('result-name').textContent = clip.name;
    $('edit-state').textContent = 'Original AI transcript · you can edit this';
    $('elapsed').textContent = Number.isFinite(result.meta?.inferenceSeconds) ? `${result.meta.inferenceSeconds}s on your device` : '';
    $('result-badge').textContent = 'READY TO KEEP';
    $('result').hidden = false;
    updateWordCount();
  } catch (error) {
    $('empty').hidden = false;
    showError(error.name === 'AbortError' ? 'Transcription stopped. Your recording is ready to try again.' : error.message);
  } finally {
    request = null;
    $('working').hidden = true;
    setMode('idle');
  }
});
$('cancel').addEventListener('click', () => request?.abort());
$('transcript-text').addEventListener('input', () => { updateWordCount(); $('edit-state').textContent = 'Edited transcript'; });
$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('transcript-text').value);
    $('copy').textContent = 'Copied';
    setTimeout(() => { $('copy').textContent = 'Copy text'; }, 1500);
  } catch { showError('Could not access the clipboard. Select the transcript and copy it manually.'); }
});
function download(blob, extension) {
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = `${(clip?.name || 'voice-note').replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 80) || 'voice-note'}.${extension}`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('export').addEventListener('click', () => download(new Blob([$('transcript-text').value], { type: 'text/plain;charset=utf-8' }), 'txt'));
$('save-audio').addEventListener('click', () => { if (clip) download(clip.blob, 'wav'); });
window.addEventListener('pagehide', () => { request?.abort(); stopTracks(); if (clipUrl) URL.revokeObjectURL(clipUrl); });

fetch('/api/status').then(async (response) => {
  if (!response.ok) throw new Error('Runtime unavailable');
  const status = await response.json();
  $('runtime').textContent = `${status.model} · local CPU · ready`;
  $('sdk-version').textContent = status.sdkVersion;
}).catch(() => { $('runtime').textContent = 'Local runtime unavailable. Check that npm start is running.'; });
