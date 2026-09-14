import { defineNuxtPlugin } from "#app";
import "./element-plus/theme.scss";

import "element-plus/dist/index.css";

import "element-plus/theme-chalk/dark/css-vars.css";
import "./element-plus/css-vars.css";

export default defineNuxtPlugin((_nuxtApp) => {
  console.info("plugin element-plus loaded")
});
