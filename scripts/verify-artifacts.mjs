#!/usr/bin/env node
/**
 * Pre-publish artifact check.
 *
 * `npm pack --dry-run` says what would ship; this says whether what ships is
 * actually usable. It reads the packed file list from npm and asserts the
 * things that have broken this family of plugins before:
 *
 *   - every module `index.mjs` imports is inside the tarball (a missing `files`
 *     entry produces a package that installs and then fails to import);
 *   - `package.json` declares the bundle patch and the entry point;
 *   - no credential-shaped string, local absolute path, or `node_modules`
 *     reference is in the published files;
 *   - the version is not already on the registry.
 *
 * Usage: node scripts/verify-artifacts.mjs [--allow-published]
 */
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const allowPublished = process.argv.includes('--allow-published')

let failures = 0
const fail = (message) => {
  failures += 1
  process.stderr.write(`✗ ${message}\n`)
}
const ok = (message) => process.stdout.write(`✓ ${message}\n`)

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

// --- manifest sanity -------------------------------------------------------
if (pkg.dsh?.bundle?.patch === './cordis.patch.yml') ok('dsh.bundle.patch is declared')
else fail('package.json: dsh.bundle.patch is missing or wrong')

if (pkg.main === './index.mjs' && pkg.exports?.['.']?.default === './index.mjs') {
  ok('entry point is declared')
} else {
  fail('package.json: main/exports do not point at ./index.mjs')
}

if (pkg.engines?.node && pkg.engines?.dsh) ok('engines declare both node and dsh ranges')
else fail('package.json: engines must declare a node range and a dsh range')

// --- every relative import is inside `files` -------------------------------
const files = new Set(pkg.files ?? [])
const bundled = (relative) => {
  const top = relative.split('/')[0]
  return files.has(relative) || files.has(top)
}

const queue = ['index.mjs']
const seen = new Set()
const entryPoints = []
while (queue.length > 0) {
  const relative = queue.shift()
  if (seen.has(relative)) continue
  seen.add(relative)
  const full = path.join(root, relative)
  if (!fs.existsSync(full)) {
    fail(`${relative} is imported but does not exist`)
    continue
  }
  if (!bundled(relative)) {
    fail(`${relative} is imported but not covered by package.json "files"`)
  }
  entryPoints.push(relative)
  const source = fs.readFileSync(full, 'utf8')
  for (const match of source.matchAll(/from\s+'(\.[^']+)'/g)) {
    queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(relative), match[1])))
  }
}
ok(`${entryPoints.length} module(s) reachable from the entry point, all bundled`)

// --- the shipped cordis patch must reference this package ------------------
const patch = fs.readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8')
if (patch.includes(`name: ${pkg.name}`)) ok('cordis.patch.yml mounts the published package name')
else fail(`cordis.patch.yml does not reference ${pkg.name}`)

// --- nothing secret, local, or stale in the published files ----------------
const SECRET = /(ghp_[A-Za-z0-9]{20,}|npm_[A-Za-z0-9]{20,}|hf_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})/
const LOCAL_PATH = /[A-Za-z]:\\Users\\|\/Users\/[a-z]|_phocinae/
const scanned = []
for (const file of entryPoints) scanned.push(file)
scanned.push('cordis.patch.yml', 'package.json')
for (const file of ['README.md', 'ARCHITECTURE.md', 'SECURITY.md', 'CHANGELOG.md']) {
  if (fs.existsSync(path.join(root, file))) scanned.push(file)
}
for (const file of new Set(scanned)) {
  const text = fs.readFileSync(path.join(root, file), 'utf8')
  if (SECRET.test(text)) fail(`${file}: contains a credential-shaped string`)
  if (LOCAL_PATH.test(text)) fail(`${file}: contains a machine-specific local path`)
}
ok(`${new Set(scanned).size} file(s) free of credentials and local paths`)

// --- what npm would actually ship -----------------------------------------
// Not `--json`, and not stdout: npm writes the notice block to stderr, and the
// `prepack` script runs `npm test` whose TAP output lands on stdout. The
// "npm notice <size> <path>" lines inside the Tarball Contents block are the
// stable thing to read.
let shipped = []
{
  // spawnSync, not execFileSync: the notice block is on stderr and
  // execFileSync's return value only carries stdout.
  const result = spawnSync('npm', ['pack', '--dry-run'], {
    cwd: root, encoding: 'utf8', shell: process.platform === 'win32',
  })
  shipped = parsePackList(`${result.stdout ?? ''}\n${result.stderr ?? ''}`)
  if (shipped.length === 0) {
    fail(`could not read the npm pack file list (exit ${result.status}: ` +
      `${(result.stderr ?? '').split('\n').slice(0, 3).join(' ').trim()})`)
  }
}

/** Pull the file list out of an `npm pack` notice block. */
function parsePackList(text) {
  const lines = String(text).split('\n')
  const start = lines.findIndex((line) => /npm notice\s+Tarball Contents/.test(line))
  if (start === -1) return []
  const out = []
  for (const line of lines.slice(start + 1)) {
    const match = line.match(/^npm notice\s+(.+)$/)
    if (!match) continue
    const entry = match[1].trim()
    if (/^(Tarball Details|package size:|unpacked size:|shasum:|integrity:|filename:|name:|version:|total files:)/.test(entry)) break
    // "7.6kB ARCHITECTURE.md" → "ARCHITECTURE.md"
    const file = entry.replace(/^[\d.]+\s?[kKMG]?B\s+/, '').trim()
    if (file !== '') out.push(file)
  }
  return out
}
if (shipped.length > 0) {
  for (const needed of ['index.mjs', 'tools.mjs', 'package.json', 'cordis.patch.yml',
    'README.md', 'LICENSE', 'ARCHITECTURE.md', 'SECURITY.md', 'CHANGELOG.md']) {
    if (!shipped.includes(needed)) fail(`npm would not ship ${needed}`)
  }
  if (shipped.some((f) => f.startsWith('node_modules/'))) fail('npm would ship node_modules')
  for (const file of shipped) {
    if (file.startsWith('test/') || file.startsWith('bench/') || file.startsWith('scripts/')) {
      fail(`${file} would ship; tests, benchmarks and scripts do not belong in the tarball`)
      break
    }
  }
  ok(`npm would ship ${shipped.length} file(s)`)
} else {
  fail('could not read the npm pack file list')
}

// --- registry state --------------------------------------------------------
let published = false
try {
  const out = execFileSync('npm', ['view', `${pkg.name}@${pkg.version}`, 'version'],
    { cwd: root, encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'ignore'] })
  published = out.trim() === pkg.version
} catch {
  published = false
}
if (published) {
  const message = `${pkg.name}@${pkg.version} is already on the registry`
  if (allowPublished) ok(`${message} (allowed)`)
  else fail(`${message}; bump the version or pass --allow-published`)
} else {
  ok(`${pkg.name}@${pkg.version} is not yet on the registry`)
}

if (failures > 0) {
  process.stderr.write(`\n${failures} problem(s); not ready to publish.\n`)
  process.exit(1)
}
process.stdout.write('\nArtifacts look publishable.\n')
