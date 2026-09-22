import { readFile } from 'node:fs/promises';
import { LocalGenerator } from '../src/generator.js';
const engine = new LocalGenerator();
const deadline = setTimeout(() => { console.error('Native inference timed out.'); process.exit(1); }, 600000);
try {
  const notes = await readFile(process.argv[2] || new URL('../samples/notes.txt', import.meta.url), 'utf8');
  const result = await engine.generate(notes, (event) => {
    if (event.type === 'delta') process.stdout.write(event.text);
    else console.error(JSON.stringify(event));
  });
  if (!result.text.trim()) throw new Error('No model output.');
  console.log('\n' + JSON.stringify(result.meta, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally {
  await engine.close().catch((error) => { console.error(error.message); process.exitCode = 1; });
  clearTimeout(deadline);
}
