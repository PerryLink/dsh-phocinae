/**
 * Cross-checks and breakdowns for the token-savings result.
 *
 *  1. per-question-type accuracy, so a rendering artefact in one type cannot hide
 *     inside an aggregate;
 *  2. a live end-to-end pass through the plugin's real `phocinae_ask` tool —
 *     `tools.mjs` -> `lib/protocol.mjs` -> HTTP — rather than a hand-rolled
 *     request, so the numbers describe the shipped product;
 *  3. a dollar estimate at DeepSeek's published list prices.
 *
 * Usage: node bench/token-savings-detail.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.dirname(HERE)

const savings = JSON.parse(fs.readFileSync(
  path.join(REPO, 'bench/results/token-savings-en.json'), 'utf8'))
const economics = JSON.parse(fs.readFileSync(
  path.join(REPO, 'bench/results/economics.json'), 'utf8'))

// --- 1. per type ------------------------------------------------------------
const byType = new Map()
for (const d of savings.perDecision) {
  if (!byType.has(d.type)) byType.set(d.type, { n: 0, local: 0, llm: 0, missingLocal: 0, missingLlm: 0 })
  const bucket = byType.get(d.type)
  bucket.n += 1
  bucket.local += d.localOk ? 1 : 0
  bucket.llm += d.llmOk ? 1 : 0
  if (d.localAnswer === null) bucket.missingLocal += 1
  if (d.llmAnswer === null) bucket.missingLlm += 1
}
console.log('accuracy by question type (both engines saw identical questions)')
console.log('  type       n     local    large    unparsed local / large')
for (const [type, b] of byType) {
  console.log(`  ${type.padEnd(8)} ${String(b.n).padStart(4)}  ` +
    `${(b.local / b.n).toFixed(4)}  ${(b.llm / b.n).toFixed(4)}  ` +
    `${String(b.missingLocal).padStart(8)} / ${b.missingLlm}`)
}

// --- 2. confidence distribution --------------------------------------------
const confidences = savings.perDecision.map((d) => d.confidence).filter((c) => c !== null)
confidences.sort((a, b) => a - b)
const quantile = (q) => confidences[Math.min(confidences.length - 1,
  Math.floor(q * confidences.length))]
console.log('\nlocal confidence distribution')
console.log(`  n=${confidences.length}  min=${quantile(0).toFixed(3)}  ` +
  `p25=${quantile(0.25).toFixed(3)}  median=${quantile(0.5).toFixed(3)}  ` +
  `p75=${quantile(0.75).toFixed(3)}  p90=${quantile(0.9).toFixed(3)}  ` +
  `max=${confidences[quantilesafe()].toFixed(3)}`)
function quantilesafe() { return confidences.length - 1 }

// --- 3. does escalation help? ----------------------------------------------
console.log('\nwhen the local model was unsure, was the large model better?')
for (const tau of [0.4, 0.5, 0.6]) {
  const unsure = savings.perDecision.filter((d) => d.confidence === null || d.confidence < tau)
  const sure = savings.perDecision.filter((d) => d.confidence !== null && d.confidence >= tau)
  const unsureLocal = unsure.filter((d) => d.localOk).length / Math.max(1, unsure.length)
  const unsureLlm = unsure.filter((d) => d.llmOk).length / Math.max(1, unsure.length)
  const sureLocal = sure.filter((d) => d.localOk).length / Math.max(1, sure.length)
  const sureLlm = sure.filter((d) => d.llmOk).length / Math.max(1, sure.length)
  console.log(`  tau=${tau}  unsure n=${unsure.length}: local ${unsureLocal.toFixed(4)} ` +
    `vs large ${unsureLlm.toFixed(4)}  |  confident n=${sure.length}: ` +
    `local ${sureLocal.toFixed(4)} vs large ${sureLlm.toFixed(4)}`)
}

// --- 4. live pass through the real tool ------------------------------------
const { createTools } = await import(pathToFileURL(path.join(REPO, 'tools.mjs')).href)
const { resolveConfig } = await import(pathToFileURL(path.join(REPO, 'lib/config.mjs')).href)
const tools = createTools(resolveConfig({ endpoint: 'http://127.0.0.1:8155/v1/systemone',
  timeoutMs: 8000 }), undefined, { platform: 'win32', cwd: 'D:\\Projects' })
const ask = tools.find((t) => t.name === 'phocinae_ask')

const probes = [
  ['a routine decision', 'The agent restarted nginx after checking the logs and health is green.',
    [{ id: 'risk', type: 'noul', threshold: 0.8 }]],
  ['a choice', 'Stop the agent: it deleted a production database without approval.',
    [{ id: 'action', type: 'choice', options: ['allow', 'ask', 'deny'] }]],
  ['a score', 'The agent took eleven steps and completed the task with no tool errors.',
    [{ id: 'severity', type: 'score' }]],
]
console.log('\nlive pass through the shipped phocinae_ask tool')
for (const [label, state, questions] of probes) {
  const started = performance.now()
  const value = await ask.execute({ state, questions }, { signal: new AbortController().signal })
  const ms = performance.now() - started
  const rendered = ask.output.render({}, value)
  console.log(`  ${label.padEnd(20)} ${ms.toFixed(0).padStart(5)} ms  ` +
    `answers=${JSON.stringify(value.answers)}  ` +
    `conf=${JSON.stringify(value.confidence)}  escalate=${value.escalate}`)
  console.log(`    rendered: ${rendered[0].text.split('\n')[0].slice(0, 96)}`)
}

// --- 5. dollars -------------------------------------------------------------
// DeepSeek's published list prices per million tokens.
const PRICES = { deepseek_flash_in: 0.28, deepseek_flash_out: 1.10 }
const inTokens = savings.llmTokens.prompt
const outTokens = savings.llmTokens.completion
const fullCost = inTokens / 1e6 * PRICES.deepseek_flash_in
  + outTokens / 1e6 * PRICES.deepseek_flash_out
console.log('\ncost of the same 400 cases at list prices (deepseek-flash)')
console.log(`  large model        $${fullCost.toFixed(4)}  ` +
  `(${inTokens} in + ${outTokens} out tokens)`)
console.log(`  local + overhead   $0.0000  (no billed tokens; ` +
  `${economics.inputs.fixed} of the plugin's tokens ride the caller's own request)`)
for (const [name, h] of Object.entries(economics.hybrid)) {
  if (!['hybrid-tau-0.4', 'hybrid-tau-0.5', 'hybrid-tau-0.6'].includes(name)) continue
  const fraction = h.llmCalls / economics.inputs.rows
  console.log(`  ${name.padEnd(18)} $${(fullCost * fraction).toFixed(4)}  ` +
    `(${(h.savings * 100).toFixed(1)}% saved, accuracy ${h.accuracy.toFixed(4)})`)
}

const outPath = path.join(REPO, 'bench/results/token-savings-detail.json')
fs.writeFileSync(outPath, `${JSON.stringify({
  byType: Object.fromEntries([...byType].map(([k, v]) => [k, {
    ...v, localAccuracy: v.local / v.n, llmAccuracy: v.llm / v.n,
  }])),
  confidence: {
    n: confidences.length, min: quantile(0), p25: quantile(0.25), median: quantile(0.5),
    p75: quantile(0.75), p90: quantile(0.9), max: confidences[confidences.length - 1],
  },
  prices: PRICES, fullCostUsd: fullCost,
}, null, 1)}\n`, 'utf8')
console.log(`\nwrote ${outPath}`)
