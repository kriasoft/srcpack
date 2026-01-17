<script setup lang="ts">
const beforeItems = [
  "Dump entire repo into prompt",
  "Hit context limits",
  "Get vague or wrong answers",
  "Repeat yourself constantly",
];

const afterItems = [
  "Bundle relevant code by domain",
  "Include file index with line numbers",
  "Get precise, referenced answers",
  "Share context once, ask many times",
];
</script>

<template>
  <section class="home-before-after">
    <h2 class="home-before-after__title">Before & After</h2>
    <div class="home-before-after__grid">
      <div class="home-before-after__column home-before-after__column--before">
        <h3 class="home-before-after__heading">
          <span class="home-before-after__badge home-before-after__badge--before">Before</span>
        </h3>
        <ul class="home-before-after__list">
          <li v-for="item in beforeItems" :key="item" class="home-before-after__item">
            <span class="home-before-after__x">✕</span>
            {{ item }}
          </li>
        </ul>
      </div>
      <div class="home-before-after__column home-before-after__column--after">
        <h3 class="home-before-after__heading">
          <span class="home-before-after__badge home-before-after__badge--after">After</span>
        </h3>
        <ul class="home-before-after__list">
          <li v-for="item in afterItems" :key="item" class="home-before-after__item">
            <span class="home-before-after__check">✓</span>
            {{ item }}
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>

<style scoped>
.home-before-after {
  padding: 64px 0;
  text-align: center;
}

.home-before-after__title {
  font-size: 32px;
  font-weight: 700;
  line-height: 1.2;
  margin: 0 0 40px;
}

.home-before-after__grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 24px;
}

@media (min-width: 640px) {
  .home-before-after__grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

.home-before-after__column {
  padding: 24px;
  border-radius: 12px;
  text-align: left;
}

.home-before-after__column--before {
  background: var(--vp-c-danger-soft);
}

.home-before-after__column--after {
  background: var(--vp-c-brand-soft);
}

.home-before-after__heading {
  margin: 0 0 16px;
}

.home-before-after__badge {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 600;
}

.home-before-after__badge--before {
  background: var(--vp-c-danger-3);
  color: var(--vp-c-white);
}

.home-before-after__badge--after {
  background: var(--vp-c-brand-3);
  color: var(--vp-c-white);
}

.home-before-after__list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.home-before-after__item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 0;
  font-size: 15px;
  line-height: 1.4;
}

.home-before-after__x {
  color: var(--vp-c-danger-1);
  font-weight: 700;
  flex-shrink: 0;
}

.home-before-after__check {
  color: var(--vp-c-brand-1);
  font-weight: 700;
  flex-shrink: 0;
}
</style>
