import {
  constantTimeEqual,
  decodeBase64Url,
  encodeBase64Url,
} from './encoding.ts'

export const SESSION_COOKIE_NAME = '__Host-anmemory_session'
export const SESSION_MAX_AGE_SECONDS = 60 * 60

interface SessionPayload {
  exp: number
  v: 1
}

function getSigningKey(secret: string): Promise<CryptoKey> {
  const keyBytes = decodeBase64Url(secret)
  if (keyBytes.length < 32) {
    throw new Error('Invalid SESSION_SECRET')
  }

  return crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

async function sign(value: string, secret: string): Promise<Uint8Array> {
  const key = await getSigningKey(secret)
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(value),
  )
  return new Uint8Array(signature)
}

export async function createSessionToken(
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const payload: SessionPayload = {
    exp: nowSeconds + SESSION_MAX_AGE_SECONDS,
    v: 1,
  }
  const encodedPayload = encodeBase64Url(
    new TextEncoder().encode(JSON.stringify(payload)),
  )
  const signature = await sign(encodedPayload, secret)
  return `${encodedPayload}.${encodeBase64Url(signature)}`
}

export async function verifySessionToken(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  try {
    const [encodedPayload, encodedSignature, extra] = token.split('.')
    if (!encodedPayload || !encodedSignature || extra !== undefined) {
      return false
    }

    const expectedSignature = await sign(encodedPayload, secret)
    const receivedSignature = decodeBase64Url(encodedSignature)
    if (!constantTimeEqual(expectedSignature, receivedSignature)) {
      return false
    }

    const payload = JSON.parse(
      new TextDecoder().decode(decodeBase64Url(encodedPayload)),
    ) as Partial<SessionPayload>

    return (
      payload.v === 1 &&
      Number.isSafeInteger(payload.exp) &&
      typeof payload.exp === 'number' &&
      payload.exp > nowSeconds
    )
  } catch {
    return false
  }
}

export function readSessionCookie(request: Request): string | null {
  const cookieHeader = request.headers.get('Cookie')
  if (!cookieHeader) {
    return null
  }

  for (const part of cookieHeader.split(';')) {
    const separatorIndex = part.indexOf('=')
    if (separatorIndex === -1) {
      continue
    }

    const name = part.slice(0, separatorIndex).trim()
    if (name === SESSION_COOKIE_NAME) {
      return part.slice(separatorIndex + 1).trim()
    }
  }
  return null
}

export async function isAuthenticated(
  request: Request,
  secret: string,
): Promise<boolean> {
  const token = readSessionCookie(request)
  return token ? verifySessionToken(token, secret) : false
}

export function createSessionCookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`
}
