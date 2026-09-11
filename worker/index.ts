import type { AppEnv } from './env.ts'
import { jsonResponse, unauthorized } from './http.ts'
import { handleEncryptionCheck } from './routes/encryption.ts'
import { handleAudio } from './routes/audio.ts'
import { handleLogin } from './routes/login.ts'
import { handleLogout } from './routes/logout.ts'
import { handleSession } from './routes/session.ts'
import { handleStorageCheck } from './routes/storage.ts'
import { isAuthenticated } from './session.ts'

async function handleApi(request: Request, env: AppEnv): Promise<Response> {
  const pathname = new URL(request.url).pathname

  if (pathname === '/api/login') {
    return handleLogin(request, env)
  }
  if (pathname === '/api/logout') {
    return handleLogout(request)
  }
  if (pathname === '/api/session') {
    return handleSession(request, env)
  }

  if (!(await isAuthenticated(request, env.SESSION_SECRET))) {
    return unauthorized()
  }

  if (pathname === '/api/storage-check') {
    return handleStorageCheck(request, env)
  }
  if (pathname === '/api/encryption-check') {
    return handleEncryptionCheck(request, env)
  }
  if (pathname === '/api/audio') {
    return handleAudio(request, env)
  }
  const audioMatch = pathname.match(/^\/api\/audio\/([^/]+)$/u)
  if (audioMatch) {
    return handleAudio(request, env, audioMatch[1])
  }

  return jsonResponse({ error: 'Not Found' }, { status: 404 })
}

function withSecurityHeaders(response: Response): Response {
  const secured = new Response(response.body, response)
  secured.headers.set('X-Content-Type-Options', 'nosniff')
  secured.headers.set('Referrer-Policy', 'no-referrer')
  secured.headers.set('X-Frame-Options', 'DENY')
  secured.headers.set(
    'Permissions-Policy',
    'camera=(), geolocation=(), microphone=()',
  )
  return secured
}

export default {
  async fetch(request, env): Promise<Response> {
    const pathname = new URL(request.url).pathname
    const response = pathname.startsWith('/api/')
      ? await handleApi(request, env)
      : await env.ASSETS.fetch(request)

    return withSecurityHeaders(response)
  },
} satisfies ExportedHandler<AppEnv>
