/**
 * What the plugin itself costs in context, and what the local path costs in
 * latency. The token-savings run shows what a large-model call costs; this shows
 * what replacing one with a local decision actually spends.
 *
 * Usage: node bench/context-cost.mjs [--out bench/results/context-cost.json]
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
const OUT = flag('out', 'bench/results/context-cost.json')
const PHOC = flag('phoc', 'http://127.0.0.1:8155/v1/systemone')
const CREDENTIALS = flag('credentials', 'C:/Users/zzhdz/.dsh/.credentials.yaml')

const key = process.env.DEEPSEEK_API_KEY
  ?? fs.readFileSync(CREDENTIALS, 'utf8').match(/DEEPSEEK_API_KEY:\s*(\S+)/)[1].trim()

/** Exact token count for an arbitrary string, via the API's own tokenizer. */
async function countTokens(text, label) {
  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'deepseek-flash',
      messages: [{ role: 'user', content: text }],
      // Ask for nothing and measure the prompt: max_tokens 1 keeps this cheap.
      max_tokens: 1,
      temperature: 0,
    }),
  })
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`)
  const payload = await response.json()
  return payload.usage.prompt_tokens
}

const { createTools } = await import(pathToFileURL(path.join(REPO, 'tools.mjs')).href)
const { resolveConfig } = await import(pathToFileURL(path.join(REPO, 'lib/config.mjs')).href)

const [askTool, gateTool] = createTools(resolveConfig({}), undefined,
  { platform: 'win32', cwd: 'D:\\Projects' })

// 1. The tool definitions ride in every request's tool list.
const askSchema = JSON.stringify({
  name: askTool.name, description: askTool.description, parameters: askTool.parameters,
})
const gateSchema = JSON.stringify({
  name: gateTool.name, description: gateTool.description, parameters: gateTool.parameters,
})
const askSchemaTokens = await countTokens(askSchema, 'ask schema')
const gateSchemaTokens = await countTokens(gateSchema, 'gate schema')

// 2. One representative call, as the model would emit it.
const callArgs = JSON.stringify({
  state: 'The agent restarted nginx after checking the logs; the health endpoint is green.',
  questions: [
    { id: 'risk', type: 'noul', threshold: 0.8 },
    { id: 'action', type: 'choice', options: ['allow', 'ask', 'deny'] },
    { id: 'severity', type: 'score' },
  ],
})
const callTokens = await countTokens(callArgs, 'call args')

// 3. The rendered result the model reads back.
const { createTools: makeTools } = await import(pathToFileURL(path.join(REPO, 'tools.mjs')).href)
const tools = makeTools(resolveConfig({ endpoint: PHOC, timeoutMs: 8000 }), undefined,
  { platform: 'win32', cwd: 'D:\\Projects' })
const ask = tools.find((t) => t.name === 'phocinae_ask')
const started = performance.now()
const value = await ask.execute({
  state: 'The agent restarted nginx after checking the logs; the health endpoint is green.',
  questions: [
    { id: 'risk', type: 'noul', threshold: 0.8 },
    { id: 'action', type: 'choice', options: ['allow', 'ask', 'deny'] },
    { id: 'severity', type: 'score' },
  ],
}, { signal: new AbortController().signal })
const roundTripMs = performance.now() - started
const rendered = ask.output.render({}, value)
const resultTokens = await countTokens(JSON.stringify(rendered), 'result')

// 4. Gate latency: the hook adds nothing to the conversation, only wall time.
const { decideToolCall } = await import(pathToFileURL(path.join(REPO, 'lib/guard.mjs')).href)
const config = resolveConfig({ endpoint: PHOC, timeoutMs: 8000 })
const gateSamples = []
for (const command of [
  'Remove-Item -Recurse -Force C:\\Windows\\System32',
  'git push --force origin main',
  'npm publish --tag next',
  'vssadmin delete shadows /all /quiet',
  'Set-ExecutionPolicy Bypass -Scope LocalMachine -Force',
]) {
  const t0 = performance.now()
  const verdict = await decideToolCall(
    { toolName: 'pwsh', toolInput: { command }, platform: 'win32', cwd: 'D:\\Projects' }, config)
  gateSamples.push({ command, decision: verdict.decision, ms: performance.now() - t0 })
}
const autoAllowT0 = performance.now()
const autoAllow = await decideToolCall(
  { toolName: 'pwsh', toolInput: { command: 'git status' }, platform: 'win32', cwd: 'D:\\Projects' },
  config)
const autoAllowMs = performance.now() - autoAllowT0

const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length
const summary = {
  tokensPerRequest: {
    askToolDefinition: askSchemaTokens,
    gateToolDefinition: gateSchemaTokens,
    bothToolDefinitions: askSchemaTokens + gateSchemaTokens,
    oneCallArguments: callTokens,
    oneCallResult: resultTokens,
    oneLocalDecisionTotal: askSchemaTokens + gateSchemaTokens + callTokens + resultTokens,
  },
  localDecision: {
    roundTripMs: Number(roundTripMs.toFixed(1)),
    answer: value.answers,
    confidence: value.confidence,
    escalate: value.escalate,
  },
  gate: {
    screenedMeanMs: Number(mean(gateSamples.map((s) => s.ms)).toFixed(1)),
    screenedSamples: gateSamples.map((s) => ({ ...s, ms: Number(s.ms.toFixed(1)) })),
    autoAllowedMs: Number(autoAllowMs.toFixed(2)),
    autoAllowedDecision: autoAllow.decision,
    autoAllowedReason: autoAllow.reason,
    contextTokens: 0,
  },
}

console.log('=== what the plugin costs per request ===')
for (const [name, tokens] of Object.entries(summary.tokensPerRequest)) {
  console.log(`  ${name.padEnd(24)} ${String(tokens).padStart(6)} tokens`)
}
console.log('\n=== one local decision ===')
console.log(`  round trip              ${summary.localDecision.roundTripMs} ms`)
console.log(`  answers                 ${JSON.stringify(summary.localDecision.answer)}`)
console.log(`  escalate                ${summary.localDecision.escalate}`)
console.log('\n=== the gate ===')
console.log(`  screened command        ${summary.gate.screenedMeanMs} ms mean ` +
  `(n=${gateSamples.length})`)
console.log(`  allow-listed command    ${summary.gate.autoAllowedMs} ms ` +
  `(${summary.gate.autoAllowedReason})`)
console.log('  conversation tokens     0 — a pre-execute hook is not a message')
for (const sample of gateSamples) {
  console.log(`    ${sample.decision.padEnd(5)} ${sample.ms.toFixed(1).padStart(7)} ms  ` +
    `${sample.command.slice(0, 52)}`)
}

const outPath = path.isAbsolute(OUT) ? OUT : path.join(REPO, OUT)
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 1)}\n`, 'utf8')
console.log(`\nwrote ${outPath}`)
