import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const outputDirectory = process.env.ENJOY_E2E_OUTPUT_DIR
  ? path.resolve(process.env.ENJOY_E2E_OUTPUT_DIR)
  : path.join(projectRoot, "test-results");

export default defineConfig({
  testDir: path.join(projectRoot, "e2e"),
  outputDir: outputDirectory,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["html", { outputFolder: outputDirectory, open: "never" }]],
  use: {
    trace: "on-first-retry",
  },
  timeout: 60000,
});
