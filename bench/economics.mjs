/**
 * Token economics of dsh-phocinae 0.2.1, combining the two measured halves:
 *
 *   - `token-savings.mjs`  what a large-model decision costs, and what the
 *                          escalation gate saves by not making it;
 *   - `context-cost.mjs`   what the plugin itself costs in context and latency.
 *
 * The plugin's own cost is the part that is easy to get wrong. A local decision
 * is not free: the two tool definitions ride in every request, the call arguments
 * enter the transcript, and the rendered result comes back into it. What it is,
 * is roughly an order of magnitude cheaper than the call it replaces — and the
 * fixed part amortises across every decision in a session.
 *
 * Usage: node bench/economics.mjs [--out bench/results/economics.json]
 * Requires both input files to exist.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.dirname(HERE)

function flag(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}
const SAVINGS = flag('savings', path.join(REPO, 'bench/results/token-savings-en.json'))
const COST = flag('cost', path.join(REPO, 'bench/results/context-cost.json'))
const OUT = flag('out', 'bench/results/economics.json')

const savings = JSON.parse(fs.readFileSync(SAVINGS, 'utf8'))
const cost = JSON.parse(fs.readFileSync(COST, 'utf8'))

const perCaseLlm = savings.perCaseTokens
const fixed = cost.tokensPerRequest.askToolDefinition + cost.tokensPerRequest.gateToolDefinition
const perCall = cost.tokensPerRequest.oneCallArguments + cost.tokensPerRequest.oneCallResult

/** Token cost of answering `n` decisions locally, including the plugin's overhead. */
const localCost = (n) => fixed + n * perCall
/** Token cost of answering `n` decisions with the large model. */
const llmCost = (n) => n * perCaseLlm

console.log('measured inputs')
console.log(`  large-model cost per case      ${perCaseLlm.toFixed(1)} tokens`)
console.log(`  plugin fixed overhead          ${fixed} tokens per request`)
console.log(`  local call arguments + result  ${perCall} tokens per decision`)
console.log(`  local round trip               ${cost.localDecision.roundTripMs} ms`)
console.log(`  gate, screened command         ${cost.gate.screenedMeanMs} ms, 0 conversation tokens`)
console.log(`  gate, allow-listed command     ${cost.gate.autoAllowedMs} ms, 0 conversation tokens`)

console.log('\nbreak-even and amortisation (local path vs large-model path)')
console.log('  decisions   local      large-model   local share   token saving')
const rows = []
for (const n of [1, 5, 10, 25, 50, 100, 1000]) {
  const local = localCost(n)
  const llm = llmCost(n)
  const share = local / llm
  const saving = 1 - share
  rows.push({ decisions: n, local: Math.round(local), largeModel: Math.round(llm),
    localShare: share, tokenSaving: saving })
  console.log(`  ${String(n).padStart(9)} ${local.toFixed(0).padStart(8)} ` +
    `${llm.toFixed(0).padStart(13)} ${(share * 100).toFixed(1).padStart(12)}% ` +
    `${(saving * 100).toFixed(1).padStart(12)}%`)
}

// Where does the local path stop being cheaper?
let breakEven = null
for (let n = 1; n <= 20; n += 1) {
  if (localCost(n) < llmCost(n)) { breakEven = n; break }
}

// Hybrid: escalate the cases the gate is unsure about, keep the rest local.
const hybrid = {}
for (const [name, strategy] of Object.entries(savings.strategies)) {
  if (!name.startsWith('hybrid')) continue
  const escalated = strategy.llmCalls
  const kept = savings.rows - escalated
  // Kept cases pay the plugin overhead; escalated cases pay it AND the call.
  const tokens = localCost(kept) + escalated * perCaseLlm
  hybrid[name] = {
    ...strategy,
    pluginOverheadTokens: Math.round(localCost(kept)),
    totalTokensWithOverhead: Math.round(tokens),
    savingWithOverhead: 1 - tokens / llmCost(savings.rows),
  }
}

console.log('\nhybrid strategies, with the plugin\'s own cost included')
console.log('  strategy          escalated  accuracy   saving (model only)   saving (with overhead)')
for (const [name, h] of Object.entries(hybrid)) {
  console.log(`  ${name.replace('hybrid-', '').padEnd(16)} ` +
    `${(h.escalationRate * 100).toFixed(1).padStart(8)}% ` +
    `${h.accuracy.toFixed(4).padStart(9)} ` +
    `${(h.savings * 100).toFixed(1).padStart(19)}% ` +
    `${(h.savingWithOverhead * 100).toFixed(1).padStart(22)}%`)
}

const summary = {
  inputs: { perCaseLlm, fixed, perCall, rows: savings.rows, decisions: savings.decisions },
  accuracy: {
    local: savings.localAccuracy,
    largeModel: savings.llmAccuracy,
    agreement: savings.agreement,
  },
  latencyMs: {
    localDecision: cost.localDecision.roundTripMs,
    gateScreened: cost.gate.screenedMeanMs,
    gateAllowListed: cost.gate.autoAllowedMs,
  },
  amortisation: rows,
  breakEvenDecisions: breakEven,
  hybrid,
  strategies: savings.strategies,
}

const outPath = path.isAbsolute(OUT) ? OUT : path.join(REPO, OUT)
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 1)}\n`, 'utf8')
console.log(`\nwrote ${outPath}`)
