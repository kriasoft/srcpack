<script setup lang="ts">
import { ref } from "vue";

const copied = ref(false);
const command = "npx srcpack";

function copyCommand() {
  navigator.clipboard.writeText(command);
  copied.value = true;
  setTimeout(() => {
    copied.value = false;
  }, 2000);
}
</script>

<template>
  <section class="home-cta">
    <h2 class="home-cta__title">Ready to try?</h2>
    <p class="home-cta__subtitle">
      Run a single command. Zero configuration required.
    </p>
    <div class="home-cta__command" @click="copyCommand">
      <code class="home-cta__code">{{ command }}</code>
      <button class="home-cta__copy" :class="{ 'home-cta__copy--copied': copied }">
        <span v-if="copied">Copied!</span>
        <span v-else>Copy</span>
      </button>
    </div>
    <div class="home-cta__actions">
      <a href="/srcpack/guide/getting-started" class="home-cta__button home-cta__button--primary">
        Read the Docs
      </a>
      <a href="https://github.com/kriasoft/srcpack" class="home-cta__button home-cta__button--secondary">
        View on GitHub
      </a>
    </div>
  </section>
</template>

<style scoped>
.home-cta {
  padding: 64px 0 96px;
  text-align: center;
}

.home-cta__title {
  font-size: 32px;
  font-weight: 700;
  line-height: 1.2;
  margin: 0 0 8px;
}

.home-cta__subtitle {
  font-size: 18px;
  color: var(--vp-c-text-2);
  margin: 0 0 32px;
}

.home-cta__command {
  display: inline-flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px 12px 24px;
  background: var(--vp-c-bg-soft);
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s;
}

.home-cta__command:hover {
  background: var(--vp-c-bg-alt);
}

.home-cta__code {
  font-family: var(--vp-font-family-mono);
  font-size: 16px;
  color: var(--vp-c-brand-1);
}

.home-cta__copy {
  padding: 6px 12px;
  background: var(--vp-c-brand-3);
  color: var(--vp-c-white);
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
}

.home-cta__copy:hover {
  background: var(--vp-c-brand-2);
}

.home-cta__copy--copied {
  background: var(--vp-c-green-3);
}

.home-cta__actions {
  display: flex;
  justify-content: center;
  gap: 16px;
  margin-top: 32px;
  flex-wrap: wrap;
}

.home-cta__button {
  display: inline-block;
  padding: 12px 24px;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
  transition: all 0.2s;
}

.home-cta__button--primary {
  background: var(--vp-c-brand-3);
  color: var(--vp-c-white);
}

.home-cta__button--primary:hover {
  background: var(--vp-c-brand-2);
}

.home-cta__button--secondary {
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
}

.home-cta__button--secondary:hover {
  background: var(--vp-c-bg-alt);
}
</style>
