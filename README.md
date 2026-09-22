# Clarity

**Messy notes in. A clear way forward.** Clarity turns pasted notes into a
summary, key points, and next steps using a small text model on your own
computer. Edit the result, check off tasks, copy it, or save it as Markdown.

The application uses **@qvac/sdk 0.20.0**. Its main action calls the real
`loadModel` and `completion` functions. Generated output comes from QVAC;
there is no cloud AI API, API key, preset answer, or non-AI replacement.

## Install and run

Use Node.js **22.17 or newer** and npm. This is a desktop app with a local
browser interface. It runs on the computer where you start Node.

```sh
git clone --branch feat/clarity-notes https://github.com/Aditimybbby/qvacc.git
cd qvacc
npm ci
npm start
```

Open **http://127.0.0.1:4173** in a browser on that computer. Click **Try
example notes**, or paste your own notes, then **Organize my notes**.
Allow the first model download to finish. It is approximately 382 MB;
later runs reuse the cached model. The SDK's native dependencies also need
disk space, so leave several GB free.

For an existing checkout, stop the old server with Ctrl+C and run:

```sh
git fetch origin
git switch feat/clarity-notes
git pull --ff-only
npm ci
npm start
```

The default model is **Qwen3 0.6B Q4**. CPU execution is requested explicitly.
No microphone, speaker, camera, or audio file is used.

### Native runtime requirements

- Linux: install `libatomic1` if missing. A recent desktop distribution is
  recommended; see the official host requirements for native library details.
- Windows: QVAC requires a supported **Vulkan runtime, even for CPU inference**.
  A Windows RDP or virtual machine can lack this runtime. A text interface
  removes microphone requirements, but does not remove the SDK's native
  runtime requirements.

Check the [official system requirements](https://docs.qvac.tether.io/system-requirements/)
if the worker cannot start. An error is shown in the app; it is never
replaced with a fake summary.

If you previously set `QVAC_MODEL_PATH` to a speech model, clear that setting
before running Clarity. In Windows Git CMD:

```cmd
set QVAC_MODEL_PATH=
npm start
```

## What you can do

- Paste short notes or import a small UTF-8 `.txt` or `.md` file.
- Generate a summary, key points, and next steps entirely on this computer.
- See model download progress and text appear as it is generated.
- Cancel generation and keep the original notes.
- Edit the AI draft, check off generated tasks, copy, or export Markdown.

Input is limited to 6,000 UTF-8 bytes to fit the small model's context.
Output is limited to 700 tokens. The app reports when that limit is reached.
Small models can miss details or invent facts; review names, dates, and tasks.

## QVAC integration

`src/generator.js` dynamically imports the declared SDK and uses:

1. `loadModel` with `QWEN3_600M_INST_Q4`, the
   `llamacpp-completion` engine, and CPU configuration.
2. `completion` with the user's notes, consuming `events` and `final`.
3. `cancel` by request ID and `unloadModel` on shutdown.

The configured plugin is `llamacpp-completion`. The official HTTP source
is supplied as a checksum-validated fallback for the SDK's catalog model.
The integration follows the [QVAC text API](https://docs.qvac.tether.io/ai-capabilities/text-generation/)
and its published SDK declarations. It does not copy an examples app.

All inference runs in the QVAC worker on the same machine as Node.
The browser only talks to that computer over loopback HTTP.

## Privacy and offline use

The server binds to `127.0.0.1` only. Host and origin checks, bounded
requests, and a restrictive content policy are included. Microphone and
camera permissions are disabled. Do not expose this single-user app to the
public internet.

Notes and generated text remain in application memory unless you export
them. There is no analytics service, external font, account, or note
database. Refreshing clears the session. Model files are cached in
`.qvac/`. KV-cache persistence is disabled for note generation.

Installation and the first model download need internet access. To use an
existing, compatible text-generation GGUF directly, set `QVAC_MODEL_PATH`:

```powershell
$env:QVAC_MODEL_PATH = 'C:\\models\\Qwen3-0.6B-Q4_0.gguf'
npm start
```

On macOS/Linux:

```sh
QVAC_MODEL_PATH=/absolute/path/Qwen3-0.6B-Q4_0.gguf npm start
```

A speech model is not compatible. Set `PORT` to change the local port.

## Verify and capture actual output

```sh
npm test
npm run check:sdk
npm run smoke
npx playwright install chromium
npm run capture
```

- `npm test` covers validation, model lifecycle, cancellation, retries,
  streaming, static assets, and localhost protections using test doubles.
- `check:sdk` imports the actual installed package and checks its exports.
- `smoke` runs actual local inference on `samples/notes.txt`. To use another
  text file: `npm run smoke -- path/to/notes.txt`.
- `capture` starts its own local server, runs the real browser flow, and
  saves a screenshot only after actual QVAC output passes the sample check.

The capture files are `evidence/clarity-working.png`, `input.txt`,
`output.md`, and `runtime.json`. Runtime metadata identifies the OS,
architecture, SDK, model, and elapsed inference time.

The GitHub verification workflow runs unit tests and a separate native
inference/browser capture job. Its **clarity-real-inference** artifact is
created only if real inference and screenshot capture succeed. Unit tests
alone do not prove native inference; inspect the workflow's actual result.
A Linux CI run does not establish compatibility with every Windows/RDP host.

## Sharing the project

This repository is public and MIT licensed. Keep the three feature commits
when merging this work so their authorship and history remain visible.

After successful local inference, attach the real screenshot to an X post
that includes this repository URL and tags **@qvac**. Submit the repository
URL and the published X post URL. See [SUBMISSION.md](SUBMISSION.md).
Do not submit a mock screenshot or claim an unverified runtime works.

## License

Application code: [MIT](LICENSE). The SDK and model weights retain their
own licenses. No model weights are bundled in the repository.
