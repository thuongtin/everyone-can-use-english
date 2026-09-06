import log from "@main/logger";
import { WebContentsView, ipcMain } from "electron";
import { extractYoutubeVideos, type YoutubeVideo } from "./youtube-video-parser";

const logger = log.scope("providers/youtube-provider");

export class YoutubeProvider {
  scrape = async (url: string) => {
    return new Promise<string>((resolve, reject) => {
      const view = new WebContentsView();
      view.webContents.loadURL(url);
      logger.debug("started scraping", url);

      view.webContents.on("did-stop-loading", () => {
        logger.debug("finished loading", url);
        view.webContents
          .executeJavaScript(`document.documentElement.innerHTML`)
          .then((html) => resolve(html as string))
          .catch((error) => {
            logger.warn("Failed to scrape", url, error);
            resolve("");
          })
          .finally(() => {
            view.webContents.close();
          });
      });
      view.webContents.on(
        "did-fail-load",
        (_event, _errorCode, error, validatedURL) => {
          logger.warn("failed scraping", url, error, validatedURL);
          view.webContents.close();
          reject();
        }
      );
    });
  };

  extractVideos = async (html: string): Promise<YoutubeVideo[]> => {
    try {
      return extractYoutubeVideos(html);
    } catch (error) {
      logger.warn("Failed to parse YouTube videos", error);
      return [];
    }
  };

  videos = async (channel: string) => {
    const html = await this.scrape(`https://www.youtube.com/${channel}/videos`);
    return this.extractVideos(html);
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
