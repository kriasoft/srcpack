import { defineConfig } from "vitepress";

// https://vitepress.dev/reference/site-config
export default defineConfig({
  srcDir: "docs",
  srcExclude: ["**/*.local.md"],
  cleanUrls: true,
  lastUpdated: true,
  metaChunk: true,
  base: "/srcpack/",

  lang: "en-US",
  title: "Srcpack",
  description: "Context bundler for LLM work",

  head: [
    ["link", { rel: "icon", href: "/srcpack/favicon.ico" }],
    ["meta", { name: "theme-color", content: "#5f67ee" }],
    ["meta", { name: "og:type", content: "website" }],
    ["meta", { name: "og:site_name", content: "Srcpack" }],
  ],

  sitemap: {
    hostname: "https://kriasoft.com/srcpack/",
  },

  themeConfig: {
    logo: "/logo.svg",

    nav: [
      { text: "Home", link: "/" },
      { text: "Guide", link: "/guide/getting-started" },
    ],

    sidebar: [
      {
        text: "Guide",
        items: [{ text: "Getting Started", link: "/guide/getting-started" }],
      },
    ],

    outline: {
      level: [2, 3],
    },

    search: {
      provider: "local",
    },

    editLink: {
      pattern: "https://github.com/kriasoft/srcpack/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },

    lastUpdated: {
      text: "Last updated",
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/kriasoft/srcpack" },
    ],

    footer: {
      message: "Released under the MIT License.",
    },
  },

  vite: {
    publicDir: "../.vitepress/public",
  },
});
