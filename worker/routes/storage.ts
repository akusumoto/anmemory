import type { AppEnv } from '../env.ts'
import { jsonResponse, methodNotAllowed } from '../http.ts'
import { runStorageCheck } from '../r2.ts'

export async function handleStorageCheck(
  request: Request,
  env: AppEnv,
): Promise<Response> {
  if (request.method !== 'POST') {
    return methodNotAllowed('POST')
  }

  try {
    await runStorageCheck(env.AUDIO_BUCKET)
    return jsonResponse({
      ok: true,
      checkedAt: new Date().toISOString(),
    })
  } catch {
    return jsonResponse({ error: 'Storage unavailable' }, { status: 503 })
  }
}
