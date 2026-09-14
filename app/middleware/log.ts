export default defineNuxtRouteMiddleware((to, from) => {
  console.debug(from, "->", to);
});
