import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

// Finder-launched apps do not inherit the user's interactive shell PATH.
export const downloaderEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({
  ...env,
  PATH: [...new Set([
    ...(env.PATH || "").split(path.delimiter),
    ...(process.platform === "darwin" ? ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] : []),
  ].filter(Boolean))].join(path.delimiter),
});

export const findYtDlp = (env: NodeJS.ProcessEnv): string | undefined => {
  const name = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
  for (const directory of (env.PATH || "").split(path.delimiter)) {
    if (!path.isAbsolute(directory)) continue;
    const candidate = path.join(directory, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* Try the next installation directory. */ }
  }
};

export async function downloadWithYtDlp(options: {
  binary: string;
  url: string;
  cachePath: string;
  ffmpegPath: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  onProgress: (percent: number, speed: string) => void;
}): Promise<string> {
  const directory = fs.mkdtempSync(path.join(options.cachePath, "youtube-"));
  const output = path.join(directory, "video.mp4");
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(options.binary, [
        "--ignore-config", "--no-playlist", "--newline", "--no-colors",
        "--socket-timeout", "30", "--retries", "3",
        "--ffmpeg-location", options.ffmpegPath,
        "--format", "bv*[vcodec^=avc1][height<=720]+ba[ext=m4a]/b[ext=mp4]/b",
        "--merge-output-format", "mp4", "--remux-video", "mp4",
        "--progress-template", "download:ENJOY_PROGRESS %(progress._percent_str)s|%(progress._speed_str)s",
        "--output", path.join(directory, "video.%(ext)s"),
        "--", options.url,
      ], { env: options.env, signal: options.signal });
      let errorOutput = "";
      let processError: Error | undefined;
      const timeout = setTimeout(() => {
        processError = new Error("yt-dlp download timed out");
        proc.kill();
      }, 10 * 60 * 1000);
      timeout.unref();
      const lines = createInterface({ input: proc.stdout });
      lines.on("line", (line) => {
        const match = line.match(/^ENJOY_PROGRESS\s+([\d.]+)%\s*\|(.*)$/);
        if (match) options.onProgress(Math.min(100, Math.max(0, Number(match[1]))), match[2].trim());
      });
      proc.stderr.on("data", (data) => {
        errorOutput = (errorOutput + data.toString()).slice(-4000);
      });
      proc.on("error", (error) => { processError = error; });
      proc.on("close", (code) => {
        clearTimeout(timeout);
        lines.close();
        if (processError) return reject(processError);
        if (code !== 0) return reject(new Error(`yt-dlp failed (${code}): ${errorOutput.trim()}`));
        resolve();
      });
    });
    if (!fs.existsSync(output) || !fs.statSync(output).size) {
      throw new Error("yt-dlp did not produce a non-empty MP4 file");
    }
    return output;
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
