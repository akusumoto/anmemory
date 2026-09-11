import type { AppEnv } from '../env.ts'
import { jsonResponse, methodNotAllowed } from '../http.ts'
import { isAuthenticated } from '../session.ts'

export async function handleSession(
  request: Request,
  env: AppEnv,
): Promise<Response> {
  if (request.method !== 'GET') {
    return methodNotAllowed('GET')
  }

  return jsonResponse({
    authenticated: await isAuthenticated(request, env.SESSION_SECRET),
  })
}
