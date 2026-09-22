# Hush

**Voice notes, kept close.** Record a thought or import an audio file, then
transcribe it on your own laptop with Tether's QVAC SDK. Edit the result, copy
it, or save the transcript and recording. No cloud AI provider or API key.

## Run locally

Use Node.js **22.17 or newer** and npm. Start from a regular desktop terminal
that permits local sockets and native processes. The SDK contains native
binaries; leave a few GB of disk space for dependencies and model caching.

```sh
git clone https://github.com/Aditimybbby/qvacc.git
cd qvacc
npm ci
npm start
```

Open **http://127.0.0.1:4173** on that same computer. Click **Start recording**,
allow microphone access, and stop when finished. Or choose an audio file.
Select the spoken language and click **Turn it into text**.

The first transcription downloads the approximately **78 MB Whisper Tiny**
model. Later uses reuse the cached model. CPU inference is the default. This
is a desktop local app; it is not a remotely hosted AI service or a native
phone app.

On Linux, the native SDK may need `libatomic1`. Windows requires the Vulkan
runtime supported by QVAC even with CPU inference. Consult the current
[QVAC system requirements](https://docs.qvac.tether.io/system-requirements/)
if the worker fails to start.

## What it does

- Records up to three minutes from your microphone, with an automatic stop.
- Imports browser-decodable audio up to 25 MB: WAV, MP3, M4A, WebM and others,
  depending on browser codec support.
- Converts audio locally to 16 kHz mono PCM16, displays its waveform, and
  provides playback before transcription.
- Offers automatic language detection or a language hint, including English,
  Ukrainian, Slovak, Hindi, Spanish, French, German, Portuguese and Japanese.
  Accuracy varies by language, microphone quality and background noise.
- Shows model-download progress, supports cancelling a request, and displays
  errors without substituting a preset transcript.
- Lets you edit, copy, and export the transcript, or save the normalized WAV.

Whisper Tiny is intentionally small. Review names, punctuation and important
details; noise and silence can produce inaccurate words.

## The actual QVAC integration

The declared, exact dependency is **`@qvac/sdk` 0.20.0**. It satisfies the
submission's minimum SDK version of 0.19.0. See `package.json` and the lockfile.

`src/transcriber.js` imports the SDK and calls:

1. `loadModel` with `WHISPER_TINY`, `modelType: 'whisper'`, and CPU configuration.
2. `transcribe` with the loaded model ID and validated in-memory PCM audio.
3. `cancel` when the request is stopped, and `unloadModel` during cleanup.

These are real exported SDK functions, verified by `npm run check:sdk`.
The integration follows the
[official transcription contract](https://docs.qvac.tether.io/ai-capabilities/transcription/).
The interface and application logic are original; this is not a fork of the
QVAC examples repository.

The browser decodes and resamples the recording, then sends it over loopback
HTTP to QVAC's native worker on the same machine. Whisper Tiny processes it
locally and returns an editable transcript to the browser.

## Privacy and offline use

The server binds only to `127.0.0.1`. Your browser talks to your own computer.
Hush includes no analytics, external fonts, cloud transcription calls, or
account system. It does not write recordings or transcripts to a database or
audio directory. They remain in memory unless you explicitly export them;
reloading clears the browser session. Model files are cached in `.qvac/`.

Installation and the first model download need internet access. QVAC may use
its model registry to fetch assets. To use a known local Whisper model and
avoid asking the model registry for it, set `QVAC_MODEL_PATH` to its absolute
path before starting Hush. This must be a Whisper-compatible model, not a
text-generation GGUF.

macOS / Linux:

```sh
QVAC_MODEL_PATH=/absolute/path/ggml-tiny.bin npm start
```

PowerShell:

```powershell
$env:QVAC_MODEL_PATH = 'C:\models\ggml-tiny.bin'
npm start
```

Set `PORT` to use a different local port. Do not expose this local app to the
internet: it is designed for one person's machine, with host/origin checks,
bounded audio input, no CORS grants, and a restrictive content policy.

## Verification

```sh
npm test             # 15 unit / HTTP-boundary tests; no inference
npm run check:sdk    # imports the installed SDK and checks real exports
npm run smoke        # real QVAC inference with samples/hello.wav
```

The unit tests cover audio conversion boundaries, malformed inputs,
concurrent requests, cancellation, retry after download failure, model reuse,
and localhost protections. Test doubles appear only in the tests. They do
not establish model accuracy or prove native inference.

**Current validation:** the SDK export check and all 15 tests passed during
development. Native inference could not be completed in the development
environment because QVAC's local IPC socket was denied (`listen EPERM`).
No successful inference result or screenshot is claimed in this repository.
Run the real smoke check on your machine before submitting the project.

## Capture real output

With `npm start` running in another terminal:

```sh
npx playwright install chromium
npm run capture
```

This runs the real browser flow with the original bundled recording and
saves `evidence/hush-working.png` **only after actual transcription succeeds**.
It also saves the returned transcript and runtime metadata. You can take a
manual screenshot instead. See [evidence/README.md](evidence/README.md).

## Submission

Repository: https://github.com/Aditimybbby/qvacc

App description: Hush turns microphone recordings and imported audio into
editable transcripts on the user's laptop. It calls QVAC `loadModel` and
`transcribe` with Whisper Tiny.

After verifying a real run, attach its screenshot and post on X with the repo
link and `@qvac`. See [SUBMISSION.md](SUBMISSION.md) for the prepared text.

## License

Hush application code is [MIT licensed](LICENSE). QVAC and downloaded model
weights retain their respective licenses. No model weights are bundled here.
