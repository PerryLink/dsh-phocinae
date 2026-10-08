#!/usr/bin/env node
/**
 * Print one version's CHANGELOG section to stdout.
 *
 * The publish workflow uses this to build the GitHub Release body. A missing
 * section prints nothing and exits 0, so the workflow can fall back to generated
 * notes instead of failing after npm has already published.
 *
 * Usage: node scripts/changelog-section.mjs 0.2.0
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const version = process.argv[2]
if (!version) {
  process.stderr.write('usage: node scripts/changelog-section.mjs <version>\n')
  process.exit(2)
}

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')
const lines = changelog.split('\n')

// Match `## [0.2.0] — date`, `## [0.2.0]`, or `## 0.2.0`.
const heading = new RegExp(`^##\\s+\\[?${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]?(\\s|$)`)

let start = -1
for (const [index, line] of lines.entries()) {
  if (heading.test(line)) {
    start = index
    break
  }
}
if (start === -1) process.exit(0)

let end = lines.length
for (let index = start + 1; index < lines.length; index += 1) {
  if (/^##\s/.test(lines[index])) {
    end = index
    break
  }
}

// Drop the heading itself and trailing link-reference lines.
const body = lines.slice(start + 1, end).join('\n').trimEnd()
const reference = /^\[[^\]]+\]:\s/.test(body.split('\n').at(-1) ?? '')
process.stdout.write(`${reference ? body.split('\n').slice(0, -1).join('\n').trimEnd() : body}\n`)
