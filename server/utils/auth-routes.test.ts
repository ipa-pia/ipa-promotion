import { isSafeRoute } from "@nuxt-tmpl/core"
import { getAuthMode } from "@ipa-schema/auth"
import { describe, expect, it } from "vitest"
// Published 0.2.12 has no `exports` subpath for runtime/utils, so the template's own
// resolver is reached by relative file path — the point of this test is to run the
// shipped normalization, not a local copy of it.
import { getAuthPageMode, getAuthPageResolver } from "../../node_modules/@nuxt-tmpl/nuxt/dist/runtime/utils/authPageRouting.js"
import { authGuestRoutes, authPublicRoutes } from "../../shared/utils/auth-routes"

// Captured from `NUXT_PUBLIC_AUTH_PROVIDER=supabase nuxt build` on
// @nuxt-tmpl/nuxt 0.2.12: the serialized
// runtimeConfig.public.nuxtTmpl.authPageRouting in
// .output/server/chunks/nitro/nitro.mjs. Regenerate that build and diff this object
// whenever the page table or the template version changes.
const pageRouting = {
  baseURL: "/",
  locales: ["zh-CN", "en"],
  aliases: [
    { path: "/dashboard", canonicalPath: "/dashboard", locale: "zh-CN", key: "dashboard" },
    { path: "/en/dashboard", canonicalPath: "/dashboard", locale: "en", key: "dashboard" },
    { path: "/", canonicalPath: "/", locale: "zh-CN", key: "index" },
    { path: "/en", canonicalPath: "/", locale: "en", key: "index" },
    { path: "/sign-in/:slug(.*)*", canonicalPath: "/sign-in/:slug(.*)*", locale: "zh-CN", key: "sign-in", templatePage: "sign-in" },
    { path: "/en/sign-in/:slug(.*)*", canonicalPath: "/sign-in/:slug(.*)*", locale: "en", key: "sign-in", templatePage: "sign-in" },
    { path: "/sign-up/:slug(.*)*", canonicalPath: "/sign-up/:slug(.*)*", locale: "zh-CN", key: "sign-up", templatePage: "sign-up" },
    { path: "/en/sign-up/:slug(.*)*", canonicalPath: "/sign-up/:slug(.*)*", locale: "en", key: "sign-up", templatePage: "sign-up" },
    { path: "/oauth/consent", canonicalPath: "/oauth/consent", locale: "zh-CN", key: "oauth-consent", templatePage: "consent" },
    { path: "/en/oauth/consent", canonicalPath: "/oauth/consent", locale: "en", key: "oauth-consent", templatePage: "consent" },
  ],
}

// What the build actually serializes: `NUXT_PUBLIC_AUTH_PROVIDER=supabase nuxt build`
// leaves publicRoutes as ["re:^/\\.well-known/oauth-protected-resource(/|$)", "/api/v1/mcp"].
// The module's provider-conditional push of "/oauth/consent" (dist/module.mjs:379-381,
// inside `extendPages`) does not reach the artifact — Nitro takes its runtimeConfig copy
// before pages:extend runs, and only `authPageRouting` survives because the module hands
// that one object over by reference (dist/module.mjs:415-420). Consent therefore rests on
// two other things, both asserted below: @nuxt-tmpl/core's built-in public list contains
// "/oauth/consent", and the mounted page carries `definePageMeta({ auth: "public" })`.
const effectivePublicRoutes = authPublicRoutes

const resolver = getAuthPageResolver(pageRouting as never)

// Server middleware order: raw match first, then the canonical page policy.
function serverSafe(path: string, publicRoutes: string[]): boolean {
  if (isSafeRoute(path, authGuestRoutes, publicRoutes)) return true
  const canonical = resolver.policyPath(path)
  return canonical !== path && isSafeRoute(canonical, authGuestRoutes, publicRoutes)
}

// Client middleware order: raw mode, and only an unresolved "required" may inherit the
// canonical page's policy.
function clientMode(path: string, publicRoutes: string[]): string {
  return getAuthPageMode(path, {}, authGuestRoutes, publicRoutes, pageRouting as never)
}

const guestPaths = [
  "/",
  "/en",
  "/en/",
  "/sign-in",
  "/en/sign-in",
  "/sign-up",
  "/en/sign-up",
  "/dashboard",
  "/en/dashboard",
]

const publicPaths = [
  "/api/v1/mcp",
]

const protectedPaths = [
  "/api/me",
  "/api/promotion",
  "/api/v1/other",
  "/en/api/me",
  "/en/private",
  "/en/oauth/unknown",
  "/en/oauth/consent-other",
]

describe("localized auth routes through the template page policy", () => {
  it.each(guestPaths)("keeps %s guest on server and client without a project alias", (path) => {
    expect(serverSafe(path, effectivePublicRoutes)).toBe(true)
    expect(clientMode(path, effectivePublicRoutes)).toBe("guest")
  })

  it.each(publicPaths)("keeps %s public on server and client", (path) => {
    expect(serverSafe(path, effectivePublicRoutes)).toBe(true)
    expect(clientMode(path, effectivePublicRoutes)).toBe("public")
  })

  it.each(protectedPaths)("does not widen access to %s", (path) => {
    expect(serverSafe(path, effectivePublicRoutes)).toBe(false)
    expect(clientMode(path, effectivePublicRoutes)).toBe("required")
    expect(getAuthMode(path, {}, authGuestRoutes, effectivePublicRoutes)).toBe("required")
  })

  it("keeps the raw matcher honest about the paths it must not widen", () => {
    // These stay unnormalized: the page table has no alias for them.
    expect(resolver.policyPath("/en/private")).toBe("/en/private")
    expect(resolver.policyPath("/en/api/me")).toBe("/en/api/me")
    expect(resolver.policyPath("/en/oauth/consent-other")).toBe("/en/oauth/consent-other")
    expect(resolver.policyPath("/en/dashboard")).toBe("/dashboard")
  })

  it("carries consent on the mounted page, not on a project alias", () => {
    // Server: both locales clear, because @nuxt-tmpl/core lists "/oauth/consent" as a
    // built-in exemption and the localized alias resolves to it.
    expect(serverSafe("/oauth/consent", effectivePublicRoutes)).toBe(true)
    expect(serverSafe("/en/oauth/consent", effectivePublicRoutes)).toBe(true)
    // Client: the route lists alone are not enough — @ipa-schema/auth does not carry
    // that built-in, so the page's own `definePageMeta({ auth: "public" })` is what
    // makes it public. That meta exists only because the module mounts the consent
    // page under `provider === "supabase"` (dist/module.mjs:371-376): on any other
    // provider there is no consent route to be public. Adding an "/en" alias here
    // would claim public access for a page the build never registers.
    expect(clientMode("/en/oauth/consent", effectivePublicRoutes)).toBe("required")
    expect(getAuthPageMode("/en/oauth/consent", { auth: "public" }, authGuestRoutes, effectivePublicRoutes, pageRouting as never)).toBe("public")
  })

  it("narrows the trailing-slash form of the localized consent page", () => {
    // Behavior change from dropping `re:^/en/oauth/consent/?$`: inside the /oauth/
    // namespace the resolver only answers for an alias path it registered verbatim, so
    // the slash-carrying form is not normalized and the server middleware now treats it
    // like any unknown path. The page itself still renders public via its own meta.
    expect(resolver.policyPath("/en/oauth/consent/")).toBe("/en/oauth/consent/")
    expect(serverSafe("/en/oauth/consent/", effectivePublicRoutes)).toBe(false)
    expect(clientMode("/en/oauth/consent/", effectivePublicRoutes)).toBe("required")
    expect(getAuthPageMode("/en/oauth/consent/", { auth: "public" }, authGuestRoutes, effectivePublicRoutes, pageRouting as never)).toBe("public")
  })
})
