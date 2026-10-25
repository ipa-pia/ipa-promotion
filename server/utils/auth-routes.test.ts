import { isSafeRoute } from "@nuxt-tmpl/core"
import { getAuthMode } from "@ipa-schema/auth"
import { describe, expect, it } from "vitest"
import { authGuestRoutes, authPublicRoutes } from "../../shared/utils/auth-routes"

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
  "/en/oauth/consent",
  "/en/oauth/consent/",
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

describe("localized auth route aliases", () => {
  it.each(guestPaths)("keeps %s guest on server and client", (path) => {
    expect(isSafeRoute(path, authGuestRoutes, authPublicRoutes)).toBe(true)
    expect(getAuthMode(path, {}, authGuestRoutes, authPublicRoutes)).toBe("guest")
  })

  it.each(publicPaths)("keeps %s public on server and client", (path) => {
    expect(isSafeRoute(path, authGuestRoutes, authPublicRoutes)).toBe(true)
    expect(getAuthMode(path, {}, authGuestRoutes, authPublicRoutes)).toBe("public")
  })

  it.each(protectedPaths)("does not widen access to %s", (path) => {
    expect(isSafeRoute(path, authGuestRoutes, authPublicRoutes)).toBe(false)
    expect(getAuthMode(path, {}, authGuestRoutes, authPublicRoutes)).toBe("required")
  })
})
