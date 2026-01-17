<script setup lang="ts">
const problems = [
  {
    icon: "📏",
    title: "Too Large",
    description: "Context windows fill up fast. Critical code gets cut off.",
  },
  {
    icon: "🗑️",
    title: "Too Noisy",
    description: "Lock files, configs, and boilerplate drown out your code.",
  },
  {
    icon: "🌀",
    title: "Lost in the Middle",
    description: "LLMs struggle with long contexts. Important code gets ignored.",
  },
];
</script>

<template>
  <section class="home-problem">
    <h2 class="home-problem__title">The Problem</h2>
    <p class="home-problem__subtitle">
      Pasting raw source code into LLMs doesn't work well.
    </p>
    <div class="home-problem__grid">
      <div
        v-for="problem in problems"
        :key="problem.title"
        class="home-problem__card"
      >
        <span class="home-problem__icon">{{ problem.icon }}</span>
        <h3 class="home-problem__card-title">{{ problem.title }}</h3>
        <p class="home-problem__card-desc">{{ problem.description }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.home-problem {
  padding: 64px 0;
  text-align: center;
}

.home-problem__title {
  font-size: 32px;
  font-weight: 700;
  line-height: 1.2;
  margin: 0 0 8px;
}

.home-problem__subtitle {
  font-size: 18px;
  color: var(--vp-c-text-2);
  margin: 0 0 40px;
}

.home-problem__grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 24px;
}

@media (min-width: 640px) {
  .home-problem__grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

.home-problem__card {
  padding: 24px;
  background: var(--vp-c-bg-soft);
  border-radius: 12px;
  text-align: center;
}

.home-problem__icon {
  font-size: 40px;
  display: block;
  margin-bottom: 16px;
}

.home-problem__card-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 8px;
}

.home-problem__card-desc {
  font-size: 14px;
  color: var(--vp-c-text-2);
  margin: 0;
  line-height: 1.5;
}
</style>
