/**
 * Latency benchmark, at the granularity the model release publishes.
 *
 * The updated upstream README claims "CPU single-thread p50 1.51 s per case
 * (1 case = 1 state + 5 questions ... ≈0.28 s per decision)". This measures that
 * claim on the same shape: the published 400-case row set, five questions per
 * case, one request per case, reporting p50/p90 per case and per decision.
 *
 * Run it twice against differently configured servers to compare thread counts:
 *   PHOC_THREADS=1  python -m phocinae.main   -> single-thread claim
 *   (unset)         python -m phocinae.main   -> default torch threading
 *
 * Usage: node bench/latency.mjs [--cases 40] [--out bench/results/latency.json]
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
const CASES = Number(flag('cases', '40'))
const PHOC = flag('phoc', 'http://127.0.0.1:8155/v1/systemone')
const LABEL = flag('label', 'default-threads')
const OUT = flag('out', 'bench/results/latency.json')

const data = fs.readFileSync(path.join(HERE, 'data', 'test_typed_400.jsonl'), 'utf8')

function buildQuestions(row) {
  const specs = []
  for (const [qid, qdef] of Object.entries(row.questions)) {
    const criteria = qdef.criteria
    const options = qdef.options
    if (qdef.type === 'score' && Array.isArray(criteria) && criteria.length > 0) {
      specs.push({ id: qid, type: 'choice', options: criteria.map((t, i) => `${i}: ${t}`) })
      continue
    }
    const spec = { id: qid, type: qdef.type }
    if (qdef.type === 'noul') {
      spec.options = (criteria && typeof criteria === 'object')
        ? Object.entries(criteria).map(([k, v]) => `${k}: ${v}`) : options
    } else if (qdef.type === 'choice') {
      spec.options = (criteria && typeof criteria === 'object' && Array.isArray(options))
        ? options.map((o) => (o in criteria ? `${o}: ${criteria[o]}` : o)) : options
    }
    specs.push(spec)
  }
  return specs
}

const rows = []
for (const line of data.split('\n')) {
  if (!line.trim()) continue
  const row = JSON.parse(line)
  for (const key of ['state', 'questions']) {
    if (typeof row[key] === 'string') row[key] = JSON.parse(row[key])
  }
  rows.push(row)
  if (rows.length >= CASES) break
}

const health = await (await fetch('http://127.0.0.1:8155/health')).json()
console.log(`server: ${health.model} on ${health.device} | label=${LABEL}`)
console.log(`cases : ${rows.length} (5 questions each, one request per case)`)

// Warm up so the first measurement is not the one that pays for lazy paths.
for (const row of rows.slice(0, 3)) {
  await fetch(PHOC, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'Phocinae-Largha-150M-v1',
      state: JSON.stringify(row.state), questions: buildQuestions(row) }),
  })
}

const perCase = []
let decisions = 0
for (const row of rows) {
  const specs = buildQuestions(row)
  const started = performance.now()
  const response = await fetch(PHOC, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'Phocinae-Largha-150M-v1',
      state: JSON.stringify(row.state), questions: specs }),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const payload = await response.json()
  perCase.push(performance.now() - started)
  decisions += Object.keys(payload.answers ?? {}).length
}

perCase.sort((a, b) => a - b)
const pick = (q) => perCase[Math.min(perCase.length - 1, Math.floor(q * perCase.length))]
const mean = perCase.reduce((a, b) => a + b, 0) / perCase.length

const summary = {
  label: LABEL,
  device: health.device,
  cases: rows.length,
  decisions,
  perCaseMs: {
    mean: Number(mean.toFixed(1)),
    p50: Number(pick(0.5).toFixed(1)),
    p90: Number(pick(0.9).toFixed(1)),
    min: Number(perCase[0].toFixed(1)),
    max: Number(perCase[perCase.length - 1].toFixed(1)),
  },
  perDecisionMs: Number((mean / (decisions / rows.length)).toFixed(1)),
  casesPerSecond: Number((1000 / mean).toFixed(2)),
}

console.log(`\nper case      mean ${summary.perCaseMs.mean} ms | p50 ${summary.perCaseMs.p50} ms | ` +
  `p90 ${summary.perCaseMs.p90} ms | min ${summary.perCaseMs.min} | max ${summary.perCaseMs.max}`)
console.log(`per decision  ${summary.perDecisionMs} ms`)
console.log(`throughput    ${summary.casesPerSecond} cases/s`)

const outPath = path.isAbsolute(OUT) ? OUT : path.join(REPO, OUT)
fs.mkdirSync(path.dirname(outPath), { recursive: true })
let existing = []
if (fs.existsSync(outPath)) {
  try { existing = JSON.parse(fs.readFileSync(outPath, 'utf8')) } catch { existing = [] }
  if (!Array.isArray(existing)) existing = [existing]
}
existing = existing.filter((entry) => entry.label !== LABEL)
existing.push(summary)
fs.writeFileSync(outPath, `${JSON.stringify(existing, null, 1)}\n`, 'utf8')
console.log(`\nwrote ${outPath}`)
