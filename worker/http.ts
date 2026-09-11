export function jsonResponse(
  value: unknown,
  init: ResponseInit = {},
): Response {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  headers.set('Cache-Control', 'no-store')
  return Response.json(value, { ...init, headers })
}

export function methodNotAllowed(allowed: string): Response {
  return jsonResponse(
    { error: 'Method Not Allowed' },
    { status: 405, headers: { Allow: allowed } },
  )
}

export function unauthorized(): Response {
  return jsonResponse({ error: 'Unauthorized' }, { status: 401 })
}
