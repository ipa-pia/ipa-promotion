// Project-specific paths only. Locale variants are no longer listed here:
// @nuxt-tmpl/nuxt publishes the final page table as
// `runtimeConfig.public.nuxtTmpl.authPageRouting`, and both matchers normalize a
// registered localized page to its canonical path before deciding — the server
// re-runs `isSafeRoute` on `policyPath(path)`, the client runs `getAuthPageMode`.
// Unknown localized paths (and everything outside the page table, such as `/api`)
// keep matching raw, so they stay protected.
export const authGuestRoutes = [
  "/dashboard",
]

// "/oauth/consent" is deliberately absent. Its public attribute is bound to the
// supabase provider: the module only mounts the consent page when
// `NUXT_PUBLIC_AUTH_PROVIDER === "supabase"` (dist/module.mjs:371-376), and the page
// declares `definePageMeta({ auth: "public" })` itself. Server-side the path is covered
// by @nuxt-tmpl/core's built-in exemptions; the module's conditional push of
// "/oauth/consent" into this list (dist/module.mjs:379-381) does not survive into the
// build artifact, so do not "harden" consent by adding an "/en" alias here — that would
// grant public access to a route providers other than supabase never register.
export const authPublicRoutes = [
  "/api/v1/mcp",
]
