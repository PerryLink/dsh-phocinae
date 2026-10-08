/**
 * Token-savings experiment for dsh-phocinae 0.2.1.
 *
 * Answers one question with measurements instead of arithmetic: when the
 * escalation signal this plugin produces actually drives a large-model call, what
 * does it save in tokens, and what does it cost in quality?
 *
 * The workload is the published typed-decisions row set — the same 400 cases the
 * model release benchmarks on, so the accuracy figures are comparable to the
 * numbers in the README. Each case carries a state and a handful of typed
 * questions; both engines answer the same questions against the same state.
 *
 * Three strategies, all measured on the same decisions:
 *
 *   LLM-ONLY       every case goes to the large model.
 *   LOCAL-ONLY     every case goes to the local Phocinae model.
 *   HYBRID(tau)    the local model answers; cases whose confidence falls below
 *                  tau are escalated to the large model. This is what the
 *                  plugin's `escalate` flag is for — the plugin produces the
 *                  signal, the caller spends the tokens.
 *
 * Token accounting is exact for the LLM side (the API reports `usage` on every
 * response) and zero by construction for the local side: the decision model runs
 * on this machine, so a local decision consumes no billed tokens at all. What is
 * *not* free is the plugin's context footprint, which is measured separately and
 * reported alongside.
 *
 * Usage:
 *   node bench/token-savings.mjs --rows 120 --out bench/results/token-savings.json
 *   node bench/token-savings.mjs --rows 400 --model deepseek-v4-pro
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.dirname(HERE)

// ------------------------------------------------------------------ arguments

function flag(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

const ROWS = Number(flag('rows', '120'))
const MODEL = flag('model', 'deepseek-flash')
// The published row set, vendored under bench/data so the suite runs offline.
// Point --dataset anywhere to measure your own workload instead.
const DATASET = flag('dataset', path.join(HERE, 'data', 'test_typed_400.jsonl'))
const OUT = flag('out', 'bench/results/token-savings.json')
const PHOC = flag('phoc', 'http://127.0.0.1:8155/v1/systemone')
const CREDENTIALS = flag('credentials', 'C:/Users/zzhdz/.dsh/.credentials.yaml')
const CONCURRENCY = Number(flag('concurrency', '4'))
const TAUS = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]

// --------------------------------------------------------------- credentials

function deepseekKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY
  const text = fs.readFileSync(CREDENTIALS, 'utf8')
  const match = text.match(/DEEPSEEK_API_KEY:\s*(\S+)/)
  if (!match) throw new Error(`no DEEPSEEK_API_KEY in ${CREDENTIALS}`)
  return match[1].trim()
}
const KEY = deepseekKey()

// -------------------------------------------------------------- the questions

/**
 * Render one case the way each engine needs to see it.
 *
 * `choice` and `noul` are easy: render criteria as "key: description", which is
 * the rendering the published numbers use.
 *
 * `score` is not. The dataset's score questions are a 0-based list of level
 * descriptions (four levels in practice), but `phocinae-server` ignores a score
 * question's options entirely and always asks for its own fixed 2..10 scale. The
 * only way to put a four-level question to it honestly is to ask it as a `choice`
 * over those four levels — the same answer space the LLM gets, so the two engines
 * are comparable and the labels line up without a rescaling guess.
 */
function buildLocalQuestions(row) {
  const specs = []
  for (const [qid, qdef] of Object.entries(row.questions)) {
    const criteria = qdef.criteria
    const options = qdef.options
    if (qdef.type === 'score' && Array.isArray(criteria) && criteria.length > 0) {
      specs.push({
        id: qid,
        type: 'choice',
        options: criteria.map((text, index) => `${index}: ${text}`),
      })
      continue
    }
    const spec = { id: qid, type: qdef.type }
    if (qdef.type === 'noul') {
      spec.options = (criteria && typeof criteria === 'object')
        ? Object.entries(criteria).map(([key, text]) => `${key}: ${text}`)
        : options
    } else if (qdef.type === 'choice') {
      spec.options = (criteria && typeof criteria === 'object' && Array.isArray(options))
        ? options.map((option) => (option in criteria ? `${option}: ${criteria[option]}` : option))
        : options
    }
    specs.push(spec)
  }
  return specs
}

/** The same questions, phrased for the large model, with the row's native types. */
function buildLlmQuestions(row) {
  const specs = []
  for (const [qid, qdef] of Object.entries(row.questions)) {
    const criteria = qdef.criteria
    const options = qdef.options
    if (qdef.type === 'score' && Array.isArray(criteria) && criteria.length > 0) {
      specs.push({
        id: qid,
        type: 'choice',
        options: criteria.map((text, index) => `${index}: ${text}`),
      })
      continue
    }
    const spec = { id: qid, type: qdef.type }
    if (qdef.type === 'noul') {
      spec.options = (criteria && typeof criteria === 'object')
        ? Object.entries(criteria).map(([key, text]) => `${key}: ${text}`)
        : options
    } else if (qdef.type === 'choice') {
      spec.options = (criteria && typeof criteria === 'object' && Array.isArray(options))
        ? options.map((option) => (option in criteria ? `${option}: ${criteria[option]}` : option))
        : options
    }
    specs.push(spec)
  }
  return specs
}

/** Collapse a model answer onto the row set's label space. */
function labelOf(spec, answer) {
  if (spec.type === 'choice') {
    if (typeof answer === 'number' && spec.options && spec.options[answer] !== undefined) {
      const option = String(spec.options[answer])
      return option.includes(':') ? option.split(':')[0].trim() : option
    }
    return String(answer)
  }
  if (spec.type === 'noul') {
    if (typeof answer === 'boolean') {
      if (spec.options && spec.options.length === 2) {
        const keys = spec.options.map((o) => String(o).split(':')[0].trim())
        if (keys[0] === 'false' && keys[1] === 'true') return answer ? 'true' : 'false'
      }
      return answer ? 'true' : 'false'
    }
    return String(answer)
  }
  if (spec.type === 'score' && typeof answer === 'number' && answer >= 2) return String(answer - 2)
  return String(answer)
}

// ------------------------------------------------------------------- the LLM

/** The instruction block. Identical for every case, so the prompt is honest. */
const LLM_SYSTEM = [
  'You are a decision engine. You are given a situation and a list of typed',
  'questions. Answer every question, using only the situation provided.',
  '',
  'Answer formats:',
  '- noul: true or false',
  '- choice: the 0-based index of the chosen option',
  '- score: an integer from 2 to 10',
  '',
  'Reply with JSON only, no prose: {"answers": {"<question id>": <answer>, ...}}',
].join('\n')

function llmUser(row, specs) {
  const lines = ['SITUATION:', JSON.stringify(row.state, null, 1), '', 'QUESTIONS:']
  for (const spec of specs) {
    const parts = [`- id=${spec.id} type=${spec.type}`]
    if (spec.options) {
      parts.push(`\n    options:\n${spec.options.map((o, i) => `      ${i}. ${o}`).join('\n')}`)
    }
    if (spec.criteria) {
      parts.push(`\n    levels (0-based):\n${spec.criteria.map((c, i) => `      ${i}. ${c}`).join('\n')}`)
    }
    lines.push(parts.join(''))
  }
  return lines.join('\n')
}

async function askLlm(row, specs, attempt = 1) {
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: LLM_SYSTEM },
      { role: 'user', content: llmUser(row, specs) },
    ],
    temperature: 0,
    response_format: { type: 'json_object' },
  }
  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const text = await response.text()
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 1500 * attempt))
      return askLlm(row, specs, attempt + 1)
    }
    throw new Error(`LLM HTTP ${response.status}: ${text.slice(0, 200)}`)
  }
  const payload = await response.json()
  const usage = payload.usage ?? {}
  let parsed = null
  try {
    parsed = JSON.parse(payload.choices[0].message.content)
  } catch {
    parsed = null
  }
  return {
    answers: parsed?.answers ?? null,
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    totalTokens: usage.total_tokens ?? 0,
  }
}

// ---------------------------------------------------------------- the local

async function askLocal(row, specs) {
  const body = { model: 'Phocinae-Largha-150M-v1', state: JSON.stringify(row.state), questions: specs }
  const response = await fetch(PHOC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`local HTTP ${response.status}: ${await response.text()}`)
  const payload = await response.json()
  return { answers: payload.answers, confidence: payload.answer_confidence ?? {} }
}

// ------------------------------------------------------------------- plumbing

const coerce = {
  noul: (raw) => {
    if (typeof raw === 'boolean') return raw
    if (raw === 'true') return true
    if (raw === 'false') return false
    return undefined
  },
  choice: (raw, spec) => {
    const index = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isInteger(index) || index < 0 || index >= (spec.options?.length ?? 0)) return undefined
    return index
  },
  score: (raw) => {
    const level = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isInteger(level) || level < 2 || level > 10) return undefined
    return level
  },
}

function loadRows() {
  const text = fs.readFileSync(DATASET, 'utf8')
  const rows = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const row = JSON.parse(line)
    for (const key of ['state', 'questions', 'gold']) {
      if (typeof row[key] === 'string') row[key] = JSON.parse(row[key])
    }
    rows.push(row)
  }
  return rows
}

/** Spread the sample across workflows so one family cannot dominate. */
function sample(rows, count) {
  if (count >= rows.length) return rows
  const byWorkflow = new Map()
  for (const row of rows) {
    const key = row.workflow ?? 'unknown'
    if (!byWorkflow.has(key)) byWorkflow.set(key, [])
    byWorkflow.get(key).push(row)
  }
  const families = [...byWorkflow.values()]
  const per = Math.floor(count / families.length)
  const picked = []
  for (const family of families) picked.push(...family.slice(0, per))
  let cursor = 0
  while (picked.length < count && cursor < rows.length) {
    if (!picked.includes(rows[cursor])) picked.push(rows[cursor])
    cursor += 1
  }
  return picked
}

async function pool(items, limit, worker) {
  const results = new Array(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next
      next += 1
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

// --------------------------------------------------------------------- main

const all = loadRows()
const rows = sample(all, ROWS)
console.log(`workload   : ${rows.length} cases from ${all.length} (${MODEL})`)
console.log(`local      : ${PHOC}`)

let done = 0
const records = await pool(rows, CONCURRENCY, async (row) => {
  const localSpecs = buildLocalQuestions(row)
  const llmSpecs = buildLlmQuestions(row)
  const gold = row.gold
  const state = JSON.stringify(row.state)

  let local
  let llm
  try {
    ;[local, llm] = await Promise.all([askLocal(row, localSpecs), askLlm(row, llmSpecs)])
  } catch (error) {
    console.log(`  ! ${row.id}: ${error.message}`)
    return null
  }

  done += 1
  if (done % 20 === 0) process.stdout.write(`  ... ${done}/${rows.length} cases\n`)

  const decisions = []
  for (const spec of localSpecs) {
    const g = gold[spec.id]
    if (!g) continue
    const localAnswer = coerce[spec.type](local.answers?.[spec.id], spec)
    const llmAnswer = coerce[spec.type]?.(llm.answers?.[spec.id], spec)
    const confidence = local.confidence?.[spec.id]
    const goldLabel = String(g.label)
    decisions.push({
      id: `${row.id}:${spec.id}`,
      type: spec.type,
      gold: goldLabel,
      localAnswer: localAnswer === undefined ? null : labelOf(spec, localAnswer),
      llmAnswer: llmAnswer === undefined ? null : labelOf(spec, llmAnswer),
      confidence: typeof confidence === 'number' ? confidence : null,
      localOk: localAnswer !== undefined && labelOf(spec, localAnswer) === goldLabel,
      llmOk: llmAnswer !== undefined && labelOf(spec, llmAnswer) === goldLabel,
    })
  }
  return { id: row.id, ok: state.length > 0, promptTokens: llm.promptTokens,
    completionTokens: llm.completionTokens, totalTokens: llm.totalTokens, decisions }
})

const usable = records.filter(Boolean)
const decisions = usable.flatMap((r) => r.decisions)
const llmTokens = {
  prompt: usable.reduce((sum, r) => sum + r.promptTokens, 0),
  completion: usable.reduce((sum, r) => sum + r.completionTokens, 0),
  total: usable.reduce((sum, r) => sum + r.totalTokens, 0),
}

const accuracy = (pick) => decisions.filter(pick).length / decisions.length
const rate = (value) => `${(value * 100).toFixed(1)}%`
const perCall = llmTokens.total / usable.length

const localAcc = accuracy((d) => d.localOk)
const llmAcc = accuracy((d) => d.llmOk)
const agree = decisions.filter((d) => d.localAnswer === d.llmAnswer).length / decisions.length

console.log(`\ncases      : ${usable.length}  decisions: ${decisions.length}`)
console.log(`local acc  : ${localAcc.toFixed(4)}`)
console.log(`${MODEL} acc: ${llmAcc.toFixed(4)}`)
console.log(`agreement  : ${agree.toFixed(4)}`)
console.log(`LLM tokens : ${llmTokens.total} total  (${perCall.toFixed(1)} per case; ` +
  `${llmTokens.prompt} prompt + ${llmTokens.completion} completion)`)

const strategies = {}
// LLM-only: every case costs a call.
strategies['llm-only'] = {
  llmCalls: usable.length, tokens: llmTokens.total,
  savings: 0, accuracy: llmAcc, escalationRate: 1,
}
// Local-only: no calls, no billed tokens.
strategies['local-only'] = {
  llmCalls: 0, tokens: 0, savings: 1, accuracy: localAcc, escalationRate: 0,
}

for (const tau of TAUS) {
  // A case is escalated when ANY of its decisions is unsure, because the case is
  // the unit the LLM is called with.
  let escalatedCases = 0
  let escalatedDecisions = 0
  let correct = 0
  for (const record of usable) {
    const unsure = record.decisions.some((d) => d.confidence === null || d.confidence < tau)
    if (unsure) escalatedCases += 1
    for (const d of record.decisions) {
      const unsureDecision = d.confidence === null || d.confidence < tau
      if (unsureDecision) escalatedDecisions += 1
      // The escalated case is re-answered wholesale by the LLM, so every decision
      // in it takes the LLM's answer; the rest keep the local answer.
      const ok = unsure ? d.llmOk : d.localOk
      if (ok) correct += 1
    }
  }
  const tokens = escalatedCases * perCall
  strategies[`hybrid-tau-${tau}`] = {
    llmCalls: escalatedCases,
    tokens: Math.round(tokens),
    savings: 1 - tokens / llmTokens.total,
    accuracy: correct / decisions.length,
    escalationRate: escalatedCases / usable.length,
    escalatedDecisions,
  }
}

console.log('\nstrategy                       calls   tokens   saved   accuracy  escalated')
for (const [name, s] of Object.entries(strategies)) {
  console.log(`${name.padEnd(28)} ${String(s.llmCalls).padStart(5)} ` +
    `${String(s.tokens).padStart(8)} ${rate(s.savings).padStart(7)} ` +
    `${s.accuracy.toFixed(4).padStart(9)} ${rate(s.escalationRate).padStart(10)}`)
}

const outPath = path.isAbsolute(OUT) ? OUT : path.join(REPO, OUT)
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, `${JSON.stringify({
  model: MODEL, rows: usable.length, decisions: decisions.length,
  llmTokens, perCaseTokens: perCall,
  localAccuracy: localAcc, llmAccuracy: llmAcc, agreement: agree,
  strategies,
  perDecision: decisions,
}, null, 1)}\n`, 'utf8')
console.log(`\nwrote ${outPath}`)
