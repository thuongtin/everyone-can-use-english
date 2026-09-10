import { ipcMain } from "electron";
import type { Sequelize } from "sequelize";
import type {
  LocalStoryCreateInput,
  LocalStoryUpdateInput,
  LocalStudyExtraction,
  LocalStudyLookup,
  LocalStudyReviewStatus,
} from "../../../types/local-study-api";
import { createLocalStudyModels } from "../local-study-models";
import { LocalStudyError, LocalStudyRepository } from "../local-study-repository";

const channels = [
  "local-study-stories-list",
  "local-study-stories-get",
  "local-study-stories-create",
  "local-study-stories-update",
  "local-study-stories-destroy",
  "local-study-stories-set-starred",
  "local-study-meanings-list",
  "local-study-meanings-upsert",
  "local-study-meanings-replace-story",
  "local-study-reviews-set",
] as const;

export class LocalStudyHandler {
  private repository: LocalStudyRepository | null = null;

  connect(options: { sequelize: Sequelize; profileId: string }): void {
    this.repository = new LocalStudyRepository({
      sequelize: options.sequelize,
      models: createLocalStudyModels(options.sequelize),
      profileId: options.profileId,
    });
  }

  private ready(): LocalStudyRepository {
    if (!this.repository) {
      throw new LocalStudyError("database_not_connected", "Local study data is not connected");
    }
    return this.repository;
  }

  register(): void {
    ipcMain.handle("local-study-stories-list", (_event, params) =>
      this.ready().listStories(params));
    ipcMain.handle("local-study-stories-get", (_event, id: string) =>
      this.ready().getStory(id));
    ipcMain.handle("local-study-stories-create", (_event, input: LocalStoryCreateInput) =>
      this.ready().createStory(input));
    ipcMain.handle("local-study-stories-update", (_event, id: string, input: LocalStoryUpdateInput) =>
      this.ready().updateStory(id, input));
    ipcMain.handle("local-study-stories-destroy", (_event, id: string) =>
      this.ready().destroyStory(id));
    ipcMain.handle("local-study-stories-set-starred", (_event, id: string, starred: boolean) =>
      this.ready().setStoryStarred(id, starred));
    ipcMain.handle("local-study-meanings-list", (_event, params) =>
      this.ready().listMeanings(params));
    ipcMain.handle("local-study-meanings-upsert", (
      _event,
      input: { storyId?: string; lookup: LocalStudyLookup },
    ) => this.ready().upsertMeaning(input));
    ipcMain.handle("local-study-meanings-replace-story", (
      _event,
      storyId: string,
      input: { extraction: LocalStudyExtraction; lookups: LocalStudyLookup[] },
    ) => this.ready().replaceStoryMeanings(storyId, input));
    ipcMain.handle("local-study-reviews-set", (
      _event,
      meaningId: string,
      input: { status: LocalStudyReviewStatus; dueAt: string | null },
    ) => this.ready().setReview(meaningId, input));
  }

  unregister(): void {
    for (const channel of channels) ipcMain.removeHandler(channel);
    this.repository = null;
  }
}

export const localStudyHandler = new LocalStudyHandler();
