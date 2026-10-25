import { describe, expect, it } from "vitest"
import {
  promotionCreateSchema,
  promotionListQuerySchema,
  promotionUpdateSchema,
} from "./promotion"

describe("promotion contracts", () => {
  it("applies create defaults, trims text and rejects unknown fields", () => {
    expect(promotionCreateSchema.parse({ name: "  Example ", url: " www.example.com " })).toEqual({
      name: "Example",
      url: "www.example.com",
      category: "other",
      description: "",
      rebate: null,
      inviteCode: null,
      coverUrl: null,
      sort: 0,
      isActive: true,
    })
    expect(promotionCreateSchema.safeParse({ name: "Example", url: "https://example.com", typo: true }).success).toBe(false)
  })

  it("validates URL, integer, description, and length constraints", () => {
    expect(promotionCreateSchema.safeParse({ name: "Example", url: "/relative" }).success).toBe(false)
    expect(promotionCreateSchema.safeParse({ name: "Example", url: "https://example.com", sort: "10" }).success).toBe(false)
    expect(promotionCreateSchema.safeParse({ name: "Example", url: "https://example.com", description: 12 }).success).toBe(false)
    expect(promotionCreateSchema.safeParse({ name: " ", url: "https://example.com" }).success).toBe(false)
  })

  it("keeps update fields optional and rejects an unknown update key", () => {
    expect(promotionUpdateSchema.parse({ rebate: "  " })).toEqual({ rebate: "" })
    expect(promotionUpdateSchema.safeParse({ name: "valid", extra: 1 }).success).toBe(false)
  })

  it("defaults and bounds list pagination", () => {
    expect(promotionListQuerySchema.parse({})).toEqual({
      includeInactive: false,
      page: 1,
      limit: 20,
    })
    expect(promotionListQuerySchema.safeParse({ limit: 51 }).success).toBe(false)
    expect(promotionListQuerySchema.safeParse({ page: 0 }).success).toBe(false)
  })
})
