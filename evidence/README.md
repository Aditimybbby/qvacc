# Capture a real transcription

Start Hush with `npm start`. In another terminal, run:

```sh
npx playwright install chromium
npm run capture -- "path/to/recording.wav"
```

Choose a recording with clear speech, no longer than three minutes and no
larger than 25 MB. The browser converts it to the format QVAC expects.
The first transcription may download the model. A local model can instead
be configured with `QVAC_MODEL_PATH` when starting the server.

The capture script saves `hush-working.png`, `transcript.txt`, and
`runtime.json` here only after a real, nonempty transcript is returned.
These outputs are ignored by Git because they can contain personal audio
content. No inference screenshot or transcript is bundled with the project.
