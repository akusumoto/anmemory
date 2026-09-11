import { verifyPassword } from '../auth.ts'
import type { AppEnv } from '../env.ts'
import { jsonResponse, methodNotAllowed } from '../http.ts'
import { createSessionCookie, createSessionToken } from '../session.ts'

const MAX_PASSWORD_LENGTH = 1_024

function requestIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown'
}

export async function handleLogin(
  request: Request,
  env: AppEnv,
): Promise<Response> {
  if (request.method !== 'POST') {
    return methodNotAllowed('POST')
  }

  let password: unknown
  try {
    const body = (await request.json()) as { password?: unknown }
    password = body.password
  } catch {
    return jsonResponse({ error: 'Invalid request' }, { status: 400 })
  }

  if (
    typeof password !== 'string' ||
    password.length === 0 ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    return jsonResponse({ error: 'Invalid request' }, { status: 400 })
  }

  let passwordMatches: boolean
  try {
    passwordMatches = await verifyPassword(
      password,
      env.MASTER_PASSWORD_VERIFIER,
    )
  } catch {
    return jsonResponse(
      { error: 'Authentication is not configured' },
      { status: 500 },
    )
  }

  if (!passwordMatches) {
    const { success } = await env.LOGIN_RATE_LIMITER.limit({
      key: requestIp(request),
    })
    if (!success) {
      return jsonResponse(
        { error: 'Too Many Requests' },
        { status: 429, headers: { 'Retry-After': '60' } },
      )
    }

    return jsonResponse({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const token = await createSessionToken(env.SESSION_SECRET)
    return jsonResponse(
      { authenticated: true },
      { headers: { 'Set-Cookie': createSessionCookie(token) } },
    )
  } catch {
    return jsonResponse(
      { error: 'Authentication is not configured' },
      { status: 500 },
    )
  }
}
