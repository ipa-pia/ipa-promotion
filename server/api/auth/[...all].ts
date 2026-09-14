export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig();
  const provider =
    runtimeConfig.public?.authProvider ||
    (runtimeConfig.public as any)?.auth?.provider;
  if (provider !== "better-auth") return;
  try {
    const { auth } = await import("#shared/utils/better-auth");
    return auth.handler(toWebRequest(event));
  } catch {
    // better-auth not installed
  }
});

