<script setup lang="ts">
import { useData } from "vitepress";
import HomeProblem from "./HomeProblem.vue";
import HomeBeforeAfter from "./HomeBeforeAfter.vue";
import HomeCodeDemo from "./HomeCodeDemo.vue";
import HomeCTA from "./HomeCTA.vue";

const { frontmatter } = useData();
</script>

<template>
  <div v-if="frontmatter.layout === 'home'" class="home-custom">
    <HomeProblem />
    <HomeBeforeAfter />
    <HomeCodeDemo />
    <HomeCTA />
  </div>
</template>

<style scoped>
.home-custom {
  max-width: 1152px;
  margin: 0 auto;
  padding: 0 24px;
}

@media (min-width: 640px) {
  .home-custom {
    padding: 0 48px;
  }
}

@media (min-width: 960px) {
  .home-custom {
    padding: 0 64px;
  }
}
</style>
