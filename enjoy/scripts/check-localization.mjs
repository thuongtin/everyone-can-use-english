import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const readLocale = async (locale) => JSON.parse(
  await readFile(path.join(root, "src/i18n", `${locale}.json`), "utf8")
);
const flatten = (value, prefix = "") => Object.fromEntries(
  Object.entries(value).flatMap(([key, entry]) => {
    const name = prefix ? `${prefix}.${key}` : key;
    return typeof entry === "object"
      ? Object.entries(flatten(entry, name))
      : [[name, entry]];
  })
);
const en = flatten(await readLocale("en"));
const vi = flatten(await readLocale("vi"));
const es = flatten(await readLocale("es"));
assert.deepEqual(Object.keys(vi).sort(), Object.keys(en).sort(), "Locale keys differ");
for (const [key, value] of Object.entries(vi)) {
  assert.equal(typeof value, "string", key);
  assert.ok(value.trim(), `Empty translation: ${key}`);
  assert.doesNotMatch(value, /\p{Script=Han}/u, `Untranslated Chinese: ${key}`);
  assert.doesNotMatch(value, /\u2014/u, `Disallowed punctuation: ${key}`);
  const tokens = (text) => (text.match(/{{.*?}}|<\/?[a-z]+[^>]*>/g) || []).sort();
  assert.deepEqual(tokens(value), tokens(en[key]), `Interpolation or markup changed: ${key}`);
}

const task2Keys = [
  "undo",
  "redo",
  "help",
  "hide",
  "unhide",
  "toggleFullscreen",
  "banduLogin",
  "banduLoginDescription",
  "loginOptionsDescription",
  "checkForUpdates",
  "reportIssue",
  "automaticUpdatesUnavailable",
  "pagination",
  "goToPreviousPage",
  "goToNextPage",
  "morePages",
];
for (const key of task2Keys) {
  assert.equal(typeof es[key], "string", `Missing Spanish translation: ${key}`);
  assert.ok(es[key].trim(), `Empty Spanish translation: ${key}`);
  assert.notEqual(es[key], vi[key], `Spanish translation falls back to Vietnamese: ${key}`);
}

const temp = await mkdtemp(path.join(os.tmpdir(), "enjoy-localization-"));
const bundle = async (name, source) => {
  const file = path.join(temp, `${name}.mjs`);
  await build({
    stdin: { contents: source, resolveDir: root, loader: "ts" },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: file,
    alias: { "@": path.join(root, "src") },
    logLevel: "silent",
  });
  return import(pathToFileURL(file).href);
};

try {
  const { resolveUiLanguage } = await bundle("language-resolver", `
    export { resolveUiLanguage } from "./src/constants/ui-language.ts";
  `);
  for (const [saved, expected] of [[undefined, "vi"], ["vi", "vi"], ["en", "en"], ["es", "es"], ["zh-CN", "vi"], ["unknown", "vi"]]) {
    assert.equal(resolveUiLanguage(saved), expected);
  }
  const main = await bundle("main", `
    export { i18n as initialize } from "./src/main/i18n.ts";
    export { default as instance } from "i18next";
  `);
  main.initialize();
  assert.equal(main.instance.language, "vi");
  assert.equal(main.instance.t("copy"), "Sao chép");
  assert.equal(main.instance.t("models.audio.fileNotFound", { file: "lesson.mp3" }), "Không tìm thấy tệp lesson.mp3");
  main.initialize("en");
  assert.equal(main.instance.t("copy"), "Copy");
  const savedUiLanguage = "es";
  main.initialize(savedUiLanguage);
  assert.equal(main.instance.language, savedUiLanguage);
  assert.equal(main.instance.t("undo"), "Deshacer");
  assert.equal(main.instance.t("banduLogin"), "Iniciar sesión con Bandu");
  assert.equal(main.instance.t("pagination"), "Paginación");
  for (const [language, expected] of Object.entries({
    vi: ["Hoàn tác", "Đăng nhập bằng Bandu", "Phân trang"],
    en: ["Undo", "Sign in with Bandu", "Pagination"],
    es: ["Deshacer", "Iniciar sesión con Bandu", "Paginación"],
  })) {
    main.initialize(language);
    assert.equal(main.instance.language, language);
    assert.deepEqual(
      [
        main.instance.t("undo"),
        main.instance.t("banduLogin"),
        main.instance.t("pagination"),
      ],
      expected,
      `Main locale changed incorrectly: ${language}`
    );
  }
  assert.notEqual(main.instance.t("copy"), "Sao chép");
  for (const language of ["zh-CN", "unknown", "vi"]) {
    main.initialize(language);
    assert.equal(main.instance.language, "vi");
    assert.equal(main.instance.t("copy"), "Sao chép");
  }
  assert.equal(main.instance.hasResourceBundle("zh-CN", "translation"), false);

  globalThis.document = { documentElement: { lang: "vi" } };
  const renderer = await bundle("renderer", `
    export { default as instance } from "./src/renderer/i18n.ts";
    export { default as dayjs } from "./src/renderer/lib/dayjs.ts";
  `);
  assert.equal(renderer.instance.language, "vi");
  assert.equal(renderer.instance.t("sidebar.home"), "Trang chủ");
  assert.equal(renderer.dayjs.locale(), "vi");
  for (const language of ["en", "es", "vi"]) {
    await renderer.instance.changeLanguage(language);
    assert.equal(document.documentElement.lang, language);
    assert.equal(renderer.dayjs.locale(), language);
  }
  for (const language of ["zh-CN", "unknown", "vi"]) {
    await renderer.instance.changeLanguage(language);
    assert.equal(document.documentElement.lang, "vi");
    assert.equal(renderer.dayjs.locale(), "vi");
    assert.equal(renderer.instance.t("sidebar.home"), "Trang chủ");
  }
  assert.equal(renderer.instance.hasResourceBundle("zh-CN", "translation"), false);
  assert.match(renderer.dayjs().subtract(2, "day").fromNow(), /ngày/);
  assert.equal(renderer.instance.t("totalRecordings", { total: 3 }), "3 bản ghi âm");
  console.log(`PASS: ${Object.keys(vi).length} Vietnamese keys; interpolation, markup, main/renderer locales, startup saved locale, Spanish Task 2 keys, document language and relative dates.`);
} finally {
  delete globalThis.document;
  await rm(temp, { recursive: true, force: true });
}
