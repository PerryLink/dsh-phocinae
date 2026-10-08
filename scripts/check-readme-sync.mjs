#!/usr/bin/env node
/**
 * README synchronisation check.
 *
 * The five README files are translations of one source, and the failure mode is
 * silent drift: a number changes in the English file and the four translations
 * keep advertising the old one. This script fails the build on the drift that
 * matters and reports the drift that does not.
 *
 * Checked:
 *   1. every translation exists and its language-switcher line is identical;
 *   2. every numeric literal in the English file appears in every translation;
 *   3. every identifier a reader might paste (config keys, tool names, event
 *      names, package name, file paths) appears in every translation;
 *   4. section headings are the same count and the same order;
 *   5. every translation ends with exactly one newline;
 *   6. STRUCTURAL parity — the same number of fenced code blocks, carrying the
 *      same languages in the same order, and the same number of table rows.
 *
 * Check 6 exists because checks 2-5 pass on a translation that is quietly
 * missing a whole code block: the identifiers it shares with the source are
 * still present somewhere in the prose, the heading count is unchanged, and
 * every literal the checker knows about still appears. A stale translation of
 * one subsection is exactly that shape, and one shipped.
 *
 * Usage: node scripts/check-readme-sync.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const SOURCE = 'README.md'
const TRANSLATIONS = ['README-zh.md', 'README-es.md', 'README-pt.md', 'README-hi.md']

const SWITCHER = '**English** · [中文](./README-zh.md) · [Español](./README-es.md) · '
  + '[Português](./README-pt.md) · [हिन्दी](./README-hi.md)'

const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

/** Tokens a reader copies verbatim; translation must not touch them. */
function identifiers(text) {
  const found = new Set()
  const patterns = [
    /`([a-z][A-Za-z0-9_]*(?:\.[a-z][A-Za-z0-9_]*)+)`/g,   // gate.autoAllow, tools/pre-execute
    /`(phocinae_[a-z_]+)`/g,                               // phocinae_ask, phocinae_gate
    /`(PHOCINAE_[A-Z_]+)`/g,                               // error codes
    /`(dsh-phocinae)`/g,
    /`([A-Za-z0-9_./-]+\.(?:mjs|md|json|yml|yaml|jsonl))`/g,
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) found.add(match[1])
  }
  return found
}

/** Numeric literals, normalised so 0.60 and 0.6 are not treated as equal. */
function numbers(text) {
  const found = new Set()
  // Ignore numbers inside URLs and inside link destinations.
  const stripped = text.replace(/\]\([^)]*\)/g, ']()').replace(/https?:\/\/\S+/g, '')
  for (const match of stripped.matchAll(/\b\d+(?:\.\d+)?%?/g)) found.add(match[0])
  return found
}

function headings(text) {
  return text.split('\n').filter((line) => /^#{1,6}\s/.test(line)).map((line) => line.trim())
}

/**
 * Structural profile of a README: fenced code blocks and table rows.
 *
 * Fence-aware on purpose — a shell comment inside a code block starts with `#`
 * and would otherwise be counted as a heading, which is how an earlier attempt
 * at this check reported phantom mismatches.
 */
function structure(text) {
  let insideFence = false
  let blocks = 0
  let rows = 0
  const langs = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('```')) {
      if (!insideFence) {
        blocks += 1
        langs.push(trimmed.slice(3).trim() || '(plain)')
      }
      insideFence = !insideFence
      continue
    }
    if (insideFence) continue
    if (trimmed.startsWith('|')) rows += 1
  }
  return { blocks, rows, langs }
}

let failures = 0
const fail = (message) => {
  failures += 1
  process.stderr.write(`✗ ${message}\n`)
}
const ok = (message) => process.stdout.write(`✓ ${message}\n`)

if (!fs.existsSync(path.join(root, SOURCE))) {
  fail(`${SOURCE} is missing`)
  process.exit(1)
}
const source = read(SOURCE)

// 1. switcher line
if (source.split('\n')[0] === SWITCHER) ok('source switcher line is canonical')
else fail(`${SOURCE}: first line is not the canonical language switcher`)

const sourceNumbers = numbers(source)
const sourceIds = identifiers(source)
const sourceHeadings = headings(source)
const sourceShape = structure(source)

for (const file of TRANSLATIONS) {
  const full = path.join(root, file)
  if (!fs.existsSync(full)) {
    fail(`${file} is missing`)
    continue
  }
  const text = read(file)

  if (text.split('\n')[0] !== SWITCHER) {
    fail(`${file}: first line is not the canonical language switcher`)
  }

  const missingNumbers = [...sourceNumbers].filter((n) => !text.includes(n))
  if (missingNumbers.length > 0) {
    fail(`${file}: numeric literals absent from the translation: ${missingNumbers.join(', ')}`)
  }

  const missingIds = [...sourceIds].filter((id) => !text.includes(id))
  if (missingIds.length > 0) {
    fail(`${file}: identifiers absent from the translation: ${missingIds.join(', ')}`)
  }

  const fileHeadings = headings(text)
  if (fileHeadings.length !== sourceHeadings.length) {
    fail(`${file}: ${fileHeadings.length} headings against ${sourceHeadings.length} in ${SOURCE}`)
  } else {
    // A translation may reword a heading; only the depth sequence must match.
    const depth = (list) => list.map((h) => h.match(/^#+/)[0]).join(' ')
    if (depth(fileHeadings) !== depth(sourceHeadings)) {
      fail(`${file}: heading structure differs from ${SOURCE}`)
    }
  }

  if (!text.endsWith('\n') || text.endsWith('\n\n')) {
    fail(`${file}: must end with exactly one newline`)
  }

  const fileShape = structure(text)
  if (fileShape.blocks !== sourceShape.blocks) {
    fail(`${file}: ${fileShape.blocks} code blocks against ${sourceShape.blocks} in ${SOURCE}` +
      ' — a whole block is missing or extra')
  }
  if (JSON.stringify(fileShape.langs) !== JSON.stringify(sourceShape.langs)) {
    fail(`${file}: code-block languages differ from ${SOURCE}\n` +
      `    source      : ${sourceShape.langs.join(', ')}\n` +
      `    translation : ${fileShape.langs.join(', ')}`)
  }
  if (fileShape.rows !== sourceShape.rows) {
    fail(`${file}: ${fileShape.rows} table rows against ${sourceShape.rows} in ${SOURCE}`)
  }

  if (failures === 0) ok(`${file} is in sync`)
}

if (failures > 0) {
  process.stderr.write(`\n${failures} problem(s). Update every README in the same commit.\n`)
  process.exit(1)
}
process.stdout.write('\nAll README files are in sync.\n')
