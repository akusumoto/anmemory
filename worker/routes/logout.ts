import { jsonResponse, methodNotAllowed } from '../http.ts'
import { clearSessionCookie } from '../session.ts'

export function handleLogout(request: Request): Response {
  if (request.method !== 'POST') {
    return methodNotAllowed('POST')
  }

  return jsonResponse(
    { authenticated: false },
    { headers: { 'Set-Cookie': clearSessionCookie() } },
  )
}
