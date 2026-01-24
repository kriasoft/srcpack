// https://vitepress.dev/guide/custom-theme
import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";
import { h } from "vue";
import HomeCustomSections from "./components/HomeCustomSections.vue";
import HomeProductHuntBadge from "./components/HomeProductHuntBadge.vue";
import "./style.css";

export default {
  extends: DefaultTheme,
  Layout: () => {
    return h(DefaultTheme.Layout, null, {
      // https://vitepress.dev/guide/extending-default-theme#layout-slots
      "home-features-after": () => [
        h(HomeCustomSections),
        h(HomeProductHuntBadge),
      ],
    });
  },
} satisfies Theme;
