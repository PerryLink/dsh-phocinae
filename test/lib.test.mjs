/**
 * Unit tests for configuration, the protocol client, and the gate decision rules.
 * No network: the transport is exercised through a stubbed global fetch.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const load = (relative) => import(pathToFileURL(join(ROOT, relative)).href)

const { resolveConfig, toolMatches, DEFAULT_CONFIG, commandOf, isAutoAllowed } =
  await load('lib/config.mjs')
const { ERROR_CODES } = await load('lib/errors.mjs')
const {
  clampState, coerceAnswer, decide, readAnswer, readConfidence, readOptionScores,
  renderToolCall, validateQuestions, buildGateRequest,
} = await load('lib/protocol.mjs')
const { GATE_REASONS, resolveDecision, toPreToolDecision, unavailableVerdict } =
  await load('lib/guard.mjs')

// ---------------------------------------------------------------- configuration

test('resolveConfig returns complete defaults for an empty config', () => {
  const config = resolveConfig({})
  assert.equal(config.endpoint, DEFAULT_CONFIG.endpoint)
  assert.equal(config.model, 'Phocinae-Largha-150M-v1')
  assert.equal(config.timeoutMs, 3000)
  assert.equal(config.escalateAt, 0.6)
  assert.equal(config.gate.enabled, true)
  assert.equal(config.gate.mode, 'harm')
  assert.equal(config.gate.failMode, 'closed')
  assert.equal(config.gate.minConfidence, 0.45)
  assert.ok(config.gate.autoAllow.includes('git status'))
  assert.deepEqual(config.gate.tools, ['*'])
  assert.equal(Object.isFrozen(config), true)
  assert.equal(Object.isFrozen(config.gate), true)
})

test('resolveConfig rejects a remote endpoint unless it is explicitly allowed', () => {
  assert.throws(() => resolveConfig({ endpoint: 'http://10.0.0.5:8155/v1/systemone' }),
    (error) => error.code === ERROR_CODES.invalidConfig && /loopback/.test(error.message))
  const allowed = resolveConfig({
    endpoint: 'http://10.0.0.5:8155/v1/systemone',
    allowRemoteEndpoint: true,
  })
  assert.match(allowed.endpoint, /10\.0\.0\.5/)
})

test('resolveConfig rejects illegal values loudly instead of defaulting', () => {
  for (const bad of [
    { timeoutMs: 0 },
    { timeoutMs: 1.5 },
    { escalateAt: 1.5 },
    { escalateAt: 'high' },
    { model: '' },
    { gate: { mode: 'yes' } },
    { gate: { failMode: 'maybe' } },
    { gate: { threshold: -0.1 } },
    { gate: { tools: [] } },
    { gate: { tools: [''] } },
    { endpoint: 'ftp://127.0.0.1/x' },
    { endpoint: 'not a url' },
  ]) {
    assert.throws(() => resolveConfig(bad),
      (error) => error.code === ERROR_CODES.invalidConfig,
      `expected ${JSON.stringify(bad)} to be rejected`)
  }
})

test('resolveConfig keeps the scalar gate configuration callers relied on', () => {
  const config = resolveConfig({ gate: { threshold: 0.9, tools: ['bash'] } })
  assert.equal(config.gate.threshold, 0.9)
  assert.deepEqual(config.gate.tools, ['bash'])
})

test('toolMatches covers exact names, wildcards, and the catch-all', () => {
  assert.equal(toolMatches(['*'], 'anything'), true)
  assert.equal(toolMatches(['pwsh'], 'pwsh'), true)
  assert.equal(toolMatches(['pwsh'], 'PWSh'), true, 'tool names differ in case across platforms')
  assert.equal(toolMatches(['pwsh'], 'bash'), false)
  assert.equal(toolMatches(['mcp__*'], 'mcp__github'), true)
  assert.equal(toolMatches(['mcp__*'], 'pwsh'), false)
  assert.equal(toolMatches(['*_tool'], 'some_tool'), true)
  assert.equal(toolMatches(['a.b'], 'axb'), false, 'regex metacharacters are escaped')
  assert.equal(toolMatches(['*'], ''), false)
})

// ---------------------------------------------------------------- auto-allow

test('resolveConfig rejects an auto-allow entry containing a shell operator', () => {
  for (const entry of [
    'git status && rm -rf /',
    'ls; rm -rf /',
    'cat x | sh',
    'echo $(whoami)',
    'ls > out.txt',
    'find . -delete &',
  ]) {
    assert.throws(() => resolveConfig({ gate: { autoAllow: [entry] } }),
      (error) => error.code === ERROR_CODES.invalidConfig && /shell operator/.test(error.message),
      `expected ${JSON.stringify(entry)} to be refused`)
  }
  assert.doesNotThrow(() => resolveConfig({ gate: { autoAllow: ['git status', 'Get-Content'] } }))
})

test('commandOf reads the argument names shell tools actually use', () => {
  assert.equal(commandOf({ command: 'git status' }), 'git status')
  assert.equal(commandOf({ cmd: 'ls' }), 'ls')
  assert.equal(commandOf('bare string'), 'bare string')
  assert.equal(commandOf({ unrelated: 1 }), null)
  assert.equal(commandOf(null), null)
  assert.equal(commandOf(42), null)
})

test('isAutoAllowed matches whole first words and refuses operator chains', () => {
  const list = resolveConfig({}).gate.autoAllow
  assert.equal(isAutoAllowed('git status', list), 'git status')
  assert.equal(isAutoAllowed('  git status  ', list), 'git status')
  assert.equal(isAutoAllowed('git status --short', list), 'git status',
    'trailing arguments are part of the same read-only command')
  assert.equal(isAutoAllowed('git statuses', list), null,
    'a longer word that merely starts with the prefix must not match')
  assert.equal(isAutoAllowed('git status && rm -rf /', list), null,
    'an operator means the rest of the line is unchecked')
  assert.equal(isAutoAllowed('git status; rm -rf /', list), null)
  assert.equal(isAutoAllowed('git push --force', list), null)
  assert.equal(isAutoAllowed('Remove-Item -Recurse -Force /', list), null)
  assert.equal(isAutoAllowed({ command: 'Get-ChildItem -Force' }, list), 'Get-ChildItem')
  assert.equal(isAutoAllowed({ command: 'Get-ChildItem | Remove-Item' }, list), null)
  assert.equal(isAutoAllowed('', list), null)
})

test('the shipped auto-allow list contains no operator-bearing entries', () => {
  for (const entry of DEFAULT_CONFIG.gate.autoAllow) {
    assert.ok(!/[;&|><`$(){}[\]\n\r\\!]/.test(entry),
      `shipped entry ${JSON.stringify(entry)} contains a shell operator`)
  }
})

// -------------------------------------------------------------------- protocol

test('validateQuestions enforces the server contract before any request', () => {
  assert.throws(() => validateQuestions([]), (e) => e.code === ERROR_CODES.invalidArguments)
  assert.throws(() => validateQuestions([{ id: '', type: 'noul' }]),
    (e) => e.code === ERROR_CODES.invalidArguments)
  assert.throws(() => validateQuestions([{ id: 'a', type: 'yes' }]),
    (e) => e.code === ERROR_CODES.invalidArguments)
  assert.throws(() => validateQuestions([{ id: 'a', type: 'choice', options: ['only'] }]),
    (e) => e.code === ERROR_CODES.invalidArguments)
  assert.throws(() => validateQuestions([{ id: 'a', type: 'score', options: ['x', 'y'] }]),
    (e) => e.code === ERROR_CODES.invalidArguments, 'score questions must not carry options')
  assert.throws(
    () => validateQuestions([{ id: 'dup', type: 'noul' }, { id: 'dup', type: 'noul' }]),
    (e) => e.code === ERROR_CODES.invalidArguments,
    'duplicate ids would collide in the answers map')
  assert.throws(() => validateQuestions([{ id: 'a', type: 'noul', threshold: 2 }]),
    (e) => e.code === ERROR_CODES.invalidArguments)

  const ok = [{ id: 'a', type: 'choice', options: ['x', 'y'] }, { id: 'b', type: 'score' }]
  assert.equal(validateQuestions(ok), ok)
})

test('readAnswer insists on the id-keyed answers object', () => {
  assert.equal(readAnswer({ answers: { risk: true } }, 'risk', 'ep'), true)
  assert.throws(() => readAnswer({ answers: [true] }, 'risk', 'ep'),
    (e) => e.code === ERROR_CODES.badResponse)
  assert.throws(() => readAnswer({ answers: {} }, 'risk', 'ep'),
    (e) => e.code === ERROR_CODES.badResponse)
  assert.throws(() => readAnswer({}, 'risk', 'ep'),
    (e) => e.code === ERROR_CODES.badResponse)
})

test('readConfidence and readOptionScores tolerate a server without extensions', () => {
  assert.equal(readConfidence({}, 'q'), undefined)
  assert.equal(readConfidence({ answer_confidence: { q: 0.5 } }, 'q'), 0.5)
  assert.equal(readConfidence({ answer_confidence: { q: 'high' } }, 'q'), undefined)
  assert.equal(readOptionScores({}, 'q'), undefined)
  assert.deepEqual(readOptionScores({ option_scores: { q: [0.1, 0.9] } }, 'q'), [0.1, 0.9])
})

test('coerceAnswer type-checks instead of defaulting', () => {
  const noul = { id: 'r', type: 'noul' }
  assert.equal(coerceAnswer(true, noul, 'ep'), true)
  assert.equal(coerceAnswer('true', noul, 'ep'), true)
  assert.throws(() => coerceAnswer('yes', noul, 'ep'), (e) => e.code === ERROR_CODES.badResponse)

  const choice = { id: 'c', type: 'choice', options: ['a', 'b', 'c'] }
  assert.equal(coerceAnswer(2, choice, 'ep'), 2)
  assert.throws(() => coerceAnswer(3, choice, 'ep'), (e) => e.code === ERROR_CODES.badResponse)
  assert.throws(() => coerceAnswer(-1, choice, 'ep'), (e) => e.code === ERROR_CODES.badResponse)
  assert.throws(() => coerceAnswer('deny', choice, 'ep'), (e) => e.code === ERROR_CODES.badResponse)

  const score = { id: 's', type: 'score' }
  assert.equal(coerceAnswer(7, score, 'ep'), 7)
  assert.throws(() => coerceAnswer(1, score, 'ep'), (e) => e.code === ERROR_CODES.badResponse)
  assert.throws(() => coerceAnswer(11, score, 'ep'), (e) => e.code === ERROR_CODES.badResponse)
})

test('clampState keeps the head and marks the cut', () => {
  assert.equal(clampState('short', 100), 'short')
  const clamped = clampState('x'.repeat(50), 10)
  assert.equal(clamped.startsWith('x'.repeat(10)), true)
  assert.match(clamped, /\[truncated\]$/)
})

test('renderToolCall gives the model the platform and working directory', () => {
  const text = renderToolCall({
    toolName: 'pwsh',
    toolInput: { command: 'git status' },
    platform: 'win32',
    cwd: 'D:\\Projects',
    maxChars: 4096,
  })
  assert.match(text, /tool: pwsh/)
  assert.match(text, /platform: win32/)
  assert.match(text, /cwd: D:\\Projects/)
  assert.match(text, /git status/)
})

test('renderToolCall survives a non-serialisable input', () => {
  const cyclic = {}
  cyclic.self = cyclic
  const text = renderToolCall({
    toolName: 'pwsh', toolInput: cyclic, platform: 'win32', cwd: '/', maxChars: 4096,
  })
  assert.match(text, /\[object Object\]/)
})

test('buildGateRequest defaults to the harm scale and honours the other modes', () => {
  const event = { toolName: 'pwsh', toolInput: { command: 'rm -rf /' }, platform: 'linux', cwd: '/' }

  const harm = buildGateRequest(event, resolveConfig({}))
  assert.equal(harm.body.questions[0].type, 'choice')
  assert.deepEqual(harm.body.questions[0].options, ['harmless', 'risky', 'destructive'])

  const tri = buildGateRequest(event, resolveConfig({ gate: { mode: 'tri-state' } }))
  assert.deepEqual(tri.body.questions[0].options, ['allow', 'ask', 'deny'])

  const noul = buildGateRequest(event, resolveConfig({ gate: { mode: 'noul' } }))
  assert.equal(noul.body.questions[0].type, 'noul')
  assert.equal(noul.body.questions[0].threshold, 0.8)
})

// ------------------------------------------------------------------ decide()

test('decide normalises a full server response', async () => {
  const config = resolveConfig({})
  const original = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      model: 'Phocinae-Largha-150M-v1',
      answers: { risk: false, act: 1, sev: 6 },
      answer_confidence: { risk: 0.91, act: 0.55, sev: 0.8 },
      option_scores: { risk: [0.09, 0.91] },
      usage: { input_tokens: 30, output_tokens: 0 },
    }),
    text: async () => '',
  })
  try {
    const result = await decide({
      state: 'the agent restarted nginx and health is green',
      questions: [
        { id: 'risk', type: 'noul' },
        { id: 'act', type: 'choice', options: ['allow', 'ask', 'deny'] },
        { id: 'sev', type: 'score' },
      ],
    }, config)

    assert.deepEqual(result.answers, { risk: false, act: 1, sev: 6 })
    assert.equal(result.confidence.act, 0.55)
    assert.equal(result.escalate, true, 'the weakest answer drives escalation')
    assert.deepEqual(result.escalatedIds, ['act'])
    assert.equal(result.escalationReason, 'below-threshold')
    assert.equal(result.escalateAt, 0.6)
    assert.deepEqual(result.usage, { input_tokens: 30, output_tokens: 0 })
  } finally {
    globalThis.fetch = original
  }
})

test('decide marks missing confidence as escalation, never as certainty', async () => {
  const config = resolveConfig({})
  const original = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ model: 'm', answers: { q: true }, usage: {} }),
    text: async () => '',
  })
  try {
    const result = await decide({ state: 's', questions: [{ id: 'q', type: 'noul' }] }, config)
    assert.equal(result.escalate, true)
    assert.equal(result.escalationReason, 'no-confidence-extension')
  } finally {
    globalThis.fetch = original
  }
})

test('decide reports an unreachable service with an actionable code', async () => {
  const config = resolveConfig({ timeoutMs: 50 })
  const original = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED') }
  try {
    await assert.rejects(
      () => decide({ state: 's', questions: [{ id: 'q', type: 'noul' }] }, config),
      (error) => error.code === ERROR_CODES.serviceUnavailable
        && /python -m phocinae\.main/.test(error.message),
    )
  } finally {
    globalThis.fetch = original
  }
})

test('decide surfaces the server status on a non-2xx answer', async () => {
  const config = resolveConfig({})
  const original = globalThis.fetch
  globalThis.fetch = async () => ({ ok: false, status: 422, text: async () => 'bad model' })
  try {
    await assert.rejects(
      () => decide({ state: 's', questions: [{ id: 'q', type: 'noul' }] }, config),
      (error) => error.code === ERROR_CODES.serviceError && error.details.status === 422,
    )
  } finally {
    globalThis.fetch = original
  }
})

test('decide rejects an empty state before touching the network', async () => {
  const config = resolveConfig({})
  let called = false
  const original = globalThis.fetch
  globalThis.fetch = async () => { called = true; throw new Error('should not run') }
  try {
    await assert.rejects(() => decide({ state: '   ', questions: [{ id: 'q', type: 'noul' }] }, config),
      (error) => error.code === ERROR_CODES.invalidArguments)
    assert.equal(called, false)
  } finally {
    globalThis.fetch = original
  }
})

// --------------------------------------------------------------- gate rules

test('resolveDecision maps harm answers onto verdicts', () => {
  const config = resolveConfig({})
  const harmless = resolveDecision({ answer: 0, confidence: 0.9, config, questionType: 'choice' })
  assert.equal(harmless.decision, 'allow')
  assert.equal(harmless.reason, GATE_REASONS.harmless)

  const destructive = resolveDecision({ answer: 2, confidence: 0.9, config, questionType: 'choice' })
  assert.equal(destructive.decision, 'deny')
  assert.equal(destructive.reason, GATE_REASONS.destructive)
  assert.equal(destructive.escalate, true)

  const risky = resolveDecision({ answer: 1, confidence: 0.9, config, questionType: 'choice' })
  assert.equal(risky.decision, 'ask')
  assert.equal(risky.reason, GATE_REASONS.review)
})

test('resolveDecision maps tri-state answers onto verdicts', () => {
  const config = resolveConfig({ gate: { mode: 'tri-state' } })
  const allow = resolveDecision({ answer: 0, confidence: 0.9, config, questionType: 'choice' })
  assert.equal(allow.decision, 'allow')
  assert.equal(allow.reason, GATE_REASONS.accepted)

  const deny = resolveDecision({ answer: 2, confidence: 0.9, config, questionType: 'choice' })
  assert.equal(deny.decision, 'deny')

  const ask = resolveDecision({ answer: 1, confidence: 0.9, config, questionType: 'choice' })
  assert.equal(ask.decision, 'ask')
})

test('resolveDecision escalates low confidence to a human, never past a deny', () => {
  const config = resolveConfig({})
  const unsure = resolveDecision({ answer: 0, confidence: 0.4, config, questionType: 'choice' })
  assert.equal(unsure.decision, 'ask', 'an unsure allow becomes a review')
  assert.equal(unsure.reason, GATE_REASONS.lowConfidence)
  assert.equal(unsure.modelDecision, 'allow')

  const confidentDeny = resolveDecision({ answer: 2, confidence: 0.2, config, questionType: 'choice' })
  assert.equal(confidentDeny.decision, 'deny', 'a deny is never softened into an ask')

  const missingConfidence = resolveDecision({ answer: 0, config, questionType: 'choice' })
  assert.equal(missingConfidence.decision, 'ask',
    'a server without the confidence extension must not auto-pass anything')
})

test('resolveDecision handles the legacy noul mode both ways', () => {
  const config = resolveConfig({ gate: { mode: 'noul' } })
  const risky = resolveDecision({ answer: true, confidence: 0.95, config, questionType: 'noul' })
  assert.equal(risky.decision, 'deny')
  assert.equal(risky.reason, GATE_REASONS.blocked)

  const safe = resolveDecision({ answer: false, confidence: 0.95, config, questionType: 'noul' })
  assert.equal(safe.decision, 'allow')
  assert.equal(safe.reason, GATE_REASONS.lowRisk)

  const riskyAsk = resolveDecision({
    answer: true, confidence: 0.95, questionType: 'noul',
    config: resolveConfig({ gate: { mode: 'noul', riskyDecision: 'ask' } }),
  })
  assert.equal(riskyAsk.decision, 'ask')
})

test('unavailableVerdict honours failMode and records why', () => {
  const closed = unavailableVerdict(resolveConfig({}), new Error('boom'))
  assert.equal(closed.decision, 'ask')
  assert.match(closed.error, /boom/)

  const open = unavailableVerdict(resolveConfig({ gate: { failMode: 'open' } }), new Error('boom'))
  assert.equal(open.decision, 'allow')
  assert.equal(open.reason, GATE_REASONS.failOpen)
})

test('toPreToolDecision produces the harness decision shapes', () => {
  assert.deepEqual(toPreToolDecision({ decision: 'allow', reason: 'x' }), { kind: 'allow' })
  const deny = toPreToolDecision({ decision: 'deny', reason: 'blocked', confidence: 0.9 })
  assert.equal(deny.kind, 'deny')
  assert.match(deny.reason, /blocked/)
  const ask = toPreToolDecision({ decision: 'ask', reason: 'unsure' })
  assert.equal(ask.kind, 'ask')
  assert.ok(ask.displayReason.zh)
})
