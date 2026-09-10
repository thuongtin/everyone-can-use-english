import { ipcMain } from "electron";
import ffmpegPath from "ffmpeg-static";
import ffprobePath from "@andrkrn/ffprobe-static";
import Ffmpeg from "fluent-ffmpeg";
import log from "@main/logger";
import path from "path";
import fs from "fs-extra";
import settings from "@main/settings";
import { FFMPEG_CONVERT_WAV_OPTIONS } from "@/constants";
import { enjoyUrlToPath, pathToEnjoyUrl } from "@main/utils";
import { assertLocalSubprocessMediaPath } from "@/lib/network-policy";

/*
 * ffmpeg and ffprobe bin file will be in /app.asar.unpacked instead of /app.asar
 * the /samples folder is also in /app.asar.unpacked
 */
Ffmpeg.setFfmpegPath(ffmpegPath.replace("app.asar", "app.asar.unpacked"));
Ffmpeg.setFfprobePath(ffprobePath.replace("app.asar", "app.asar.unpacked"));
const __dirname = import.meta.dirname.replace("app.asar", "app.asar.unpacked");

const logger = log.scope("ffmpeg");
const FFMPEG_LOCAL_PROTOCOL_OPTIONS = ["-protocol_whitelist", "file,pipe"];

function localMediaPath(value: string, operation: string): string {
  return assertLocalSubprocessMediaPath(enjoyUrlToPath(value), {
    transport: "ffmpeg",
    operation,
  });
}

export default class FfmpegWrapper {
  checkCommand(): Promise<boolean> {
    const ffmpeg = Ffmpeg();
    const sampleFile = localMediaPath(
      path.join(__dirname, "samples", "jfk.wav"),
      "check-command",
    );
    return new Promise((resolve) => {
      ffmpeg
        .input(sampleFile)
        .inputOptions(...FFMPEG_LOCAL_PROTOCOL_OPTIONS)
        .getAvailableFormats((err) => {
        if (err) {
          logger.error("Command not valid:", err);
          resolve(false);
        } else {
          logger.info("Command valid, available formats");
          resolve(true);
        }
      });
    });
  }

  generateMetadata(input: string): Promise<Ffmpeg.FfprobeData> {
    input = localMediaPath(input, "generate-metadata.input");
    const ffmpeg = Ffmpeg();
    return new Promise((resolve, reject) => {
      ffmpeg
        .input(input)
        .inputOptions(...FFMPEG_LOCAL_PROTOCOL_OPTIONS)
        .on("start", (commandLine) => {
          logger.info("Spawned FFmpeg with command: " + commandLine);
        })
        .on("error", (err) => {
          logger.error(err);
          reject(err);
        })
        .ffprobe(FFMPEG_LOCAL_PROTOCOL_OPTIONS, (err, metadata) => {
          if (err) {
            logger.error(err);
            reject(err);
          }

          resolve(metadata);
        });
    });
  }

  generateCover(input: string, output: string): Promise<string> {
    input = localMediaPath(input, "generate-cover.input");
    output = localMediaPath(output, "generate-cover.output");
    const ffmpeg = Ffmpeg();
    return new Promise((resolve, reject) => {
      ffmpeg
        .input(input)
        .inputOptions(...FFMPEG_LOCAL_PROTOCOL_OPTIONS)
        .thumbnail({
          count: 1,
          filename: path.basename(output),
          folder: path.dirname(output),
        })
        .on("start", (commandLine) => {
          logger.info("Spawned FFmpeg with command: " + commandLine);
          fs.ensureDirSync(path.dirname(output));
        })
        .on("end", () => {
          logger.info(`File ${output} created`);
          resolve(output);
        })
        .on("error", (err) => {
          logger.error(err);
          reject(err);
        });
    });
  }

  ensureSampleRate(
    input: string,
    output: string,
    sampleRate = 16000
  ): Promise<string> {
    input = localMediaPath(input, "ensure-sample-rate.input");
    output = localMediaPath(output, "ensure-sample-rate.output");
    logger.info(`Trying to convert ${input} to 16-bit file ${output}`);
    if (fs.pathExistsSync(output)) {
      logger.warn(`File ${output} already exists, deleting.`);
      fs.removeSync(output);
    }

    const ffmpeg = Ffmpeg();
    return new Promise((resolve, reject) => {
      ffmpeg
        .input(input)
        .inputOptions(...FFMPEG_LOCAL_PROTOCOL_OPTIONS)
        .outputOptions("-ar", `${sampleRate}`)
        .on("error", (err) => {
          logger.error(err);
          reject(err);
        })
        .on("end", () => {
          logger.info(`File ${output} created`);
          resolve(output);
        })
        .save(output);
    });
  }

  convertToWav(
    input: string,
    output: string,
    options: string[] = []
  ): Promise<string> {
    input = localMediaPath(input, "convert-to-wav.input");
    output = localMediaPath(output, "convert-to-wav.output");
    const ffmpeg = Ffmpeg();
    return new Promise((resolve, reject) => {
      ffmpeg
        .input(input)
        .inputOptions(...FFMPEG_LOCAL_PROTOCOL_OPTIONS)
        .outputOptions(
          "-ar",
          "16000",
          "-ac",
          "1",
          "-c:a",
          "pcm_s16le",
          ...options
        )
        .on("start", (commandLine) => {
          logger.debug(`Trying to convert ${input} to ${output}`);
          logger.info("Spawned FFmpeg with command: " + commandLine);
          fs.ensureDirSync(path.dirname(output));
        })
        .on("end", (stdout, stderr) => {
          if (stdout) {
            logger.debug(stdout);
          }

          if (stderr) {
            logger.info(stderr);
          }

          if (fs.existsSync(output)) {
            resolve(output);
          } else {
            reject(new Error("FFmpeg command failed"));
          }
        })
        .on("error", (err: Error) => {
          logger.error(err);
          reject(err);
        })
        .save(output);
    });
  }

  async prepareForWhisper(input: string, output: string): Promise<string> {
    input = localMediaPath(input, "prepare-for-whisper.input");
    output = localMediaPath(output, "prepare-for-whisper.output");
    const metadata = await this.generateMetadata(input);

    if (metadata.format.format_name === "wav") {
      if (metadata.streams[0].sample_rate === 16000) {
        logger.info(`File ${input} already in 16-bit WAVE format`);
        return input;
      } else {
        return this.ensureSampleRate(
          input,
          input.replace(path.extname(input), "_16bit.wav")
        );
      }
    }

    logger.info(`Trying to convert ${input} to 16-bit WAVE file ${output}`);
    if (fs.pathExistsSync(output)) {
      logger.warn(`File ${output} already exists, deleting.`);
      fs.removeSync(output);
    }

    return this.convertToWav(input, output);
  }

  async transcode(
    input: string,
    output?: string,
    options?: string[]
  ): Promise<string> {
    input = localMediaPath(input, "transcode.input");

    if (!output) {
      output = path.join(settings.cachePath(), `${path.basename(input)}.wav`);
    } else {
      output = localMediaPath(output, "transcode.output");
    }
    output = localMediaPath(output, "transcode.output");

    options = options || FFMPEG_CONVERT_WAV_OPTIONS;

    const ffmpeg = Ffmpeg();
    return new Promise((resolve, reject) => {
      ffmpeg
        .input(input)
        .inputOptions(...FFMPEG_LOCAL_PROTOCOL_OPTIONS)
        .outputOptions(...options)
        .on("start", (commandLine) => {
          logger.debug(`Trying to convert ${input} to ${output}`);
          logger.info("Spawned FFmpeg with command: " + commandLine);
          fs.ensureDirSync(path.dirname(output));
        })
        .on("end", (stdout, stderr) => {
          if (stdout) {
            logger.debug(stdout);
          }

          if (stderr) {
            logger.info(stderr);
          }

          if (fs.existsSync(output)) {
            resolve(pathToEnjoyUrl(output));
          } else {
            reject(new Error("FFmpeg command failed"));
          }
        })
        .on("error", (err: Error) => {
          logger.error(err);
          reject(err);
        })
        .save(output);
    });
  }

  // Crop video or audio from start to end time to a mp3 file
  // Save the file to the output path
  crop(
    input: string,
    options: {
      startTime: number;
      endTime: number;
      output: string;
    }
  ) {
    input = localMediaPath(input, "crop.input");
    const startTime = options.startTime;
    const endTime = options.endTime;
    const output = localMediaPath(options.output, "crop.output");
    const ffmpeg = Ffmpeg();

    return new Promise((resolve, reject) => {
      ffmpeg
        .input(input)
        .inputOptions(...FFMPEG_LOCAL_PROTOCOL_OPTIONS)
        .outputOptions("-ss", startTime.toString(), "-to", endTime.toString())
        .on("start", (commandLine) => {
          logger.info("Spawned FFmpeg with command: " + commandLine);
          fs.ensureDirSync(path.dirname(output));
        })
        .on("end", () => {
          logger.info(`File "${output}" created`);
          resolve(output);
        })
        .on("error", (err) => {
          logger.error(err);
          reject(err);
        })
        .save(output);
    });
  }

  // Concatenate videos or audios into a single file
  concat(inputs: string[], output: string) {
    inputs = inputs.map((input) => localMediaPath(input, "concat.input"));
    output = localMediaPath(output, "concat.output");
    let command = Ffmpeg();
    inputs.forEach((input) => {
      command = command
        .input(input)
        .inputOptions(...FFMPEG_LOCAL_PROTOCOL_OPTIONS);
    });
    return new Promise((resolve, reject) => {
      command
        .on("start", (commandLine) => {
          logger.info("Spawned FFmpeg with command: " + commandLine);
          fs.ensureDirSync(path.dirname(output));
        })
        .on("end", () => {
          logger.info(`File "${output}" created`);
          resolve(output);
        })
        .on("error", (err) => {
          logger.error(err);
          reject(err);
        })
        .mergeToFile(output, settings.cachePath());
    });
  }

  compressVideo(input: string, output: string) {
    input = localMediaPath(input, "compress-video.input");
    output = localMediaPath(output, "compress-video.output");
    const ffmpeg = Ffmpeg();
    return new Promise((resolve, reject) => {
      ffmpeg
        .input(input)
        .inputOptions(...FFMPEG_LOCAL_PROTOCOL_OPTIONS)
        .outputOptions(
          "-c:v",
          "libx264",
          "-tag:v",
          "avc1",
          "-movflags",
          "faststart",
          "-crf",
          "30",
          "-preset",
          "superfast",
          "-c:a",
          "aac",
          "-b:a",
          "128k"
        )
        .on("start", (commandLine) => {
          logger.info("Spawned FFmpeg with command: " + commandLine);
          fs.ensureDirSync(path.dirname(output));
        })
        .on("end", () => {
          logger.info(`File "${output}" created`);
          resolve(output);
        })
        .on("error", (err) => {
          logger.error(err);
          reject(err);
        })
        .save(output);
    });
  }

  compressAudio(input: string, output: string) {
    input = localMediaPath(input, "compress-audio.input");
    output = localMediaPath(output, "compress-audio.output");
    const ffmpeg = Ffmpeg();
    return new Promise((resolve, reject) => {
      ffmpeg
        .input(input)
        .inputOptions(...FFMPEG_LOCAL_PROTOCOL_OPTIONS)
        .outputOptions(
          "-ar",
          "16000",
          "-b:a",
          "32000",
          "-ac",
          "1",
          "-preset",
          "superfast"
        )
        .on("start", (commandLine) => {
          logger.info("Spawned FFmpeg with command: " + commandLine);
          fs.ensureDirSync(path.dirname(output));
        })
        .on("end", () => {
          logger.info(`File "${output}" created`);
          resolve(output);
        })
        .on("error", (err) => {
          logger.error(err.message);
          reject(err);
        })
        .save(output);
    });
  }

  registerIpcHandlers() {
    ipcMain.handle("ffmpeg-check-command", async () => {
      return await this.checkCommand();
    });

    ipcMain.handle(
      "ffmpeg-transcode",
      async (_event, input, output, options) => {
        return await this.transcode(input, output, options);
      }
    );
  }
}
