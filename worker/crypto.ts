import { decodeBase64Url } from './encoding.ts'

const AES_KEY_BYTES = 32
export const AES_GCM_IV_BYTES = 12
const AES_GCM_TAG_LENGTH = 128
const textEncoder = new TextEncoder()

export type EncryptionPurpose = 'audio' | 'metadata' | 'file-key'

function additionalData(purpose: EncryptionPurpose): Uint8Array {
  return textEncoder.encode(`anmemory:v1:${purpose}`)
}

export function randomIv(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES))
}

export async function importMasterKey(secret: string): Promise<CryptoKey> {
  const bytes = decodeBase64Url(secret)
  if (bytes.length !== AES_KEY_BYTES) {
    throw new Error('Invalid ENCRYPTION_KEY')
  }

  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, [
    'wrapKey',
    'unwrapKey',
  ])
}

export async function generateFileKey(): Promise<CryptoKey> {
  return (await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  )) as CryptoKey
}

export async function encryptBytes(
  plaintext: Uint8Array,
  key: CryptoKey,
  iv: Uint8Array,
  purpose: Exclude<EncryptionPurpose, 'file-key'>,
): Promise<Uint8Array> {
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: additionalData(purpose),
      tagLength: AES_GCM_TAG_LENGTH,
    },
    key,
    plaintext,
  )
  return new Uint8Array(ciphertext)
}

export async function decryptBytes(
  ciphertext: Uint8Array,
  key: CryptoKey,
  iv: Uint8Array,
  purpose: Exclude<EncryptionPurpose, 'file-key'>,
): Promise<Uint8Array> {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: additionalData(purpose),
      tagLength: AES_GCM_TAG_LENGTH,
    },
    key,
    ciphertext,
  )
  return new Uint8Array(plaintext)
}

export async function wrapFileKey(
  fileKey: CryptoKey,
  masterKey: CryptoKey,
  iv: Uint8Array,
): Promise<Uint8Array> {
  const wrapped = await crypto.subtle.wrapKey('raw', fileKey, masterKey, {
    name: 'AES-GCM',
    iv,
    additionalData: additionalData('file-key'),
    tagLength: AES_GCM_TAG_LENGTH,
  })
  return new Uint8Array(wrapped)
}

export async function unwrapFileKey(
  wrappedKey: Uint8Array,
  masterKey: CryptoKey,
  iv: Uint8Array,
): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey(
    'raw',
    wrappedKey,
    masterKey,
    {
      name: 'AES-GCM',
      iv,
      additionalData: additionalData('file-key'),
      tagLength: AES_GCM_TAG_LENGTH,
    },
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}
