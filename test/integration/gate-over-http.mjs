/**
 * Integration test: the real plugin entry, registering into a host-shaped
 * context, driving the real `tools/pre-execute` gate over real HTTP against a
 * decision service.
 *
 * `boot-headless.mjs` proves the host loads the plugin. This proves what the
 * plugin then does — deterministically, with no model in the loop, because an
 * end-to-end task run depends on the model choosing to call the shell tool and
 * that is not a stable thing to assert on.
 *
 *   node test/integration/gate-over-http.mjs
 *
 * Everything here is real except the decision service: the entry module, the
 * Cordis-shaped context (undeclared service access throws), the tool registry,
 * the HTTP client, and the `PreToolDecision` contract.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.dirname(path.dirname(HERE))
const PORT = 18156
const ENDPOINT = `http://127.0.0.1:${PORT}/v1/systemone`

const step = (message) => process.stdout.write(`  ${message}\n`)

/** A context that mimics the Cordis proxy: undeclared reads throw. */
function makeHost() {
  const registered = []
  const listeners = new Map()
  const warnings = []
  const base = {
    logger: {
      info: () => {},
      warn: (message) => warnings.push(String(message)),
      error: () => {},
    },
    on(name, handler) {
      if (!listeners.has(name)) listeners.set(name, [])
      listeners.get(name).push(handler)
    },
    tools: {
      register(definition) {
        registered.push(definition)
        return () => {}
      },
    },
    inject(deps, callback) {
      assert.deepEqual(deps, ['tools'])
      callback(base)
    },
  }
  const proxy = new Proxy(base, {
    get(target, property, receiver) {
      if (typeof property === 'string' && !(property in target)
        && property !== 'then' && property !== 'toJSON') {
        throw new Error(`cannot get property "${property}" without inject`)
      }
      return Reflect.get(target, property, receiver)
    },
  })
  return { ctx: proxy, registered, listeners, warnings }
}

async function driveGate(listeners, exec) {
  const gate = listeners.get('tools/pre-execute')?.[0]
  assert.ok(gate, 'the plugin must subscribe to tools/pre-execute')
  let nextCalls = 0
  const decision = await gate(exec, async () => {
    nextCalls += 1
    return { kind: 'allow' }
  })
  // The contract: a waterfall listener returns a PreToolDecision or delegates.
  assert.ok(decision && typeof decision.kind === 'string',
    `the gate returned ${JSON.stringify(decision)} instead of a PreToolDecision`)
  return { decision, nextCalls }
}

function exec(command, name = 'pwsh') {
  return {
    callId: `call-${Math.random().toString(36).slice(2)}`,
    rootCallId: 'root',
    token: 'token',
    name,
    arguments: { command },
    signal: new AbortController().signal,
  }
}

async function waitForHealth(url, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return true
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 120))
  }
  return false
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-phocinae-gate-'))
const logPath = path.join(root, 'decisions.jsonl')
let service = null

try {
  process.stdout.write('\n[1/4] start the decision service\n')
  service = spawn(process.execPath, [
    path.join(HERE, 'fake-service.mjs'), '--port', String(PORT), '--log', logPath,
  ], { stdio: ['ignore', 'pipe', 'inherit'] })
  assert.ok(await waitForHealth(`http://127.0.0.1:${PORT}/health`),
    'the fake decision service did not become healthy')
  step(`listening on ${ENDPOINT}`)

  process.stdout.write('\n[2/4] load the real entry and register into the host\n')
  const plugin = await import(pathToFileURL(path.join(REPO, 'index.mjs')).href)
  const host = makeHost()
  // A named tool list on purpose: the default is `['*']`, and pinning `pwsh`
  // here is what lets the last assertion prove an ungated tool is skipped.
  plugin.default(host.ctx, { endpoint: ENDPOINT, timeoutMs: 5000, gate: { tools: ['pwsh'] } })
  assert.deepEqual(host.registered.map((t) => t.name).sort(),
    ['phocinae_ask', 'phocinae_gate'])
  step('registered phocinae_ask and phocinae_gate (gate.tools = ["pwsh"])')

  const decisions = () => (fs.existsSync(logPath)
    ? fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [])

  process.stdout.write('\n[3/4] drive tools/pre-execute\n')

  // --- a destructive command must be blocked -------------------------------
  const dangerous = await driveGate(host.listeners, exec('Remove-Item -Recurse -Force C:\\Windows'))
  assert.equal(dangerous.decision.kind, 'deny',
    `a destructive command must be denied, got ${JSON.stringify(dangerous.decision)}`)
  assert.equal(dangerous.nextCalls, 0, 'a denied call must not run')
  assert.match(dangerous.decision.reason, /phocinae/i)
  step(`destructive command -> ${dangerous.decision.kind}`)

  // --- an allow-listed command must not consult the service ----------------
  const before = decisions().length
  const allowed = await driveGate(host.listeners, exec('git status'))
  assert.equal(allowed.decision.kind, 'allow')
  assert.equal(allowed.nextCalls, 1, 'an allowed call must delegate exactly once')
  assert.equal(decisions().length, before,
    'an allow-listed command must not cost a decision request')
  step('allow-listed command -> allow, no request')

  // --- a command the model is unsure about goes to a human -----------------
  const uncertain = await driveGate(host.listeners, exec('npm publish --tag next'))
  assert.equal(uncertain.decision.kind, 'ask',
    'the fake service calls this risky, and risky must reach a human')
  assert.equal(uncertain.nextCalls, 0)
  assert.equal(uncertain.decision.kind === 'ask' && typeof uncertain.decision.displayReason, 'object',
    true, 'an ask decision carries a display reason')
  step(`unsure command -> ${uncertain.decision.kind}`)

  // --- an allow-listed command with a second command chained on -------------
  const chained = await driveGate(host.listeners,
    exec('git status && Remove-Item -Recurse -Force C:\\Windows'))
  assert.equal(chained.decision.kind, 'deny',
    'the operator must disqualify the allow-list entry and the model must see the whole line')
  step(`chained command -> ${chained.decision.kind}`)

  // --- a tool outside gate.tools is not screened ---------------------------
  const unknownTool = await driveGate(host.listeners, exec('npm publish', 'some_other_tool'))
  assert.equal(unknownTool.decision.kind, 'allow',
    'tools outside gate.tools are not screened')
  step('ungated tool -> allow without a request')

  process.stdout.write('\n[4/4] fail-closed behaviour with the service down\n')
  service.kill()
  await new Promise((resolve) => setTimeout(resolve, 400))
  const offline = await driveGate(host.listeners, exec('npm publish --tag next'))
  assert.equal(offline.decision.kind, 'ask',
    'an unreachable decision service must route to a human, never pass silently')
  assert.equal(offline.nextCalls, 0)
  assert.match(offline.decision.reason, /unavailable|unreachable/i)
  step(`service down -> ${offline.decision.kind}`)

  process.stdout.write(
    '\nPASS: the real gate returned deny / allow / ask correctly over real HTTP,\n' +
    'skipped the service for allow-listed commands, and failed closed when the\n' +
    'service went away.\n\n')
} finally {
  if (service) service.kill()
  fs.rmSync(root, { recursive: true, force: true })
}
