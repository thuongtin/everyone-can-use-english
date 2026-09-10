import path from "node:path";
import { defineConfig, type ConfigEnv, type UserConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { pluginExposeRenderer } from "./vite.base.config";

export default defineConfig((env) => {
  const forgeEnv = env as ConfigEnv<"renderer">;
  const name = forgeEnv.forgeConfigSelf?.name ?? "asr_classifier";
  return {
    root: path.resolve(__dirname, "src/asr-classifier"),
    mode: forgeEnv.mode,
    base: "./",
    build: {
      sourcemap: true,
      outDir: path.resolve(__dirname, `.vite/renderer/${name}`),
      target: "esnext",
      emptyOutDir: true,
    },
    plugins: [
      pluginExposeRenderer(name),
      viteStaticCopy({
        targets: [
          {
            src: path.resolve(__dirname, "node_modules/@litertjs/core/wasm/{litert_wasm_internal.js,litert_wasm_internal.wasm}"),
            dest: "wasm",
          },
          {
            src: path.resolve(__dirname, "lib/asr-classifier/*"),
            dest: "model",
          },
        ],
      }),
    ],
    clearScreen: false,
  } as UserConfig;
});
