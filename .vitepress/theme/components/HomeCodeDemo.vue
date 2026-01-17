<script setup lang="ts">
const configExample = `bundles:
  web:
    include: ["app/**", "components/**"]
  api:
    include: ["server/**", "routes/**"]
  db:
    include: ["prisma/**", "migrations/**"]`;

const outputExample = `# srcpack: web
# Generated: 2025-01-17

## Files (12 files, 2,847 lines)

| # | File | Lines |
|---|------|-------|
| 1 | app/layout.tsx | 45 |
| 2 | app/page.tsx | 128 |
| 3 | components/Button.tsx | 67 |
...

## Contents

### [1] app/layout.tsx
\`\`\`tsx
export default function RootLayout...
\`\`\``;
</script>

<template>
  <section class="home-code-demo">
    <h2 class="home-code-demo__title">How It Works</h2>
    <p class="home-code-demo__subtitle">
      Define semantic bundles. Get indexed, LLM-ready output.
    </p>
    <div class="home-code-demo__grid">
      <div class="home-code-demo__block">
        <div class="home-code-demo__header">
          <span class="home-code-demo__label">srcpack.yaml</span>
        </div>
        <pre class="home-code-demo__code"><code>{{ configExample }}</code></pre>
      </div>
      <div class="home-code-demo__block">
        <div class="home-code-demo__header">
          <span class="home-code-demo__label">Output Format</span>
        </div>
        <pre class="home-code-demo__code"><code>{{ outputExample }}</code></pre>
      </div>
    </div>
  </section>
</template>

<style scoped>
.home-code-demo {
  padding: 64px 0;
  text-align: center;
}

.home-code-demo__title {
  font-size: 32px;
  font-weight: 700;
  line-height: 1.2;
  margin: 0 0 8px;
}

.home-code-demo__subtitle {
  font-size: 18px;
  color: var(--vp-c-text-2);
  margin: 0 0 40px;
}

.home-code-demo__grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 24px;
  text-align: left;
}

@media (min-width: 768px) {
  .home-code-demo__grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

.home-code-demo__block {
  background: var(--vp-c-bg-soft);
  border-radius: 12px;
  overflow: hidden;
}

.home-code-demo__header {
  padding: 12px 16px;
  background: var(--vp-c-bg-alt);
  border-bottom: 1px solid var(--vp-c-divider);
}

.home-code-demo__label {
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-text-2);
}

.home-code-demo__code {
  margin: 0;
  padding: 16px;
  font-size: 13px;
  line-height: 1.6;
  overflow-x: auto;
  color: var(--vp-c-text-1);
}

.home-code-demo__code code {
  font-family: var(--vp-font-family-mono);
}
</style>
