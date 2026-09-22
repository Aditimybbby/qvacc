import '../src/generator.js';
try {
  const sdk = await import('@qvac/sdk');
  for (const name of ['loadModel', 'completion', 'cancel', 'unloadModel']) {
    if (typeof sdk[name] !== 'function') throw new Error('Missing SDK function: ' + name);
  }
  if (!sdk.QWEN3_600M_INST_Q4) throw new Error('Missing QWEN3_600M_INST_Q4 model constant.');
  console.log('QVAC 0.20.0 exports verified: loadModel, completion, cancel, unloadModel.');
  console.log('This import check does not prove native inference. Run npm run smoke.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
