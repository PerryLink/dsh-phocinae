/**
 * Gate quality by mode, through the plugin's real gate.
 *
 * `gate-bench.mjs` speaks the protocol directly and covers the tri-state and
 * noul question shapes. This measures what the plugin actually ships — the
 * `harm` scale, `gate.minConfidence`, and the auto-allow list — by calling
 * `decideToolCall` from `lib/guard.mjs`, so the numbers describe the installed
 * product rather than a re-implementation of it.
 *
 * Usage: node bench/gate-by-mode.mjs [--out bench/results/gate-by-mode.json]
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.dirname(HERE)

function flag(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}
const OUT = flag('out', 'bench/results/gate-by-mode.json')
const PHOC = flag('phoc', 'http://127.0.0.1:8155/v1/systemone')

const cases = JSON.parse(fs.readFileSync(path.join(HERE, 'cases.json'), 'utf8'))
const { decideToolCall } = await import(pathToFileURL(path.join(REPO, 'lib/guard.mjs')).href)
const { resolveConfig } = await import(pathToFileURL(path.join(REPO, 'lib/config.mjs')).href)

async function run(label, config) {
  const rows = []
  for (const item of cases) {
    const started = performance.now()
    const verdict = await decideToolCall({
      toolName: 'pwsh',
      toolInput: { command: item.command },
      platform: 'win32',
      cwd: 'D:\\Projects',
    }, config)
    rows.push({
      label: item.label,
      command: item.command,
      decision: verdict.decision,
      reason: verdict.reason,
      confidence: verdict.confidence ?? null,
      ms: performance.now() - started,
      // "flagged" = the gate did not let it run
      flagged: verdict.decision !== 'allow',
    })
  }
  const tp = rows.filter((r) => r.label && r.flagged).length
  const fn = rows.filter((r) => r.label && !r.flagged).length
  const fp = rows.filter((r) => !r.label && r.flagged).length
  const tn = rows.filter((r) => !r.label && !r.flagged).length
  const local = rows.filter((r) => r.decision === 'allow' &&
    /auto-allow/.test(r.reason)).length
  return {
    label,
    n: rows.length,
    recall: tp / (tp + fn),
    specificity: tn / (tn + fp),
    agreement: (tp + tn) / rows.length,
    destructivePassed: fn,
    benignReviewed: fp,
    autoAllowed: local,
    meanMs: rows.reduce((sum, r) => sum + r.ms, 0) / rows.length,
    rows,
  }
}

const configs = [
  ['shipped default (harm + minConfidence 0.45 + auto-allow)',
    resolveConfig({ endpoint: PHOC, timeoutMs: 8000 })],
  ['harm, no auto-allow list',
    resolveConfig({ endpoint: PHOC, timeoutMs: 8000, gate: { autoAllow: [] } })],
  ['harm, auto-allow + minConfidence 0.6',
    resolveConfig({ endpoint: PHOC, timeoutMs: 8000, gate: { minConfidence: 0.6 } })],
  ['tri-state', resolveConfig({ endpoint: PHOC, timeoutMs: 8000, gate: { mode: 'tri-state' } })],
  ['noul (what 0.1.2 shipped)', resolveConfig({ endpoint: PHOC, timeoutMs: 8000, gate: { mode: 'noul' } })],
]

const results = []
for (const [label, config] of configs) {
  const result = await run(label, config)
  results.push(result)
  console.log(`\n=== ${label} ===`)
  console.log(`  destructive stopped   : ${result.recall.toFixed(4)}  ` +
    `(${result.n - result.destructivePassed}/${result.recall > 0
      ? Math.round(result.recall * (result.rows.filter((r) => r.label).length)) : 0} of ` +
    `${result.rows.filter((r) => r.label).length})`)
  console.log(`  destructive PASSED    : ${result.destructivePassed}`)
  console.log(`  benign sent to review : ${result.benignReviewed} of ` +
    `${result.rows.filter((r) => !r.label).length}`)
  console.log(`  benign auto-allowed   : ${result.autoAllowed}`)
  console.log(`  mean gate latency     : ${result.meanMs.toFixed(1)} ms`)
  for (const row of result.rows.filter((r) => r.label && !r.flagged)) {
    console.log(`    PASSED  conf=${(row.confidence ?? 0).toFixed(4)}  ${row.command.slice(0, 56)}`)
  }
}

const outPath = path.isAbsolute(OUT) ? OUT : path.join(REPO, OUT)
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, `${JSON.stringify(results, null, 1)}\n`, 'utf8')
console.log(`\nwrote ${outPath}`)
