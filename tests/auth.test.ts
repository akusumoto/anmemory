import assert from 'node:assert/strict'
import { test } from 'node:test'
import { verifyPassword } from '../worker/auth.ts'
import { encodeBase64Url } from '../worker/encoding.ts'

async function createVerifier(password: string): Promise<string> {
  const salt = new Uint8Array(16).fill(7)
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const iterations = 100_000
  const hash = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  )
  return `pbkdf2-sha256$${iterations}$${encodeBase64Url(salt)}$${encodeBase64Url(new Uint8Array(hash))}`
}

test('PBKDF2 verifier accepts only the correct password', async () => {
  const verifier = await createVerifier('correct horse battery staple')
  assert.equal(
    await verifyPassword('correct horse battery staple', verifier),
    true,
  )
  assert.equal(await verifyPassword('incorrect', verifier), false)
})

test('malformed verifier is rejected', async () => {
  await assert.rejects(() => verifyPassword('password', 'not-a-verifier'))
})
