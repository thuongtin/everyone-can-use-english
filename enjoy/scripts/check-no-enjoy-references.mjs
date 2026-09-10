import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const targets = [
  "enjoy/src", "enjoy/package.json", "enjoy/forge.config.js",
  "1000h-portal/components", "1000h-portal/pages", "1000h-portal/utils",
  "1000-hours/enjoy-app/install.md", "1000-hours/enjoy-app/settings.md",
  "1000-hours/enjoy-app/faq.md", "README.md",
];
// The denylist is the only production source that should spell retired hosts.
const hostnameDefinition = "enjoy/src/lib/network-policy.ts";
const violations = [];
let inspected = 0;
async function visit(relative) {
  const filename = path.join(root, relative);
  if ((await stat(filename)).isDirectory()) {
    for (const entry of await readdir(filename)) await visit(path.join(relative, entry));
    return;
  }
  if (!/\.(?:[cm]?[jt]sx?|json|vue|md)$/u.test(filename)) return;
  inspected += 1;
  const source = await readFile(filename, "utf8");
  const lines = source.split(/\r?\n/u);
  lines.forEach((line, index) => {
    let decoded = line.replace(/\\u([\da-f]{4})/giu, (_match, value) => String.fromCharCode(Number.parseInt(value, 16)));
    for (let pass = 0; pass < 2; pass += 1) {
      try { decoded = decodeURIComponent(decoded); } catch { break; }
    }
    if (relative !== hostnameDefinition && /enjoy\.bot|api\.getenjoyapp\.com|enjoy-storage\.baizhiheizi\.com/iu.test(decoded)) {
      violations.push(`${relative}:${index + 1}: retired hostname outside denylist`);
    }
    if (relative.startsWith("enjoy/src/") && /\bwebApi\b|["']@\/api["']|\b(?:WEB_API_URL|WS_URL|STORAGE_WORKER_ENDPOINTS?|AI_WORKER_ENDPOINT)\b/u.test(line)) {
      violations.push(`${relative}:${index + 1}: retired backend client or endpoint symbol`);
    }
  });
}
for (const target of targets) await visit(target);
assert.deepEqual(violations, [], violations.join("\n"));
console.log(`PASS: ${inspected} production/docs files have no retired endpoint references or backend client symbols outside the hostname denylist.`);
