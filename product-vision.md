---
url: /srcpack/product-vision.md
---
# Product Vision

## One-liner

CLI that bundles repo code into domain-focused context for LLMs.

## Problem

LLM context fails when it's too large, noisy, or flat. Existing tools split by size, not semantics. Teams need repeatable, indexed bundles per domain (db, API, web).

## Users

* Developers using LLMs for refactors, reviews, and design on real codebases
* Teams with multiple domains in one repo

## Principles

* Semantic splitting over size-based
* Index-first output, readable by humans and models
* Safe defaults (respects .gitignore, skips secrets)
* Zero-friction CLI

## MVP Scope

* Named bundles from one repo via simple config
* Per-bundle include/exclude globs
* Index at top (file list + tree), clear file boundaries
* Output: plain text, Markdown, or XML
* Upload to Google Drive folder

## Non-Goals

* MCP server or live streaming
* Auto-classification without config
* IDE plugins

## Success

* Bundles reused across tasks without edits
* Fewer "lost in the middle" hallucinations
* Teams converge on standard context presets
