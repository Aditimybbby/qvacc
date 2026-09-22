# Real inference evidence

Run `npx playwright install chromium`, then `npm run capture`.
The script starts its own loopback server, loads the installed QVAC SDK,
generates from the public sample notes, and saves the browser screenshot
only after actual model output succeeds.

Outputs: `clarity-working.png`, `input.txt`, `output.md`, `runtime.json`.
These generated files are ignored by Git to avoid accidentally publishing
private notes. The GitHub verification workflow uploads the public sample
outputs as an artifact only after success.

For a public submission, review the screenshot, then deliberately attach
it to your X post. If committing it here, use
`git add -f evidence/clarity-working.png`. Do not use unit-test output or
a fabricated image as proof of local inference.
