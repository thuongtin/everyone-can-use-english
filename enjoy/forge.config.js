import { VitePlugin } from "@electron-forge/plugin-vite";
import os from "os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import pkg from "./package.json" with { type: "json" };
import { removeRecursiveNodeModulesLink } from "./scripts/package-guard.mjs";
import { localSigningOptions } from "./scripts/local-signing.mjs";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const config = {
  hooks: {
    postPackage: async (forgeConfig, { platform, outputPaths }) => {
      if (platform !== "darwin") return;
      // The fuse plugin signs Electron before the packager renames its bundle.
      // Re-seal local builds after Info.plist and resources reach their final form.
      for (const outputPath of outputPaths) {
        const bundle = path.join(outputPath, "Enjoy.app");
        if (!forgeConfig.packagerConfig.osxSign) {
          execFileSync("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", bundle]);
        }
        execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", bundle]);
      }
    },
    prePackage: async () => {
      await removeRecursiveNodeModulesLink(projectRoot);
    },
    generateAssets: async () => {
      await import("./scripts/download-dictionaries.mjs");
    },
  },
  packagerConfig: {
    asar: {
      // Binary files won't work in asar, so we need to unpack them
      unpackDir: `{.vite/build/lib,.vite/build/samples,node_modules/ffmpeg-static,node_modules/@andrkrn/ffprobe-static,node_modules/onnxruntime-node/bin/napi-v3/${os.platform()}/${os.arch()},lib/dictionaries,node_modules/@agentclientprotocol,node_modules/@anthropic-ai/claude-agent-sdk*,node_modules/@openai/codex*,node_modules/zod}`,
    },
    icon: "./assets/icon",
    name: "Enjoy",
    executableName: "enjoy",
    protocols: [
      {
        name: "Enjoy",
        schemes: ["enjoy"],
      },
    ],
  },
  rebuildConfig: {},
  makers: [
    {
      name: "@electron-forge/maker-dmg",
      config: {
        icon: "./assets/icon.png",
      },
    },
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin", "linux"],
    },
    {
      name: "@electron-forge/maker-squirrel",
    },
    {
      name: "@electron-forge/maker-deb",
      config: () => ({
        options: {
          name: "enjoy",
          productName: "Enjoy",
          icon: "./assets/icon.png",
          mimeType: ["x-scheme-handler/enjoy"],
        },
      }),
    },
    // new MakerRpm({
    //   options: {
    //     name: "enjoy",
    //     productName: "Enjoy",
    //     icon: "./assets/icon.png",
    //     mimeType: ["x-scheme-handler/enjoy"],
    //   },
    // }),
  ],
  publishers: [],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: "src/main.ts",
          config: "vite.main.config.ts",
          target: "main",
        },
        {
          entry: "src/preload.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts",
        },
        {
          name: "asr_classifier",
          config: "vite.asr-classifier.config.ts",
        },
      ],
    }),
    {
      name: "@electron-forge/plugin-auto-unpack-natives",
      config: {},
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      // Local app data and provider configuration live in the profile database.
      // A separate Chromium store preserves legacy encrypted cookies untouched.
      [FuseV1Options.EnableCookieEncryption]: false,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: true,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: false,
    }),
    {
      name: "electron-forge-plugin-dependencies",
      config: {
        dependencies: Object.keys(pkg.dependencies),
      },
    },
  ],
};

const macOsCodesignConfig = {
  osxSign: {},
  osxNotarize: {
    tool: "notarytool",
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  },
};

if (
  os.platform() === "darwin" &&
  process.env.APPLE_ID &&
  process.env.APPLE_APP_PASSWORD &&
  process.env.APPLE_TEAM_ID
) {
  config.packagerConfig = {
    ...config.packagerConfig,
    ...macOsCodesignConfig,
  };
} else if (os.platform() === "darwin") {
  const osxSign = localSigningOptions(projectRoot);
  if (osxSign) config.packagerConfig.osxSign = osxSign;
}

if (process.env.GITHUB_TOKEN) {
  config.publishers = [
    ...config.publishers,
    {
      name: "@electron-forge/publisher-github",
      config: {
        repository: {
          owner: "ZuodaoTech",
          name: "everyone-can-use-english",
        },
        generateReleaseNotes: true,
        draft: true,
      },
    },
  ];
}

if (
  process.env.S3_ACCESS_KEY_ID &&
  process.env.S3_SECRET_ACCESS_KEY &&
  process.env.S3_ENDPOINT
) {
  config.publishers = [
    ...config.publishers,
    {
      name: "@electron-forge/publisher-s3",
      config: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        endpoint: process.env.S3_ENDPOINT,
        bucket: "download",
        folder: "app",
        region: "auto",
        public: true,
      },
    },
  ];
}

export default config;
