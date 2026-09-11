import assert from 'node:assert/strict'
import { test } from 'node:test'
import { encodeBase64Url } from '../worker/encoding.ts'
import {
  createSessionToken,
  SESSION_MAX_AGE_SECONDS,
  verifySessionToken,
} from '../worker/session.ts'

const secret = encodeBase64Url(new Uint8Array(32).fill(11))

test('session remains valid until its one-hour expiration', async () => {
  const issuedAt = 2_000_000_000
  const token = await createSessionToken(secret, issuedAt)

  assert.equal(await verifySessionToken(token, secret, issuedAt), true)
  assert.equal(
    await verifySessionToken(token, secret, issuedAt + SESSION_MAX_AGE_SECONDS),
    false,
  )
})

test('session rejects a modified signature', async () => {
  const token = await createSessionToken(secret)
  const modified = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`
  assert.equal(await verifySessionToken(modified, secret), false)
})
