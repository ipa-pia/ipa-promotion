const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i

/**
 * 补全链接协议，避免缺少协议时被浏览器当作相对路径，
 * 拼接到当前站点路径下（如 `/www.example.com/...`）。
 */
export function toAbsoluteUrl(raw: string | null | undefined): string {
  const value = (raw ?? "").trim()
  if (!value) return ""
  if (SCHEME_PATTERN.test(value) || value.startsWith("//") || value.startsWith("/")) {
    return value
  }
  return `https://${value}`
}
