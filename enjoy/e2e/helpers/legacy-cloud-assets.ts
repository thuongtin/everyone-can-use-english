import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import sqlitePackage from "sqlite3";

import type { LocalApp } from "./local-app";

const runFile = promisify(execFile);
// sqlite3 is CommonJS at runtime even though its declarations advertise named exports.
// eslint-disable-next-line import/no-named-as-default-member
const { Database: SqliteDatabase } = sqlitePackage;

export const retiredAssetUrls = {
  audioCover: "https://assets.enjoy.bot/legacy/audio-cover.jpg",
  videoCover: "https://enjoy-storage.baizhiheizi.com/legacy/video-cover.jpg",
  avatar: "https://api.getenjoyapp.com/legacy/avatar.png",
  markdownImage: "https://cdn.enjoy.bot/legacy/markdown-image.png",
  markdownLink: "https://enjoy.bot/legacy/history",
  audioSource: "https://api.getenjoyapp.com/legacy/audio.mp3",
  videoSource: "https://enjoy-storage.baizhiheizi.com/legacy/video.mp4",
  documentSource: "https://enjoy.bot/legacy/document.md",
} as const;

export type LegacyCloudAssetSeed = Readonly<{
  localAudioId: string;
  missingAudioId: string;
  localVideoId: string;
  missingVideoId: string;
  localDocumentId: string;
  missingDocumentId: string;
  chatId: string;
  localAudioSha256: string;
  localVideoSha256: string;
  markdownMarker: string;
  historicalTimestamp: string;
}>;

type FixtureFiles = Readonly<{
  directory: string;
  localAudio: string;
  missingAudio: string;
  localVideo: string;
  missingVideo: string;
  localDocument: string;
  missingDocument: string;
}>;

async function makeMediaFixtures(): Promise<FixtureFiles> {
  if (!ffmpegPath) throw new Error("ffmpeg-static did not resolve an executable");
  const directory = await mkdtemp(path.join(os.tmpdir(), "enjoy-legacy-assets-"));
  const files = {
    directory,
    localAudio: path.join(directory, "local-audio.wav"),
    missingAudio: path.join(directory, "missing-audio.wav"),
    localVideo: path.join(directory, "local-video.mp4"),
    missingVideo: path.join(directory, "missing-video.mp4"),
    localDocument: path.join(directory, "local-document.md"),
    missingDocument: path.join(directory, "missing-document.md"),
  };
  await Promise.all([
    runFile(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "pcm_s16le", "-y", files.localAudio]),
    runFile(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=660:duration=1", "-c:a", "pcm_s16le", "-y", files.missingAudio]),
    runFile(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=96x64:d=1", "-pix_fmt", "yuv420p", "-an", "-y", files.localVideo]),
    runFile(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=96x64:d=1", "-pix_fmt", "yuv420p", "-an", "-y", files.missingVideo]),
    writeFile(
      files.localDocument,
      [
        "# Legacy local document",
        "",
        "LEGACY_MARKDOWN_CONTENT",
        "",
        `![Retired illustration](${retiredAssetUrls.markdownImage})`,
        "",
        `[Retired history link](${retiredAssetUrls.markdownLink})`,
      ].join("\n"),
      { encoding: "utf8", mode: 0o600 },
    ),
    writeFile(files.missingDocument, "# Missing legacy document\n", { encoding: "utf8", mode: 0o600 }),
  ]);
  return files;
}

function updateHistoricalMetadata(databasePath: string, ids: readonly string[], timestamp: string): Promise<void> {
  // Match Sequelize's SQLite DATE format so reads preserve a valid Date value.
  const sqliteTimestamp = timestamp.replace("T", " ").replace(/Z$/u, " +00:00");
  return new Promise((resolve, reject) => {
    const database = new SqliteDatabase(databasePath, openError => {
      if (openError) {
        reject(openError);
        return;
      }
      database.serialize(() => {
        const operations = [
          ["audios", ids[0]],
          ["audios", ids[1]],
          ["videos", ids[2]],
          ["videos", ids[3]],
          ["documents", ids[4]],
          ["documents", ids[5]],
        ] as const;
        let remaining = operations.length;
        let failure: Error | null = null;
        for (const [table, id] of operations) {
          database.run(
            `UPDATE ${table} SET synced_at = ?, uploaded_at = ? WHERE id = ?`,
            [sqliteTimestamp, sqliteTimestamp, id],
            error => {
              if (error && !failure) failure = error;
              remaining -= 1;
              if (remaining !== 0) return;
              database.close(closeError => {
                if (failure) reject(failure);
                else if (closeError) reject(closeError);
                else resolve();
              });
            },
          );
        }
      });
    });
  });
}

const sha256 = async (filePath: string): Promise<string> =>
  createHash("sha256").update(await readFile(filePath)).digest("hex");

export async function seedLegacyCloudAssets(app: LocalApp): Promise<LegacyCloudAssetSeed> {
  const files = await makeMediaFixtures();
  const historicalTimestamp = "2024-01-02T03:04:05.000Z";
  try {
    const seed = await app.page.evaluate(async ({ fixturePaths, urls }) => {
      const bridge = window.__ENJOY_APP__;
      const localAudio = await bridge.audios.create(fixturePaths.localAudio, {
        name: "Legacy local audio",
        compressing: false,
      });
      const missingAudio = await bridge.audios.create(fixturePaths.missingAudio, {
        name: "Legacy missing audio",
        compressing: false,
      });
      await bridge.audios.update(localAudio.id, { ...localAudio, source: urls.audioSource, coverUrl: urls.audioCover });
      await bridge.audios.update(missingAudio.id, { ...missingAudio, source: urls.audioSource, coverUrl: urls.audioCover });

      const localVideo = await bridge.videos.create(fixturePaths.localVideo, {
        name: "Legacy local video",
        compressing: false,
      });
      const missingVideo = await bridge.videos.create(fixturePaths.missingVideo, {
        name: "Legacy missing video",
        compressing: false,
      });
      await bridge.videos.update(localVideo.id, { ...localVideo, source: urls.videoSource, coverUrl: urls.videoCover });
      await bridge.videos.update(missingVideo.id, { ...missingVideo, source: urls.videoSource, coverUrl: urls.videoCover });
      const videoUpdateDeadline = Date.now() + 5_000;
      while (Date.now() < videoUpdateDeadline) {
        const [savedLocalVideo, savedMissingVideo] = await Promise.all([
          bridge.videos.findOne({ id: localVideo.id }),
          bridge.videos.findOne({ id: missingVideo.id }),
        ]);
        if (savedLocalVideo?.source === urls.videoSource && savedMissingVideo?.source === urls.videoSource) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      const localDocument = await bridge.documents.create({
        uri: fixturePaths.localDocument,
        title: "Legacy local document",
        source: urls.documentSource,
        config: { autoTranslate: false },
      });
      const missingDocument = await bridge.documents.create({
        uri: fixturePaths.missingDocument,
        title: "Legacy missing document",
        source: urls.documentSource,
        config: { autoTranslate: false },
      });

      const agent = await bridge.chatAgents.create({
        type: "GPT",
        name: "Legacy history agent",
        description: "Local history fixture",
        avatarUrl: urls.avatar,
        source: urls.markdownLink,
        config: { prompt: "Local fixture" },
      });
      const chat = await bridge.chats.create({
        name: "Legacy local history",
        config: { sttEngine: "needs-selection" },
        members: [{ userId: agent.id, userType: "ChatAgent", config: {} }],
      });
      await bridge.chatMessages.create({
        chatId: chat.id,
        role: "USER",
        state: "pending",
        content: `History marker\n\n![Retired history image](${urls.markdownImage})`,
      });

      // Seed both stores after initial database bootstrap has settled, matching
      // the normal profile rename flow before the fixture's full restart.
      const currentUser = await bridge.appSettings.getUser();
      const localProfile = {
        ...currentUser,
        name: "Legacy local learner",
        nameSource: "explicit" as const,
        avatarUrl: urls.avatar,
      };
      await bridge.userSettings.set("profile", localProfile);
      await bridge.appSettings.setUser(localProfile);

      return { localAudio, missingAudio, localVideo, missingVideo, localDocument, missingDocument, chatId: chat.id };
    }, { fixturePaths: files, urls: retiredAssetUrls });

    await updateHistoricalMetadata(app.databasePath, [
      seed.localAudio.id,
      seed.missingAudio.id,
      seed.localVideo.id,
      seed.missingVideo.id,
      seed.localDocument.id,
      seed.missingDocument.id,
    ], historicalTimestamp);

    const profileRoot = path.dirname(app.databasePath);
    await Promise.all([
      unlink(path.join(profileRoot, "audios", `${seed.missingAudio.md5}${seed.missingAudio.metadata.extname}`)),
      unlink(path.join(profileRoot, "videos", `${seed.missingVideo.md5}${seed.missingVideo.metadata.extname}`)),
      unlink(path.join(profileRoot, "documents", `${seed.missingDocument.md5}.${seed.missingDocument.metadata.extension}`)),
    ]);

    return {
      localAudioId: seed.localAudio.id,
      missingAudioId: seed.missingAudio.id,
      localVideoId: seed.localVideo.id,
      missingVideoId: seed.missingVideo.id,
      localDocumentId: seed.localDocument.id,
      missingDocumentId: seed.missingDocument.id,
      chatId: seed.chatId,
      localAudioSha256: await sha256(files.localAudio),
      localVideoSha256: await sha256(files.localVideo),
      markdownMarker: "LEGACY_MARKDOWN_CONTENT",
      historicalTimestamp,
    };
  } finally {
    await rm(files.directory, { recursive: true, force: true });
  }
}
