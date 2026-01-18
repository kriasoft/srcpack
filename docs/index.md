---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "Srcpack"
  text: "Make your codebase explain itself"
  tagline: "Bundle your code for LLMs. Get precise answers via ChatGPT, Grok, Gemini."
  image:
    src: /srcpack.png
    alt: Srcpack App Interface
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/kriasoft/srcpack

features:
  - icon: 📦
    title: Semantic Bundles
    details: Split by domain (web, api, db) not arbitrary size. Keep related code together.
  - icon: 📑
    title: Indexed Output
    details: File list with line numbers at top. LLMs can reference exact locations.
  - icon: 🔒
    title: Safe Defaults
    details: Respects .gitignore. Excludes binaries and secrets. Zero config to start.
---
