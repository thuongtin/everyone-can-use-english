import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { Sequelize } from "sequelize";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(root, ".tmp-local-study-"));
const migrationPath = path.join(
  root,
  "src/main/db/migrations/1788876000000-create-local-study-data.js",
);
const modelsPath = path.join(root, "src/main/db/local-study-models.ts");
const repositoryPath = path.join(root, "src/main/db/local-study-repository.ts");
const output = path.join(temp, "local-study.mjs");

const completed = [];
const test = async (name, action) => {
  await action();
  completed.push(name);
};

const lookup = (word, context, overrides = {}) => ({
  id: `lookup-${word}-${context}`.replaceAll(" ", "-"),
  word,
  context,
  contextTranslation: "",
  status: "completed",
  meaning: {
    word,
    lemma: word.toLowerCase(),
    pronunciation: "",
    pos: "noun",
    definition: `${word} definition`,
    translation: `${word} translation`,
  },
  createdAt: "2026-09-09T00:00:00.000Z",
  updatedAt: "2026-09-09T00:00:00.000Z",
  ...overrides,
});

const storyInput = (number, overrides = {}) => ({
  title: `Story ${number}`,
  content: `A useful story number ${number}.`,
  url: `https://example.test/stories/${number}`,
  html: `<p>A useful story number ${number}.</p>`,
  metadata: { description: `Description ${number}` },
  provenance: { source: "website", sourceUrl: `https://example.test/stories/${number}` },
  ...overrides,
});

let sequelize;
try {
  await build({
    stdin: {
      contents: `export * from ${JSON.stringify(modelsPath)}; export * from ${JSON.stringify(repositoryPath)};`,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    packages: "external",
    logLevel: "silent",
  });

  const migration = await import(`${pathToFileURL(migrationPath).href}?test=${Date.now()}`);
  const subject = await import(`${pathToFileURL(output).href}?test=${Date.now()}`);
  sequelize = new Sequelize({
    dialect: "sqlite",
    storage: path.join(temp, "study.sqlite"),
    logging: false,
  });
  await sequelize.query("PRAGMA foreign_keys = ON");
  await migration.up({ context: sequelize.getQueryInterface() });

  const models = subject.createLocalStudyModels(sequelize);
  const profileA = new subject.LocalStudyRepository({
    sequelize,
    models,
    profileId: "profile-a",
  });
  const profileB = new subject.LocalStudyRepository({
    sequelize,
    models,
    profileId: "profile-b",
  });

  await test("creates, reads, updates and deduplicates a local story", async () => {
    const created = await profileA.createStory(storyInput(1));
    assert.equal(created.title, "Story 1");
    assert.equal(created.starred, false);
    assert.equal(created.extracted, false);

    const duplicate = await profileA.createStory(
      storyInput(1, { title: "Duplicate title must not replace local edits" }),
    );
    assert.equal(duplicate.id, created.id);
    assert.equal(duplicate.title, "Story 1");

    const updated = await profileA.updateStory(created.id, {
      title: "Locally edited story",
    });
    assert.equal(updated.title, "Locally edited story");
    assert.equal((await profileA.getStory(created.id)).title, "Locally edited story");
    assert.equal((await profileA.setStoryStarred(created.id, true)).starred, true);
  });

  await test("paginates and searches without duplicating stories", async () => {
    for (let number = 2; number <= 6; number += 1) {
      await profileA.createStory(storyInput(number));
    }
    const first = await profileA.listStories({ page: 1, items: 2 });
    const second = await profileA.listStories({ page: 2, items: 2 });
    assert.equal(first.stories.length, 2);
    assert.equal(first.next, 2);
    assert.equal(second.stories.length, 2);
    assert.equal(second.next, 3);
    assert.deepEqual(
      first.stories.map((story) => story.id).filter((id) => second.stories.some((story) => story.id === id)),
      [],
    );
    const searched = await profileA.listStories({ query: "Story 6", page: 1, items: 10 });
    assert.equal(searched.stories.length, 1);
    assert.equal(searched.stories[0].title, "Story 6");
  });

  await test("persists story meanings and review schedule across repository instances", async () => {
    const story = (await profileA.listStories({ query: "Locally edited", page: 1, items: 1 })).stories[0];
    const result = await profileA.replaceStoryMeanings(story.id, {
      extraction: { words: ["Coffee", "Cup"], idioms: [] },
      lookups: [lookup("Coffee", "Coffee helps me focus."), lookup("Cup", "I hold a cup.")],
    });
    assert.equal(result.story.extracted, true);
    assert.deepEqual(result.story.extraction, { words: ["Coffee", "Cup"], idioms: [] });
    assert.equal(result.meanings.length, 2);

    const coffee = result.meanings.find((meaning) => meaning.word === "Coffee");
    const dueAt = "2026-09-10T00:00:00.000Z";
    await profileA.setReview(coffee.id, { status: "learning", dueAt });

    const reopened = new subject.LocalStudyRepository({
      sequelize,
      models,
      profileId: "profile-a",
    });
    const vocabulary = await reopened.listMeanings({ page: 1, items: 10, storyId: story.id });
    assert.equal(vocabulary.meanings.length, 2);
    assert.equal(vocabulary.meanings.find((meaning) => meaning.id === coffee.id).review.status, "learning");
    assert.equal(vocabulary.meanings.find((meaning) => meaning.id === coffee.id).review.dueAt, dueAt);
  });

  await test("isolates stories, meanings and reviews by profile", async () => {
    assert.equal((await profileB.listStories({ page: 1, items: 10 })).stories.length, 0);
    assert.equal((await profileB.listMeanings({ page: 1, items: 10 })).meanings.length, 0);
    await assert.rejects(profileB.getStory((await profileA.listStories({ page: 1, items: 1 })).stories[0].id), /not found/i);
  });

  await test("rolls back malformed extraction without changing the story", async () => {
    const story = (await profileA.listStories({ query: "Locally edited", page: 1, items: 1 })).stories[0];
    const before = await profileA.getStory(story.id);
    await assert.rejects(
      profileA.replaceStoryMeanings(story.id, {
        extraction: { words: ["Broken"], idioms: [] },
        lookups: [{ word: "Broken", context: "Missing meaning" }],
      }),
      /meaning/i,
    );
    const after = await profileA.getStory(story.id);
    assert.deepEqual(after.extraction, before.extraction);
  });

  await test("keeps blocked Enjoy resource provenance without active render URLs", async () => {
    const story = await profileA.createStory(storyInput(7, {
      content: "Before ![](https://storage.enjoy.bot/private-image.png) and ![](https://enjoy-storage.baizhiheizi.com/legacy.png) after",
      html: '<img src="https://cdn.enjoy.bot/private-image.png"><a href="https://api.getenjoyapp.com/item">legacy</a>',
      metadata: {
        image: "https://storage.enjoy.bot/cover.png",
        favicon: "https://enjoy.bot/favicon.ico",
      },
    }));
    assert.doesNotMatch(story.content, /https?:\/\/[^\s)]*enjoy\.bot/iu);
    assert.equal(story.metadata.image, undefined);
    assert.equal(story.metadata.favicon, undefined);
    assert.deepEqual(story.provenance.blockedResourceUrls.sort(), [
      "https://api.getenjoyapp.com/item",
      "https://cdn.enjoy.bot/private-image.png",
      "https://enjoy-storage.baizhiheizi.com/legacy.png",
      "https://enjoy.bot/favicon.ico",
      "https://storage.enjoy.bot/cover.png",
      "https://storage.enjoy.bot/private-image.png",
    ]);
    assert.equal(
      story.provenance.rawSnapshot.content,
      "Before ![](https://storage.enjoy.bot/private-image.png) and ![](https://enjoy-storage.baizhiheizi.com/legacy.png) after",
    );
    assert.equal(
      story.provenance.rawSnapshot.html,
      '<img src="https://cdn.enjoy.bot/private-image.png"><a href="https://api.getenjoyapp.com/item">legacy</a>',
    );
    assert.deepEqual(story.provenance.rawSnapshot.metadata, {
      image: "https://storage.enjoy.bot/cover.png",
      favicon: "https://enjoy.bot/favicon.ico",
    });
  });

  await test("deletes a story and its orphan vocabulary without affecting other stories", async () => {
    const story = await profileA.createStory(storyInput(8));
    const replaced = await profileA.replaceStoryMeanings(story.id, {
      extraction: { words: ["Orphan"], idioms: [] },
      lookups: [lookup("Orphan", "This word belongs only here.")],
    });
    const meaningId = replaced.meanings[0].id;
    await profileA.destroyStory(story.id);
    await assert.rejects(profileA.getStory(story.id), /not found/i);
    assert.equal(
      (await profileA.listMeanings({ page: 1, items: 100 })).meanings.some((meaning) => meaning.id === meaningId),
      false,
    );
  });

  await test("imports local content with a retired canonical URL without fetching it", async () => {
    const input = storyInput(9, {
      url: "https://enjoy.bot/posts/legacy-story",
      content: "This exported story is already available locally.",
      html: "<p>This exported story is already available locally.</p>",
      metadata: { url: "https://enjoy.bot/posts/legacy-story" },
      provenance: { source: "file", sourceUrl: "file:///tmp/export.html" },
    });
    const imported = await profileA.createStory(input);
    assert.equal(imported.url, "");
    assert.equal(imported.content, input.content);
    assert.equal(imported.provenance.sourceUrl, "file:///tmp/export.html");
    assert.ok(imported.provenance.blockedResourceUrls.includes(input.url));
    assert.equal(imported.provenance.rawSnapshot.metadata.url, input.url);
    assert.equal(imported.metadata.url, undefined);
    await profileA.updateStory(imported.id, { title: "Edited imported story" });
    assert.equal((await profileA.createStory(input)).id, imported.id);
    const legacy = await profileA.createStory(storyInput(10, {
      url: "https://enjoy.bot/posts/another-story", provenance: { source: "import" },
    }));
    assert.equal(legacy.provenance.sourceUrl, "https://enjoy.bot/posts/another-story");
    assert.equal(legacy.url, "");
  });

  await migration.down({ context: sequelize.getQueryInterface() });
  for (const table of ["local_stories", "local_meanings", "local_story_meanings", "local_reviews"]) {
    assert.equal(await sequelize.getQueryInterface().tableExists(table), false);
  }

  console.log(`PASS: ${completed.length} local Story/Vocabulary SQLite checks`);
} finally {
  await sequelize?.close();
  await rm(temp, { recursive: true, force: true });
}
