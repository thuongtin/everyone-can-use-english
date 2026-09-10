import { app } from "electron";
import path from "path";
import { execFile, spawn } from "child_process";
import fs from "fs-extra";
import os from "os";
import log from "@main/logger";
import snakeCase from "lodash/snakeCase";
import settings from "@main/settings";
import mainWin from "@main/window";
import ffmpegPath from "ffmpeg-static";
import { downloaderEnv, findYtDlp, downloadWithYtDlp } from "./yt-dlp";
import { assertAllowedNetworkUrl } from "@/lib/network-policy";

//  youtubedr bin file will be in /app.asar.unpacked instead of /app.asar
const __dirname = import.meta.dirname.replace("app.asar", "app.asar.unpacked");

const logger = log.scope("YOUTUBEDR");

type YoutubeInfoType = {
  Title: string;
  Id: string;
  Author: string;
  Duration: number;
  Description: string;
  Formats: {
    Itag: number;
    FPS: number;
    VideoQuality: string;
    AudioQuality: string;
    AudioChannels: number;
    Size: number;
    Bitrate: number;
    MimeType: string;
  }[];
};

const validQueryDomains = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "gaming.youtube.com",
]);

const validPathDomains =
  /^https?:\/\/(youtu\.be\/|(www\.)?youtube\.com\/(embed|v|shorts)\/)/;

const ONE_MINUTE = 1000 * 60; // 1 minute
const TEN_MINUTES = 1000 * 60 * 10; // 10 minutes

class Youtubedr {
  private binFile: string;
  private abortController: AbortController | null = null;

  constructor() {
    this.binFile = path.join(
      __dirname,
      "lib",
      "youtubedr",
      os.platform() === "win32" ? "youtubedr.exe" : "youtubedr"
    );
  }

  async autoDownload(url: string) {
    const videoId = this.assertAllowedYtURL(url, "youtube.auto-download");
    const env = downloaderEnv(this.proxyEnv());
    const binary = findYtDlp(env);
    if (binary) {
      this.abortController?.abort();
      this.abortController = new AbortController();
      logger.info("Downloading YouTube video with yt-dlp", videoId);
      return downloadWithYtDlp({
        binary, url, env,
        cachePath: settings.cachePath(),
        ffmpegPath: ffmpegPath.replace("app.asar", "app.asar.unpacked"),
        signal: this.abortController.signal,
        onProgress: (received, speed) => {
          if (!mainWin.win.webContents.isDestroyed()) {
            mainWin.win.webContents.send("download-on-state", {
              name: videoId, state: "progressing", received, speed,
            });
          }
        },
      });
    }
    logger.debug("Fetching YouTube video info", videoId);

    const info = await this.info(url);
    // Ensure the format is video and has audio
    const format = info.Formats.find(
      (format: any) =>
        Boolean(format.AudioChannels) && format.MimeType.startsWith("video")
    );

    if (!format) {
      throw new Error("No suitable format found");
    }

    const filename = `${snakeCase(info.Title)}.mp4`;
    const directory = settings.cachePath();

    logger.debug("Selected YouTube format", format.Itag);
    return this.download(url, {
      quality: format.Itag,
      filename,
      directory,
    });
  }

  async download(
    url: string,
    options: {
      quality?: string | number;
      filename?: string;
      directory?: string;
      webContents?: Electron.WebContents;
    } = {}
  ): Promise<string> {
    const videoId = this.assertAllowedYtURL(url, "youtube.download-fallback");
    this.abortController?.abort();
    this.abortController = new AbortController();

    const {
      quality,
      filename = videoId + ".mp4",
      directory = app.getPath("downloads"),
      webContents = mainWin.win.webContents,
    } = options;
    logger.info("Downloading YouTube video with youtubedr", videoId);

    let currentSpeed = "";

    return new Promise((resolve, reject) => {
      const proc = spawn(
        this.binFile,
        [
          "download",
          url,
          `--quality=${quality || "medium"}`,
          `--filename=${filename}`,
          `--directory=${directory}`,
        ],
        {
          timeout: TEN_MINUTES,
          signal: this.abortController.signal,
          env: downloaderEnv(this.proxyEnv()),
        }
      );

      proc.stdout.on("data", (data) => {
        const output = data.toString();
        const match = output.match(/iB (\d+) % \[/);

        if (match) {
          const speed = output.match(/ ] (.*)/);
          if (speed) {
            currentSpeed = speed[1];
          }
          webContents.send("download-on-state", {
            name: filename,
            state: "progressing",
            received: parseInt(match[1]),
            speed: currentSpeed,
          });
        }
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          webContents.send("download-on-state", {
            name: filename,
            state: "interrupted",
          });
          return reject(
            new Error(`Youtubedr download failed with code: ${code}`)
          );
        }

        if (fs.existsSync(path.join(directory, filename))) {
          const stat = fs.statSync(path.join(directory, filename));
          if (stat.size === 0) {
            reject(new Error("Youtubedr download failed: empty file"));
          } else {
            resolve(path.join(directory, filename));
          }
        } else {
          reject(new Error("Youtubedr download failed: unknown error"));
        }
      });
    });
  }

  async info(url: string): Promise<YoutubeInfoType> {
    this.assertAllowedYtURL(url, "youtube.info-fallback");
    return new Promise((resolve, reject) => {
      execFile(
        this.binFile,
        ["info", url, "--format", "json"],
        {
          timeout: ONE_MINUTE,
          env: downloaderEnv(this.proxyEnv()),
        },
        (error, stdout, stderr) => {
          if (error) {
            logger.error("Youtubedr info failed", {
              code: error.code,
              killed: error.killed,
              signal: error.signal,
            });
            return reject(new Error("Youtubedr info failed"));
          }

          if (stderr) {
            logger.error("Youtubedr info returned stderr");
            return reject(new Error("Youtubedr info failed"));
          }

          if (stdout) {
            try {
              const info = JSON.parse(stdout);
              return resolve(info);
            } catch (err) {
              logger.error("json result failed to parse", err);
              return reject(new Error("Youtubedr info returned invalid JSON"));
            }
          }

          return reject(new Error("Youtubedr info failed: unknown error"));
        }
      );
    });
  }

  // ref: https://github.com/fent/node-ytdl-core/blob/master/lib/url-utils.js
  validateYtVideoId = (id: string) => {
    return /^[a-zA-Z0-9_-]{11}$/.test(id.trim());
  };

  getYtVideoId = (url: string) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw Error("Unsupported YouTube URL protocol");
    }
    let id = parsed.searchParams.get("v");
    if (validPathDomains.test(url.trim()) && !id) {
      const paths = parsed.pathname.split("/");
      id = parsed.host === "youtu.be" ? paths[1] : paths[2];
    } else if (parsed.hostname && !validQueryDomains.has(parsed.hostname)) {
      throw Error("Not a YouTube domain");
    }
    if (!id) {
      throw Error("No YouTube video id found");
    }
    id = id.substring(0, 11);
    if (!this.validateYtVideoId(id)) {
      throw Error(`Invalid video id: "${id}"`);
    }

    return id;
  };

  private assertAllowedYtURL(url: string, operation: string): string {
    // The child process owns subsequent redirects, so this covers its initial URL only.
    assertAllowedNetworkUrl(url, { transport: "youtube-subprocess", operation });
    return this.getYtVideoId(url);
  }

  validateYtURL = (url: string) => {
    try {
      this.getYtVideoId(url);
      return true;
    } catch (error) {
      logger.warn(error.message);
      return false;
    }
  };

  abortDownload() {
    this.abortController?.abort();
  }

  /**
   * Set the proxy environment variables
   * @returns env object
   */
  proxyEnv = () => {
    // keep current environment variables
    const env = { ...process.env };
    const proxyConfig = settings.getSync("proxy") as ProxyConfigType;
    if (proxyConfig?.enabled && proxyConfig.url) {
      assertAllowedNetworkUrl(proxyConfig.url, {
        transport: "youtube-subprocess",
        operation: "proxy",
      });
      env["HTTP_PROXY"] = proxyConfig.url;
      env["HTTPS_PROXY"] = proxyConfig.url;
    }
    return env;
  };
}

export default new Youtubedr();
