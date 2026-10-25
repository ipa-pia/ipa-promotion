export default defineEventHandler((event) => {
  skipResponseWrap(event)
  return new Response(null, {
    status: 405,
    headers: { Allow: "POST" },
  })
})
