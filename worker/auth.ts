import { constantTimeEqual, decodeBase64Url } from './encoding.ts'

const MIN_ITERATIONS = 100_000
// Keep this aligned with the maximum accepted by the Workers runtime.
const MAX_ITERATIONS = 100_000
const MIN_SALT_BYTES = 16
const EXPECTED_HASH_BYTES = 32

interface PasswordVerifier {
  iterations: number
  salt: Uint8Array
  hash: Uint8Array
}

function parsePasswordVerifier(value: string): PasswordVerifier {
  const [algorithm, rawIterations, rawSalt, rawHash, extra] = value.split('$')
  const iterations = Number(rawIterations)
  const salt = decodeBase64Url(rawSalt ?? '')
  const hash = decodeBase64Url(rawHash ?? '')

  if (
    algorithm !== 'pbkdf2-sha256' ||
    extra !== undefined ||
    !Number.isSafeInteger(iterations) ||
    iterations < MIN_ITERATIONS ||
    iterations > MAX_ITERATIONS ||
    salt.length < MIN_SALT_BYTES ||
    hash.length !== EXPECTED_HASH_BYTES
  ) {
    throw new Error('Invalid MASTER_PASSWORD_VERIFIER')
  }

  return { iterations, salt, hash }
}

export async function verifyPassword(
  password: string,
  encodedVerifier: string,
): Promise<boolean> {
  const verifier = parsePasswordVerifier(encodedVerifier)
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: verifier.salt,
      iterations: verifier.iterations,
    },
    passwordKey,
    EXPECTED_HASH_BYTES * 8,
  )

  return constantTimeEqual(new Uint8Array(derivedBits), verifier.hash)
}
