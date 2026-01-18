import { defineConfig } from "vitepress";
import llmstxt from "vitepress-plugin-llms";

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
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:site_name", content: "Srcpack" }],
    ["meta", { property: "og:title", content: "Srcpack" }],
    [
      "meta",
      { property: "og:description", content: "Context bundler for LLM work" },
    ],
    ["meta", { property: "og:url", content: "https://kriasoft.com/srcpack/" }],
    [
      "meta",
      {
        property: "og:image",
        content: "https://kriasoft.com/srcpack/srcpack.png",
      },
    ],
    ["meta", { name: "twitter:card", content: "summary" }],
    ["meta", { name: "twitter:title", content: "Srcpack" }],
    [
      "meta",
      { name: "twitter:description", content: "Context bundler for LLM work" },
    ],
    [
      "meta",
      {
        name: "twitter:image",
        content: "https://kriasoft.com/srcpack/srcpack.png",
      },
    ],
    [
      "link",
      {
        rel: "alternate",
        type: "text/plain",
        href: "/srcpack/llms.txt",
        title: "LLM context",
      },
    ],
    [
      "link",
      {
        rel: "alternate",
        type: "text/plain",
        href: "/srcpack/llms-full.txt",
        title: "LLM context (full)",
      },
    ],
  ],

  sitemap: {
    hostname: "https://kriasoft.com/srcpack/",
    transformItems: (items) => {
      items.push({ url: "llms.txt" }, { url: "llms-full.txt" });
      return items;
    },
  },

  themeConfig: {
    logo: { src: "/logo.png", width: 24, height: 24, alt: "Srcpack" },

    nav: [
      { text: "Home", link: "/" },
      { text: "Guide", link: "/getting-started" },
    ],

    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Why Srcpack", link: "/why-srcpack" },
          { text: "Getting Started", link: "/getting-started" },
          { text: "Configuration", link: "/configuration" },
          { text: "CLI Reference", link: "/cli" },
          { text: "Google Drive Upload", link: "/upload" },
        ],
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
      { icon: "discord", link: "https://discord.com/invite/aG83xEb6RX" },
      { icon: "x", link: "https://x.com/kriasoft" },
      { icon: "bluesky", link: "https://bsky.app/profile/kriasoft.com" },
    ],

    footer: {
      message:
        'LLM context: <a href="/srcpack/llms.txt">llms.txt</a> · <a href="/srcpack/llms-full.txt">llms-full.txt</a><br>Released under the MIT License.',
    },
  },

  vite: {
    publicDir: "../.vitepress/public",
    plugins: [llmstxt()],
  },
});
