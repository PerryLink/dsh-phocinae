// _pubcheck.mjs — publish with full verbose output and poll the registry.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const TOKEN_FILE = 'D:/Projects/dsh/plugins/发布令牌.md'
const B = '`'
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))

function grab(label) {
  const text = fs.readFileSync(TOKEN_FILE, 'utf8')
  const re = new RegExp(label + '[^' + B + ']*' + B + '([^' + B + ']+)' + B)
  return text.match(re)[1].trim()
}
const token = grab('npm token')
const redact = (s) => String(s ?? '').split(token).join('<redacted>')
  .split(encodeURIComponent(token)).join('<redacted>')

const rc = path.join(os.tmpdir(), `pubcheck-${process.pid}`)
fs.writeFileSync(rc, `registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken=${token}\n`)

const run = (args) => spawnSync('npm', ['--userconfig', rc, ...args],
  { encoding: 'utf8', shell: process.platform === 'win32' })

console.log('--- npm publish --dry-run (local only) ---')
const dry = run(['publish', '--access', 'public', '--ignore-scripts', '--dry-run'])
console.log('status:', dry.status)
console.log(redact(dry.stdout).slice(-1200))
console.log(redact(dry.stderr).slice(-1200))

console.log('\n--- npm publish (verbose) ---')
const pub = run(['publish', '--access', 'public', '--ignore-scripts', '--loglevel', 'verbose'])
console.log('status:', pub.status)
console.log(redact(pub.stdout).slice(-2000))
console.log('STDERR:')
console.log(redact(pub.stderr).slice(-2000))

fs.rmSync(rc, { force: true })

console.log('\n--- registry poll ---')
for (let attempt = 1; attempt <= 6; attempt += 1) {
  const res = await fetch('https://registry.npmjs.org/dsh-phocinae')
  const data = await res.json()
  const present = Boolean(data.versions?.[pkg.version])
  console.log(`attempt ${attempt}: latest=${data['dist-tags']?.latest} has ${pkg.version}=${present}`)
  if (present) break
  await new Promise((resolve) => setTimeout(resolve, 5000))
}
