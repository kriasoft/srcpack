<script setup lang="ts">
import { computed } from "vue";

const isDark = computed(() => {
  // VitePress specific approach to check if dark mode is active might be needed,
  // but for the embed, the theme parameter controls the visual.
  // The user requested "Option 2", which has theme=light fixed in the URL.
  // We'll keep it simple for now as requested.
  return false;
});
</script>

<template>
  <div class="ph-container">
    <a
      href="https://www.producthunt.com/products/srcpack?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-srcpack"
      target="_blank"
      rel="noopener noreferrer"
      class="ph-link"
    >
      <img
        src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1064423&theme=light"
        alt="srcpack - Bundle your codebase into LLM-ready context files | Product Hunt"
        style="width: 250px; height: 54px"
        width="250"
        height="54"
      />
    </a>
  </div>
</template>

<style scoped>
.ph-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 24px;
  margin-bottom: 24px;
}

.ph-link {
  transition: opacity 0.25s;
}

.ph-link:hover {
  opacity: 0.8;
}

/* Ensure it looks good on mobile */
@media (max-width: 640px) {
  .ph-container {
    margin-top: 16px;
    margin-bottom: 32px;
  }
}
</style>
