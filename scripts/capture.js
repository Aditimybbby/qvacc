import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const path = process.argv[2];
if (!path) {
  console.error('Usage: npm run capture -- path/to/recording.wav\nStart Hush with npm start in another terminal first.');
  process.exitCode = 1;
} else {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1360, height: 1050 } });
    const base = `http://127.0.0.1:${process.env.PORT || 4173}`;
    await page.goto(base);
    const runtime = await (await page.request.get(`${base}/api/status`)).json();
    await page.locator('#audio-file').setInputFiles(resolve(path));
    await page.waitForFunction(() => !document.getElementById('transcribe').disabled || !document.getElementById('error').hidden);
    if (await page.locator('#error').isVisible()) throw new Error(await page.locator('#error').innerText());
    await page.locator('#transcribe').click();
    await page.waitForFunction(() => !document.getElementById('result').hidden || !document.getElementById('error').hidden, { }, { timeout: 600000 });
    if (await page.locator('#error').isVisible()) throw new Error(await page.locator('#error').innerText());
    const transcript = await page.locator('#transcript-text').inputValue();
    if (!transcript.trim()) throw new Error('No transcript was returned.');
    const output = new URL('../evidence/', import.meta.url);
    await mkdir(output, { recursive: true });
    await writeFile(new URL('transcript.txt', output), transcript);
    await writeFile(new URL('runtime.json', output), JSON.stringify(runtime, null, 2));
    await page.screenshot({ path: fileURLToPath(new URL('hush-working.png', output)), fullPage: true });
    console.log('Saved actual transcription output in evidence/.');
  } finally {
    await browser.close();
  }
}
