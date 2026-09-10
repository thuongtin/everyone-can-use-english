import log from "@main/logger";
import { WebContentsView, ipcMain } from "electron";
import {
  extractYoutubeChannel,
  type YoutubeChannel,
} from "./youtube-video-parser";

const logger = log.scope("providers/youtube-provider");
const DEFAULT_SCRAPE_TIMEOUT_MS = 20_000;
const EXPECTED_UNAVAILABLE_ERRORS = [
  "ERR_INTERNET_DISCONNECTED",
  "ERR_PROXY_CONNECTION_FAILED",
] as const;

const errorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Unknown YouTube navigation failure";
};

const isExpectedUnavailable = (error: unknown): boolean => {
  const message = errorMessage(error);
  return EXPECTED_UNAVAILABLE_ERRORS.some((code) => message.includes(code));
};

export class YoutubeProvider {
  constructor(private readonly scrapeTimeoutMs = DEFAULT_SCRAPE_TIMEOUT_MS) {}

  scrape = async (url: string) => {
    return new Promise<string>((resolve, reject) => {
      const view = new WebContentsView();
      const contents = view.webContents;
      let settled = false;
      let loadCompleted = false;
      let stopped = false;
      let extracting = false;
      const timeout = setTimeout(() => {
        finishNavigationFailure(
          new Error(`YouTube scrape timed out after ${this.scrapeTimeoutMs} ms`),
        );
      }, Math.max(1, this.scrapeTimeoutMs));

      const cleanup = () => {
        clearTimeout(timeout);
        contents.removeListener("did-stop-loading", handleStopped);
        contents.removeListener("did-fail-load", handleFailed);
        if (!contents.isDestroyed()) contents.close();
      };

      const finish = (result: { html: string } | { error: Error }) => {
        if (settled) return;
        settled = true;
        cleanup();
        if ("html" in result) resolve(result.html);
        else reject(result.error);
      };

      const finishNavigationFailure = (error: unknown) => {
        if (settled) return;
        if (!isExpectedUnavailable(error)) {
          logger.warn("YouTube suggestions unavailable", errorMessage(error));
        }
        finish({ html: "" });
      };

      const failExecution = (error: unknown) => {
        if (settled) return;
        const failure = error instanceof Error ? error : new Error(errorMessage(error));
        logger.warn("Failed to inspect loaded YouTube page", failure);
        finish({ error: failure });
      };

      const extract = async () => {
        if (settled || extracting || !loadCompleted || !stopped || contents.isDestroyed()) return;
        extracting = true;
        try {
          const html = await contents.executeJavaScript("document.documentElement.innerHTML");
          if (!settled) finish({ html: html as string });
        } catch (error) {
          if (!settled) failExecution(error);
        }
      };

      function handleStopped() {
        stopped = true;
        void extract();
      }

      function handleFailed(
        _event: Electron.Event,
        _errorCode: number,
        description: string,
        _validatedURL: string,
        isMainFrame = true,
      ) {
        if (!isMainFrame) return;
        finishNavigationFailure(new Error(description || "YouTube navigation failed"));
      }

      contents.on("did-stop-loading", handleStopped);
      contents.on("did-fail-load", handleFailed);

      logger.debug("started scraping", url);
      try {
        void contents.loadURL(url)
          .then(() => {
            if (settled) return;
            loadCompleted = true;
            void extract();
          })
          .catch(finishNavigationFailure);
      } catch (error) {
        failExecution(error);
      }
    });
  };

  extractChannel = async (html: string): Promise<YoutubeChannel> => {
    try {
      return extractYoutubeChannel(html);
    } catch (error) {
      logger.warn("Failed to parse YouTube videos", error);
      return { videos: [] };
    }
  };

  videos = async (channel: string) => {
    const html = await this.scrape(`https://www.youtube.com/${channel}/videos`);
    return this.extractChannel(html);
  };

  registerIpcHandlers = () => {
    ipcMain.handle(
      "youtube-provider-videos",
      async (_event, channel: string) => {
        try {
          return await this.videos(channel);
        } catch (error) {
          logger.error(error);
        }
      }
    );
  };
}
