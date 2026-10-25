import { describe, expect, it } from "vitest"
import { assertAdmin, hasExpectedOAuthClaims, isAdminUser } from "./auth-identity"

function tokenWithClaims(claims: Record<string, unknown>) {
  return `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`
}

describe("MCP identity rules", () => {
  it("uses only server-controlled app_metadata for admin identity", () => {
    expect(isAdminUser({ app_metadata: { role: "admin" } } as never)).toBe(true)
    expect(isAdminUser({ user_metadata: { role: "admin" } } as never)).toBe(false)
    expect(isAdminUser(null)).toBe(false)
  })

  it("maps missing identity to 401 and non-admin identity to 403", () => {
    expect(() => assertAdmin(null)).toThrowError(expect.objectContaining({ statusCode: 401 }))
    expect(() => assertAdmin({ app_metadata: {} } as never)).toThrowError(expect.objectContaining({ statusCode: 403 }))
    expect(assertAdmin({ app_metadata: { role: "admin" } } as never).isAdmin).toBe(true)
  })

  it("checks issuer and audience against configured Supabase authority", () => {
    const authority = "https://project.supabase.co"
    expect(hasExpectedOAuthClaims(tokenWithClaims({
      iss: `${authority}/auth/v1`,
      aud: "authenticated",
    }), authority)).toBe(true)
    expect(hasExpectedOAuthClaims(tokenWithClaims({
      iss: "https://attacker.example/auth/v1",
      aud: "authenticated",
    }), authority)).toBe(false)
    expect(hasExpectedOAuthClaims(tokenWithClaims({
      iss: `${authority}/auth/v1`,
      aud: ["authenticated"],
    }), authority)).toBe(false)
    expect(hasExpectedOAuthClaims("not-a-jwt", authority)).toBe(false)
  })
})
