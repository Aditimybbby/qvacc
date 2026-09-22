const $ = (id) => document.getElementById(id);
const EXAMPLE = 'Science project planning\nWe are comparing plant growth under sunlight and a desk lamp. Use six identical pots and the same type of seeds. Keep water and soil amounts equal. Measure plant height every Monday for four weeks.\nMaya will bring the seeds. Leo needs to prepare the measurement table before Friday. I need to find a desk lamp and write the hypothesis. We will compare average plant heights at the end and make a poster.';
let busy = false;
let controller = null;
let output = '';
let editing = false;
let completed = false;
let maxBytes = 6000;
const byteLength = (text) => new TextEncoder().encode(text.trim()).length;

function error(message = '') {
  $('error').textContent = message;
  $('error').hidden = !message;
}
function controls() {
  const text = $('notes').value.trim();
  const count = text ? text.split(/\s+/u).length : 0;
  $('word-count').textContent = count + (count === 1 ? ' word' : ' words');
  $('notes').disabled = busy;
  $('organize').disabled = busy || !text || byteLength(text) > maxBytes;
  $('clear').disabled = busy || (!text && !output);
  $('sample').disabled = busy || !!text;
  for (const id of ['import', 'notes-file']) $(id).disabled = busy;
  $('edit').disabled = busy || !completed;
  for (const id of ['copy', 'export']) $(id).disabled = busy || !completed || !output.trim();
  $('cancel').hidden = !busy;
}
function clearResult() {
  delete $('result').dataset.completed;
  delete $('result').dataset.metadata;
  output = '';
  completed = false;
  editing = false;
  $('result').hidden = true;
  $('result-content').replaceChildren();
  $('result-content').hidden = false;
  $('result-edit').hidden = true;
  $('result-edit').value = '';
  $('edit').textContent = 'Edit';
  $('empty').hidden = false;
  $('result-badge').textContent = 'YOUR SPACE';
  $('result-info').textContent = '';
  $('edit-state').textContent = 'AI draft · check the details';
}
function renderOutput() {
  const fragment = document.createDocumentFragment();
  let list = null;
  const lines = output.split('\n');
  lines.forEach((line, index) => {
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    const task = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (!line.trim()) { list = null; return; }
    if (heading) {
      const h = document.createElement('h3'); h.textContent = heading[1]; fragment.append(h); list = null;
    } else if (task) {
      const label = document.createElement('label'); label.className = 'task';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = task[1].toLowerCase() === 'x';
      checkbox.disabled = busy;
      const span = document.createElement('span'); span.textContent = task[2];
      checkbox.addEventListener('change', () => {
        const current = output.split('\n');
        current[index] = '- [' + (checkbox.checked ? 'x' : ' ') + '] ' + task[2];
        output = current.join('\n'); $('edit-state').textContent = 'Checklist updated';
      });
      label.append(checkbox, span); fragment.append(label); list = null;
    } else if (bullet) {
      if (!list) { list = document.createElement('ul'); fragment.append(list); }
      const li = document.createElement('li'); li.textContent = bullet[1]; list.append(li);
    } else {
      const p = document.createElement('p'); p.textContent = line; fragment.append(p); list = null;
    }
  });
  $('result-content').replaceChildren(fragment);
}
$('notes').addEventListener('input', () => {
  error(byteLength($('notes').value) > maxBytes ? 'These notes are too long. Try a shorter section.' : '');
  if (completed) $('result-badge').textContent = 'PREVIOUS RESULT';
  controls();
});
$('sample').addEventListener('click', () => { $('notes').value = EXAMPLE; error(); controls(); $('notes').focus(); });
$('clear').addEventListener('click', () => { $('notes').value = ''; clearResult(); error(); controls(); $('notes').focus(); });
$('import').addEventListener('click', () => $('notes-file').click());
$('notes-file').addEventListener('change', async () => {
  const file = $('notes-file').files[0]; $('notes-file').value = '';
  if (!file || busy) return;
  if (!/\.(txt|md)$/i.test(file.name)) return error('Choose a .txt or .md file.');
  if (file.size > maxBytes) return error('This file is too long. Paste a shorter section instead.');
  busy = true; controls();
  try { $('notes').value = await file.text(); clearResult(); error(); }
  catch { error('Could not read this file. Try pasting the text.'); }
  finally { busy = false; controls(); }
});
async function streamEvents(response, onEvent) {
  if (!response.body) throw new Error('The local runtime returned no response.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split('\n'); pending = lines.pop();
      for (const line of lines) if (line.trim()) onEvent(JSON.parse(line));
      if (done) { if (pending.trim()) onEvent(JSON.parse(pending)); break; }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
$('organize').addEventListener('click', async () => {
  const notes = $('notes').value.trim();
  if (busy || !notes || byteLength(notes) > maxBytes) return;
  error(); clearResult(); busy = true; controls();
  $('empty').hidden = true;
  $('working').hidden = false;
  $('work-title').textContent = 'Preparing your local AI.';
  $('work-message').textContent = 'First use may take a few minutes.';
  $('progress').hidden = true;
  $('result-badge').textContent = 'WORKING';
  controller = new AbortController();
  try {
    const response = await fetch('/api/organize', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-clarity-local': '1' },
      body: JSON.stringify({ text: notes }), signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(detail.error || 'The local runtime could not accept this note.');
    }
    let finalResult;
    await streamEvents(response, (event) => {
      if (event.type === 'error') throw new Error(event.message || 'Local generation failed.');
      if (event.type === 'status') {
        $('work-title').textContent = event.stage === 'loading' ? 'Preparing your local AI.' : 'Making sense of your notes.';
        $('work-message').textContent = event.message;
        if (event.stage === 'generating') $('progress').hidden = true;
      }
      if (event.type === 'progress' && Number.isFinite(event.percentage)) {
        $('progress').hidden = false; $('progress').value = Math.max(0, Math.min(100, event.percentage));
      }
      if (event.type === 'delta') {
        output += event.text;
        $('result').hidden = false;
        renderOutput();
      }
      if (event.type === 'done') finalResult = event.result;
    });
    if (!finalResult?.text?.trim()) throw new Error('The local model returned no result. Try again.');
    output = finalResult.text;
    completed = true;
    $('result').hidden = false;
    $('result-badge').textContent = 'READY TO KEEP';
    $('result-info').textContent = finalResult.meta.model + ' · ' + finalResult.meta.seconds + 's · on device';
    $('result').dataset.completed = 'true';
    $('result').dataset.metadata = JSON.stringify(finalResult.meta);
    if (finalResult.meta.truncated) error('The model reached its output limit. Review the ending or try a shorter note.');
  } catch (problem) {
    clearResult();
    error(problem.name === 'AbortError' ? 'Generation stopped. Your original notes are still here.' : problem.message);
  } finally {
    busy = false; controller = null; $('working').hidden = true;
    if (completed) renderOutput();
    controls();
  }
});
$('cancel').addEventListener('click', () => controller?.abort());
$('edit').addEventListener('click', () => {
  editing = !editing;
  if (editing) $('result-edit').value = output;
  else { output = $('result-edit').value; renderOutput(); }
  $('result-content').hidden = editing;
  $('result-edit').hidden = !editing;
  $('edit').textContent = editing ? 'Done editing' : 'Edit';
  if (editing) $('result-edit').focus();
});
$('result-edit').addEventListener('input', () => { output = $('result-edit').value; $('edit-state').textContent = 'Edited by you'; controls(); });
$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(output); $('copy').textContent = 'Copied';
    setTimeout(() => { $('copy').textContent = 'Copy'; }, 1500);
  } catch { error('Clipboard access failed. Use Edit to select and copy the text manually.'); }
});
$('export').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([output + '\n'], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = 'clarity-notes.md';
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
window.addEventListener('pagehide', () => controller?.abort());
fetch('/api/status').then(async (response) => {
  if (!response.ok) throw new Error('Runtime unavailable');
  const status = await response.json(); maxBytes = status.maxTextBytes;
  $('runtime').textContent = 'QVAC ' + status.sdkVersion + ' · ' + status.model + ' · connected';
  controls();
}).catch(() => { $('runtime').textContent = 'Start the local runtime with npm start.'; });
controls();
