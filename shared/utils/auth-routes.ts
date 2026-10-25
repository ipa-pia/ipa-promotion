// Keep these paths aligned with @nuxt-tmpl/core's server matcher and
// @ipa-schema/auth's client matcher. The template matches raw, localized URLs.
export const authGuestRoutes = [
  "/dashboard",
  "re:^/en/?$",
  "/en/sign-in",
  "/en/sign-up",
  "/en/dashboard",
]

export const authPublicRoutes = [
  "/api/v1/mcp",
  "re:^/en/oauth/consent/?$",
]
