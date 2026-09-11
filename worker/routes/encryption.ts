import type { AppEnv } from '../env.ts'
import { runEncryptionCheck } from '../encryption-check.ts'
import { jsonResponse, methodNotAllowed } from '../http.ts'

export async function handleEncryptionCheck(
  request: Request,
  env: AppEnv,
): Promise<Response> {
  if (request.method !== 'POST') {
    return methodNotAllowed('POST')
  }

  try {
    await runEncryptionCheck(env.AUDIO_BUCKET, env.ENCRYPTION_KEY)
    return jsonResponse({
      ok: true,
      checkedAt: new Date().toISOString(),
    })
  } catch {
    return jsonResponse({ error: 'Encryption check failed' }, { status: 503 })
  }
}
