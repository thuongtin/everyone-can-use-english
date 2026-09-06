import { resolveConfiguredSiteUrl } from "./utils/distribution-links";

const siteUrl = resolveConfiguredSiteUrl(process.env.NUXT_SITE_URL);

export default defineNuxtConfig({
  devtools: { enabled: true },
  css: ["~/styles/main.css"],
  runtimeConfig: {
    public: {
      docsUrl: "",
      downloadUrl: "",
      repositoryUrl: "",
    },
  },
  site: {
    ...(siteUrl ? { url: siteUrl } : {}),
    name: "Enjoy App",
    description: "Học tiếng Anh cùng Enjoy, với hướng dẫn bằng tiếng Việt và học liệu tiếng Anh.",
    tagline: "",
    defaultLocale: "vi", // not needed if you have @nuxtjs/i18n installed
  },
  sitemap: {
    enabled: Boolean(siteUrl),
  },

  app: {
    buildAssetsDir: "portal-assets",
    head: {
      htmlAttrs: { lang: "vi" },
      viewport:
        "width=device-width, initial-scale=1, viewport-fit=cover",
      meta: [{ name: "theme-color", content: "#ffffff" }],
      link: [
        {
          rel: "apple-touch-icon",
          sizes: "180x180",
          href: "/portal-static/images/apple-touch-icon.png",
        },
        {
          rel: "icon",
          type: "image/x-icon",
          sizes: "48x48",
          href: "/portal-static/images/favicon.ico",
        },
        {
          rel: "icon",
          type: "image/png",
          sizes: "32x32",
          href: "/portal-static/images/favicon-32x32.png",
        },
        {
          rel: "icon",
          type: "image/png",
          sizes: "16x16",
          href: "/portal-static/images/favicon-16x16.png",
        },
      ],
      script: [],
    },
  },

  postcss: {
    plugins: {
      tailwindcss: {},
      autoprefixer: {},
    },
  },

  modules: ["@nuxtjs/seo"],
});
