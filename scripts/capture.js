import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { chromium } from '@playwright/test';
import { makeServer } from '../src/server.js';
import { LocalGenerator } from '../src/generator.js';
const engine = new LocalGenerator();
const server = makeServer(engine);
let browser;
const deadline = setTimeout(() => { console.error('Capture timed out before verified inference.'); process.exit(1); }, 660000);
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 1100 } });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.locator('#sample').click();
  const notes = await page.locator('#notes').inputValue();
  await page.locator('#organize').click();
  await page.waitForFunction(() => document.getElementById('result').dataset.completed === 'true' || !document.getElementById('error').hidden, {}, { timeout: 600000 });
  if (await page.locator('#error').isVisible()) throw new Error(await page.locator('#error').innerText());
  const metadata = JSON.parse(await page.locator('#result').getAttribute('data-metadata'));
  if (metadata.runtime !== 'local-cpu' || !metadata.functions.includes('completion')) throw new Error('Capture did not use the real QVAC completion path.');
  await page.locator('#edit').click();
  const output = await page.locator('#result-edit').inputValue();
  await page.locator('#edit').click();
  if (output.trim().length < 40 || !/plant|growth|seed/i.test(output)) throw new Error('Model output did not meaningfully summarize the sample notes.');
  if (errors.length) throw new Error(errors.join('\n'));
  const directory = new URL('../evidence/', import.meta.url);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL('input.txt', directory), notes);
  await writeFile(new URL('output.md', directory), output);
  await writeFile(new URL('runtime.json', directory), JSON.stringify({ ...metadata, platform: process.platform, architecture: process.arch, node: process.version }, null, 2));
  await page.screenshot({ path: fileURLToPath(new URL('clarity-working.png', directory)), fullPage: true });
  console.log('Verified real QVAC output and captured evidence/clarity-working.png');
  console.log(JSON.stringify(metadata));
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally {
  await browser?.close(); server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await engine.close().catch((error) => { console.error(error.message); process.exitCode = 1; });
  clearTimeout(deadline);
}
