# YouTube downloads

Enjoy prefers an installed `yt-dlp` executable for YouTube imports. On macOS it also searches the standard Homebrew directories because apps launched from Finder do not inherit the interactive shell PATH. Keep `yt-dlp` and its JavaScript runtime current; successful metadata extraction alone does not prove that a media stream can be downloaded.

On macOS, install with `brew install yt-dlp`, or update an existing installation with `brew upgrade yt-dlp`. Homebrew supplies the JavaScript runtime dependency. Enjoy uses its packaged FFmpeg to merge the downloaded video and audio into an MP4, preferring H.264/AAC at up to 720p. It ignores external yt-dlp configuration and does not import browser cookies.

This integration uses a system installation, not a bundled yt-dlp binary. Other platforms must provide `yt-dlp` (or `yt-dlp.exe`) and a supported JavaScript runtime on PATH. When yt-dlp is absent, the existing bundled youtubedr path remains available, but may fail against current YouTube endpoints.

Regression check: run `node scripts/check-yt-dlp.mjs` from `enjoy/`. This tests executable discovery, argument isolation, progress split across process output chunks, output validation, failed-download cleanup, missing executable handling and cancellation. Real downloads require an additional network check.

Reference: https://github.com/yt-dlp/yt-dlp#dependencies
