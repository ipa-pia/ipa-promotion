import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { getHeader, getRequestURL, readBody } from "h3"
import { resolveTokenUser } from "../../utils/auth-identity"
import { createPromotionMcpServer } from "../../utils/mcp"

function authChallenge(event: Parameters<typeof getRequestURL>[0]): string {
  const metadataUrl = `${getRequestURL(event).origin}/.well-known/oauth-protected-resource/api/v1/mcp`
  return `Bearer realm="ipa-promotion", resource_metadata="${metadataUrl}"`
}

function unauthorized(challenge: string): Response {
  return Response.json({ error: "unauthorized" }, {
    status: 401,
    headers: { "WWW-Authenticate": challenge },
  })
}

function requestHeaders(event: Parameters<typeof getRequestURL>[0]): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(event.node.req.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value)
  }
  return headers
}

export default defineEventHandler(async (event) => {
  skipResponseWrap(event)
  const challenge = authChallenge(event)
  const token = getHeader(event, "authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1]
  if (!token) return unauthorized(challenge)

  const user = await resolveTokenUser(event, token)
  if (!user) return unauthorized(challenge)

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  const server = createPromotionMcpServer({ token, user })
  await server.connect(transport)

  try {
    const request = new Request(getRequestURL(event).href, {
      method: "POST",
      headers: requestHeaders(event),
    })
    return await transport.handleRequest(request, { parsedBody: await readBody(event) })
  }
  finally {
    await server.close()
  }
})
