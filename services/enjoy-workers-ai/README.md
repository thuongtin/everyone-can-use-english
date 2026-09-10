# Enjoy Workers AI transcription proxy

This Worker exposes one authenticated transcription endpoint backed by the native Cloudflare Workers AI binding. It never accepts or stores a Cloudflare API token.

## Runtime contract

- `GET /health` requires no authentication and returns `{ "ok": true, "model": "@cf/openai/whisper-large-v3-turbo" }`. It does not call Workers AI.
- `GET /health` also reports `acceptedFormats`, byte limits, `maxAudioSeconds`, and `deadlineMs` under `capabilities`.
- `POST /v1/transcriptions` requires `Authorization: Bearer <ENJOY_CLIENT_TOKEN>`. The configured token must contain at least 32 characters.
- Preferred input uses `Content-Type: audio/mpeg` with the MP3 bytes as the request body. `X-Audio-Language` is optional and accepts a 2 or 3 letter ISO language code.
- MP3 input must be MPEG-2 Layer III, 16 kHz, mono, structurally complete, and at most 3,601 seconds. The binary request is capped at 30,000,000 bytes using both `Content-Length` and the actual body stream.
- The JSON body is `{ "audio": "<base64 WAV>", "language": "en" }`; `language` is optional and must be a 2 or 3 letter ISO language code.
- Legacy JSON WAV input remains supported. WAV must be PCM16, 16 kHz, mono or stereo, at most 3,601 seconds. The complete JSON request is capped at 40,000,000 bytes using both `Content-Length` and the actual body stream.
- Success is `{ "ok": true, "result": { "text": "...", "segments": [{ "text": "...", "start": 0, "end": 1.2 }] } }`.
- Provider responses that contain valid text but no segments return an empty `segments` array so the client can use its full-text DTW fallback.
- Segment ends up to 20 ms beyond the WAV duration are clamped to the duration to tolerate provider timestamp rounding; larger overruns are rejected.
- Errors are `{ "ok": false, "error": { "code": "...", "message": "..." } }`. Codes are `cf_auth`, `cf_quota`, `cf_timeout`, `cf_invalid_audio`, `cf_no_speech`, `cf_invalid_response`, and `cf_failed`.

The Worker waits at most 900 seconds for Workers AI. Ending the HTTP wait does not guarantee that an already-started GPU inference is cancelled upstream.

## Verified evidence

The deployed Worker accepted one complete 323.63975 second stereo WAV request without chunking: 20,712,988 audio bytes, HTTP 200 in 14,679 ms, 4,557 transcript characters, and 49 segments. This proves that specific request worked. It does not establish the maximum accepted size or duration on Cloudflare.

The local MP3 parser accepts the existing 25,903,156 byte, 53 minute fixture at `enjoy/tmp/whisper-tiny-53min/full-audio.mp3`. No additional live inference was used for the MP3 change.

## Setup and deploy

Install this isolated package without changing the repository root lockfile:

```sh
cd services/enjoy-workers-ai
npm install
npm run check
```

Confirm that the target Worker name is `enjoy-workers-ai`, then store the client token interactively. Do not pass a secret as a command argument:

```sh
npx wrangler secret put ENJOY_CLIENT_TOKEN
```

Deploy after the secret exists:

```sh
npx wrangler deploy
```

The checked-in `account_id` pins deployment to the Cloudflare account that was verified for this project. Preview URLs are disabled; the production `workers.dev` route remains enabled.

For remote development, create an ignored `.dev.vars` containing `ENJOY_CLIENT_TOKEN`, then run `npx wrangler dev --remote`. Workers AI inference in remote development uses the Cloudflare account and may incur usage.
