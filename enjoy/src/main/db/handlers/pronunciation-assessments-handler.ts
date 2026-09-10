import { ipcMain, IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { PronunciationAssessment, Recording } from "@main/db/models";
import { Attributes, FindOptions, WhereOptions } from "sequelize";
import camelcaseKeys from "camelcase-keys";
import echogarden from "@main/echogarden";
import { enjoyUrlToPath } from "@main/utils";
import { AzureSpeechSdk } from "@main/azure-speech-sdk";
import { getAzureSpeechCredentials } from "@main/speech/azure-config";

const THIRTY_SECONDS = 30 * 1000;
const activeAssessments = new Set<AbortController>();

class PronunciationAssessmentsHandler {
  private async findAll(
    _event: IpcMainEvent,
    options: FindOptions<Attributes<PronunciationAssessment>>
  ) {
    const assessments = await PronunciationAssessment.findAll({
      include: [
        {
          association: "recording",
          model: Recording,
          required: false,
        },
      ],
      order: [["createdAt", "DESC"]],
      ...options,
    });

    if (!assessments) {
      return [];
    }
    return assessments.map((assessment) => assessment.toJSON());
  }

  private async findOne(
    _event: IpcMainEvent,
    where: WhereOptions<PronunciationAssessment>
  ) {
    const assessment = await PronunciationAssessment.findOne({
      where: {
        ...where,
      },
      include: [
        {
          association: "recording",
          model: Recording,
          required: false,
        },
      ],
    });

    return assessment.toJSON();
  }

  private async create(
    _event: IpcMainEvent,
    data: Partial<Attributes<PronunciationAssessment>>
  ) {
    const { targetId, targetType } = data;
    const existed = await PronunciationAssessment.findOne({
      where: {
        targetId,
        targetType,
      },
    });

    if (existed) {
      return existed.toJSON();
    }

    const assessment = await PronunciationAssessment.create(data);
    return assessment.toJSON();
  }

  private async assess(
    event: IpcMainInvokeEvent,
    params: {
      recordingId?: unknown;
      language?: unknown;
      reference?: unknown;
    }
  ) {
    const recordingId =
      typeof params?.recordingId === "string" ? params.recordingId.trim() : "";
    if (!recordingId) throw new Error("Recording is required for assessment.");
    const recording = await Recording.findOne({ where: { id: recordingId } });
    if (!recording) throw new Error("Recording not found.");
    const database = Recording.sequelize;
    if (!database || PronunciationAssessment.sequelize !== database) {
      throw new Error("The active profile database is unavailable.");
    }
    const existed = await PronunciationAssessment.findOne({
      where: { targetId: recording.id, targetType: "Recording" },
    });
    if (existed) return existed.toJSON();

    const language =
      typeof params.language === "string" && params.language.trim()
        ? params.language.trim()
        : "en-US";
    const reference =
      typeof params.reference === "string" && params.reference.trim()
        ? params.reference.trim()
        : recording.referenceText?.trim();
    const controller = new AbortController();
    activeAssessments.add(controller);
    const abortOnOwnerDestroyed = (): void => controller.abort();
    event.sender.once("destroyed", abortOnOwnerDestroyed);
    try {
      const wavUrl = await echogarden.transcode(recording.src);
      if (controller.signal.aborted) {
        throw new Error("Pronunciation assessment was cancelled.");
      }
      const credentials = await getAzureSpeechCredentials();
      const azure = new AzureSpeechSdk(
        credentials.subscriptionKey,
        credentials.region
      );
      const request = {
        filePath: enjoyUrlToPath(wavUrl),
        reference: reference || undefined,
        language,
        signal: controller.signal,
      };
      const result =
        recording.duration < THIRTY_SECONDS
          ? await azure.pronunciationAssessment(request)
          : await azure.continuousPronunciationAssessment(request);
      const detail = camelcaseKeys(
        JSON.parse(JSON.stringify(result.detailResult)),
        { deep: true }
      ) as Record<string, any>;
      detail.provider = "azure";
      detail.duration = recording.duration;

      if (
        controller.signal.aborted ||
        Recording.sequelize !== database ||
        PronunciationAssessment.sequelize !== database
      ) {
        throw new Error("The active profile changed during pronunciation assessment.");
      }
      const content = result.contentAssessmentResult;
      return database.transaction(async (transaction) => {
        if (
          controller.signal.aborted ||
          Recording.sequelize !== database ||
          PronunciationAssessment.sequelize !== database
        ) {
          throw new Error("The active profile changed during pronunciation assessment.");
        }
        const duplicate = await PronunciationAssessment.findOne({
          where: { targetId: recording.id, targetType: "Recording" },
          transaction,
        });
        if (duplicate) return duplicate.toJSON();
        return (
          await PronunciationAssessment.create(
            {
              targetId: recording.id,
              targetType: "Recording",
              referenceText: reference || null,
              pronunciationScore: result.pronunciationScore,
              accuracyScore: result.accuracyScore,
              completenessScore: result.completenessScore,
              fluencyScore: result.fluencyScore,
              prosodyScore: result.prosodyScore,
              grammarScore: content?.grammarScore,
              vocabularyScore: content?.vocabularyScore,
              topicScore: content?.topicScore,
              result: detail,
              language,
            },
            { transaction }
          )
        ).toJSON();
      });
    } finally {
      event.sender.removeListener("destroyed", abortOnOwnerDestroyed);
      activeAssessments.delete(controller);
    }
  }

  private async update(
    _event: IpcMainEvent,
    id: string,
    data: Attributes<PronunciationAssessment>
  ) {
    const assessment = await PronunciationAssessment.findOne({
      where: { id: id },
    });

    if (!assessment) {
      throw new Error("Assessment not found");
    }

    await assessment.update(data);
  }

  private async destroy(_event: IpcMainEvent, id: string) {
    const assessment = await PronunciationAssessment.findOne({
      where: {
        id,
      },
    });

    if (!assessment) {
      throw new Error("Assessment not found");
    }

    await assessment.destroy();
  }

  register() {
    ipcMain.handle("pronunciation-assessments-find-all", this.findAll);
    ipcMain.handle("pronunciation-assessments-find-one", this.findOne);
    ipcMain.handle("pronunciation-assessments-create", this.create);
    ipcMain.handle("pronunciation-assessments-assess", this.assess);
    ipcMain.handle("pronunciation-assessments-update", this.update);
    ipcMain.handle("pronunciation-assessments-destroy", this.destroy);
  }

  unregister() {
    for (const controller of activeAssessments) controller.abort();
    activeAssessments.clear();
    ipcMain.removeHandler("pronunciation-assessments-find-all");
    ipcMain.removeHandler("pronunciation-assessments-find-one");
    ipcMain.removeHandler("pronunciation-assessments-create");
    ipcMain.removeHandler("pronunciation-assessments-assess");
    ipcMain.removeHandler("pronunciation-assessments-update");
    ipcMain.removeHandler("pronunciation-assessments-destroy");
  }
}

export const pronunciationAssessmentsHandler =
  new PronunciationAssessmentsHandler();
