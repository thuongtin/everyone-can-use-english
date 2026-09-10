import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { learningBrief } from "./fixtures/learning-lesson.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(root, ".tmp-learning-db-"));
let db;
try {
  await mkdir(path.join(temp, "data"));
  await symlink(path.join(temp, "data"), path.join(temp, "data-alias"));
  await mkdir(path.join(temp, "migrations"));
  await copyFile(path.join(root, "src/main/db/migrations/1788701024340-create-learning-studio.js"), path.join(temp, "migrations/1788701024340-create-learning-studio.js"));
  await copyFile(path.join(root, "src/main/db/migrations/1788789600000-add-learning-map-brief.js"), path.join(temp, "migrations/1788789600000-add-learning-map-brief.js"));
  const modelNames = ["Audio", "Recording", "CacheObject", "Chat", "ChatAgent", "ChatMember", "ChatMessage", "Conversation", "Document", "Message", "Note", "PronunciationAssessment", "Segment", "Speech", "Transcription", "Video", "UserSetting"];
  const handlerNames = ["audios", "cacheObjects", "chatAgents", "chatMembers", "chatMessages", "chats", "conversations", "documents", "messages", "notes", "pronunciationAssessments", "recordings", "segments", "speeches", "transcriptions", "videos", "userSettings"];
  const output = path.join(temp, "subject.mjs");
  await build({
    stdin: { contents: `export { default as db } from './src/main/db/index'; export { fixture } from 'learning-db-fixture'; export { isLearningAssetReference } from './src/main/learning/active-runtime'; export { enjoyUrlToPath } from './src/main/utils';`, resolveDir: root, loader: "ts" },
    bundle: true, platform: "node", format: "esm", outfile: output, packages: "external", logLevel: "silent",
    plugins: [{ name: "legacy-app-shell", setup(builder) {
      builder.onResolve({ filter: /^learning-db-fixture$|^electron$|^@main\/(settings|logger|i18n)$|^@main\/db\/models$|^sequelize-typescript$/ }, args => ({
        path: args.path === "@main/db/models" ? "./models" : args.path,
        namespace: "fixture",
      }));
      builder.onResolve({ filter: /^\.\/(models|handlers)$/ }, args => args.importer.endsWith("/main/db/index.ts") ? { path: args.path, namespace: "fixture" } : undefined);
      builder.onResolve({ filter: /^\.\/settings$/ }, args => args.importer.endsWith("/main/utils.ts") ? { path: "@main/settings", namespace: "fixture" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => {
        const sources = {
          "learning-db-fixture": `import path from 'node:path'; import fs from 'node:fs'; const root = ${JSON.stringify(temp)}; export const fixture = { profile: 'profile-a', handlers: new Map(), root }; export const settings = { dbPath: () => path.join(root, fixture.profile + '.sqlite'), userDataPath: () => { const dir = path.join(root, "data-alias", fixture.profile); fs.mkdirSync(dir,{recursive:true}); return dir; }, getSync: key => key === 'user.id' ? fixture.profile : undefined };`,
          "@main/settings": `export { settings as default } from 'learning-db-fixture';`,
          "electron": `import { fixture } from 'learning-db-fixture'; export const ipcMain = { handle: (name, fn) => fixture.handlers.set(name, fn) };`,
          "@main/logger": `const log = { info(){}, error(){}, warn(){}, debug(){} }; export default { scope: () => log };`,
          "@main/i18n": `export const i18n = () => {};`,
          "sequelize-typescript": `
            import { Sequelize, Model, DataTypes } from 'sequelize';
            export { Sequelize, Model };
            export const DataType = DataTypes;
            const decorator = () => () => undefined;
            export const Table = decorator;
            export const Column = decorator;
            export const Default = decorator;
            export const IsUUID = decorator;
            export const AllowNull = decorator;
          `,
          "./models": modelNames.map(name => `export const ${name} = { get: async () => 'vi' };`).join("\n"),
          "./handlers": handlerNames.map(name => `export const ${name}Handler = { register(){}, unregister(){} };`).join("\n"),
        };
        return { contents: sources[args.path], loader: "js", resolveDir: root };
      });
    } }],
  });
  const subject = await import(pathToFileURL(output).href);
  db = subject.db;
  const { fixture } = subject;
  db.registerIpcHandlers();
  const connect = () => fixture.handlers.get("db-connect")();
  const disconnect = id => fixture.handlers.get("db-disconnect")({}, id);
  const a = await connect();
  assert.equal(a.state, "connected");
  assert.equal(a.profileId, "profile-a");
  assert.ok(a.connectionId);
  assert.equal(db.learning.scope.context.assetRoot, path.join(temp, "data", "profile-a", "learning-assets"));
  await db.learning.storage.createLesson({ brief: learningBrief });
  let release;
  let stopping;
  db.learning.trackAttempt("owned-attempt", () => new Promise(resolve => { stopping = true; release = resolve; }));
  const change = db.withDisconnected(() => { fixture.profile = "profile-b"; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stopping, true);
  assert.equal(fixture.profile, "profile-a");
  const pendingConnect = connect();
  release();
  await change;
  const b = await pendingConnect;
  assert.equal(b.profileId, "profile-b");
  assert.notEqual(b.connectionId, a.connectionId);
  await disconnect(a.connectionId);
  await disconnect(undefined);
  assert.equal(db.learning.scope.context.connectionId, b.connectionId);
  assert.equal((await db.learning.storage.listLessons()).length, 0);
  await db.withDisconnected(() => { fixture.profile = "profile-a"; });
  const again = await connect();
  assert.equal(again.state, "connected");
  assert.equal((await db.learning.storage.listLessons()).length, 1);
  for (const value of ["enjoy://library/learning-assets/" + again.connectionId + "/00000000-0000-4000-8000-000000000000.wav", "enjoy://library/profile-a/learning-assets/x", "enjoy://library/profile-a/%6cearning-assets/x", "enjoy://library/profile-a/%256cearning-assets/x"]) {
    assert.equal(subject.isLearningAssetReference(value), true);
    assert.throws(() => subject.enjoyUrlToPath(value), /scoped media access/);
  }
  await db.backup({ force: true });
  const snapshot = path.join(temp, "snapshot.sqlite");
  await copyFile(path.join(temp, "profile-a.sqlite"), snapshot);
  await db.learning.storage.createLesson({ brief: learningBrief });
  await fixture.handlers.get("db-restore")({}, snapshot);
  assert.ok(db.connection);
  assert.equal((await db.learning.storage.listLessons()).length, 1);
  await db.shutdown();
  assert.equal((await connect()).state, "error");
  assert.equal(db.connection, null);
  console.log("PASS: main DB integration with real SQLite/migration/runtime: serialized profile transition, stale disconnect, reopen and shutdown. Legacy Electron shell is stubbed.");
} finally {
  await db?.shutdown();
  await rm(temp, { recursive: true, force: true });
}
