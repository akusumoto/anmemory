import { pbkdf2Sync, randomBytes } from 'node:crypto'

const ITERATIONS = 600_000

function readHidden(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('This command must be run in an interactive terminal.')
  }

  process.stdout.write(prompt)
  process.stdin.setEncoding('utf8')
  process.stdin.setRawMode(true)
  process.stdin.resume()

  return new Promise((resolve, reject) => {
    let value = ''

    function finish() {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdin.off('data', onData)
      process.stdout.write('\n')
    }

    function onData(chunk) {
      for (const character of chunk) {
        if (character === '\u0003') {
          finish()
          reject(new Error('Cancelled.'))
          return
        }
        if (character === '\r' || character === '\n') {
          finish()
          resolve(value)
          return
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1)
          continue
        }
        if (character >= ' ') {
          value += character
        }
      }
    }

    process.stdin.on('data', onData)
  })
}

function base64Url(bytes) {
  return Buffer.from(bytes).toString('base64url')
}

try {
  const password = await readHidden('Master password: ')
  const confirmation = await readHidden('Confirm password: ')

  if (!password) {
    throw new Error('Password must not be empty.')
  }
  if (password !== confirmation) {
    throw new Error('Passwords do not match.')
  }

  const salt = randomBytes(16)
  const hash = pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256')
  const verifier = `pbkdf2-sha256$${ITERATIONS}$${base64Url(salt)}$${base64Url(hash)}`

  process.stdout.write('\nStore these values as Cloudflare Workers Secrets.\n\n')
  process.stdout.write(`MASTER_PASSWORD_VERIFIER=${verifier}\n`)
  process.stdout.write(`SESSION_SECRET=${base64Url(randomBytes(32))}\n`)
  process.stdout.write(`ENCRYPTION_KEY=${base64Url(randomBytes(32))}\n`)
} catch (error) {
  const message = error instanceof Error ? error.message : 'Secret generation failed.'
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
}
