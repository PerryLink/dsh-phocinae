/**
 * Approval gate: decide whether a pending tool call may run.
 *
 * Contract notes that the previous release got wrong, and that the tests pin:
 *
 *  - The gate is driven by `tools/pre-execute`, whose waterfall listener must
 *    return a `PreToolDecision` (`{kind: 'allow'}`, `{kind: 'deny', reason}`,
 *    `{kind: 'ask', reason}`) or delegate with `next()`. It must not call
 *    `next(err)`: that rejects the waterfall instead of producing a decision.
 *  - `ToolExecution` carries the tool name at `exec.name`. There is no
 *    `exec.tool`, no `exec.toolName`, and no `exec.payload`.
 *  - The decision service answers with `answers: {<id>: value}`. Reading it as
 *    an array yields `undefined` for every question.
 *  - A failed lookup must never read as "safe". Unreachable service, missing
 *    confidence, or a malformed body all resolve to `ask` (fail closed).
 */
import { GATE_ACTIONS, GATE_HARMLESS_INDEX, GATE_HARM_OPTIONS } from './constants.mjs'
import { commandOf, isAutoAllowed, toolMatches } from './config.mjs'
import {
  buildGateRequest,
  coerceAnswer,
  readConfidence,
  readOptionScores,
  postSystemOne,
} from './protocol.mjs'

/** Reasons are stable strings so callers and tests can branch on them. */
export const GATE_REASONS = Object.freeze({
  disabled: 'gate-disabled',
  ungated: 'tool-not-gated',
  autoAllowed: 'command-on-auto-allow-list',
  harmless: 'model-called-it-harmless',
  lowRisk: 'model-answered-low-risk',
  accepted: 'model-answered-allow',
  review: 'model-answered-ask',
  destructive: 'model-called-it-destructive',
  blocked: 'model-answered-deny',
  lowConfidence: 'confidence-below-threshold',
  serviceUnavailable: 'decision-service-unavailable',
  failOpen: 'decision-service-unavailable-fail-open',
})

/**
 * Extract the tool name, arguments, and caller context out of a
 * `tools/pre-execute` payload.
 *
 * `exec.name` / `exec.arguments` are the real contract. The fallbacks exist so a
 * future rename degrades to `ask` (see `resolveDecision`) instead of silently
 * passing every call through.
 */
export function describeExecution(exec, platform, cwd) {
  const payload = exec ?? {}
  const toolName = typeof payload.name === 'string'
    ? payload.name
    : (typeof payload.toolName === 'string' ? payload.toolName : '')
  const toolInput = payload.arguments !== undefined
    ? payload.arguments
    : (payload.input !== undefined ? payload.input : null)
  return {
    toolName,
    toolInput,
    platform: payload.platform ?? platform ?? process.platform,
    cwd: payload.cwd ?? cwd ?? process.cwd(),
  }
}

/** Map a tri-state answer index onto a decision. */
function decisionFromAction(index) {
  return GATE_ACTIONS[index] ?? 'ask'
}

/**
 * Map a harm-scale answer onto a decision.
 *
 * Only `harmless` (index 0) passes. `destructive` is a positive finding and is
 * blocked outright; `risky` is exactly the "look at this" case and goes to a
 * human. This asymmetry is the point: the question is phrased so the model has
 * to actively call something harmless before the gate lets it through.
 */
function decisionFromHarm(index) {
  if (index === GATE_HARMLESS_INDEX) return 'allow'
  if (index === GATE_HARM_OPTIONS.length - 1) return 'deny'
  return 'ask'
}

/**
 * Freeze one decision into the canonical gate verdict.
 * @param decision - one of `allow` / `ask` / `deny`
 * @param extra - reason, confidence, escalation detail
 */
function verdict(decision, extra) {
  return Object.freeze({ decision, ...extra })
}

/**
 * Turn a model answer into a verdict, applying the escalation and failure rules.
 *
 * @param input - `{answer, confidence, config, questionType}` (`answer` is the
 *   coerced value: a bool for `noul`, an option index for `choice`)
 */
export function resolveDecision({ answer, confidence, config, questionType, gateMode }) {
  const { gate } = config
  const minConfidence = gate.minConfidence
  const mode = gateMode ?? gate.mode

  let decision
  let reason
  if (questionType === 'choice' && mode === 'harm') {
    decision = decisionFromHarm(answer)
    reason = decision === 'allow'
      ? GATE_REASONS.harmless
      : (decision === 'deny' ? GATE_REASONS.destructive : GATE_REASONS.review)
  } else if (questionType === 'choice') {
    decision = decisionFromAction(answer)
    reason = decision === 'allow'
      ? GATE_REASONS.accepted
      : (decision === 'deny' ? GATE_REASONS.blocked : GATE_REASONS.review)
  } else if (answer === true) {
    decision = gate.riskyDecision
    reason = gate.riskyDecision === 'deny' ? GATE_REASONS.blocked : GATE_REASONS.review
  } else {
    decision = 'allow'
    reason = GATE_REASONS.lowRisk
  }

  // A deny is a positive finding and always stands. An `allow` the model was not
  // sure about becomes a review: the gate never turns low confidence into
  // passage. `minConfidence` is deliberately separate from the `escalateAt`
  // signal used by `phocinae_ask` — see the config documentation for why.
  const unsure = confidence === undefined || confidence < minConfidence
  if (unsure && decision === 'allow') {
    return verdict('ask', {
      reason: GATE_REASONS.lowConfidence,
      confidence,
      escalate: true,
      modelDecision: 'allow',
    })
  }

  return verdict(decision, {
    reason,
    confidence,
    escalate: decision !== 'allow',
    modelDecision: decision,
  })
}

/** The verdict used when the decision service cannot answer. */
export function unavailableVerdict(config, error) {
  const failOpen = config.gate.failMode === 'open'
  return verdict(failOpen ? 'allow' : 'ask', {
    reason: failOpen ? GATE_REASONS.failOpen : GATE_REASONS.serviceUnavailable,
    confidence: undefined,
    escalate: !failOpen,
    error: error instanceof Error ? error.message : String(error),
    errorCode: error?.code,
  })
}

/**
 * Ask the local decision model about one tool call.
 *
 * Never throws: an unreachable or misbehaving service is a verdict, not an
 * exception, because throwing out of a `tools/pre-execute` listener would abort
 * the pipeline instead of producing a decision.
 *
 * @param event - `{toolName, toolInput, platform, cwd}`
 * @param config - resolved configuration
 * @returns a frozen verdict
 */
export async function decideToolCall(event, config) {
  if (!config.gate.enabled || config.gate.mode === 'off') {
    return verdict('allow', { reason: GATE_REASONS.disabled, escalate: false })
  }
  if (!toolMatches(config.gate.tools, event.toolName)) {
    return verdict('allow', { reason: GATE_REASONS.ungated, escalate: false })
  }

  // Trivially safe commands never reach the model. This is not an optimisation
  // detail: the model's confidence does not separate routine commands from risky
  // ones well enough for it to be asked about `git status` (see README
  // "Measured behaviour"), so a plain allow-list carries that traffic instead.
  const command = commandOf(event.toolInput)
  const autoAllowed = isAutoAllowed(event.toolInput, config.gate.autoAllow)
  if (autoAllowed !== null) {
    return verdict('allow', {
      reason: GATE_REASONS.autoAllowed,
      escalate: false,
      autoAllowPattern: autoAllowed,
      command,
    })
  }

  try {
    const { body, questionId, questionType } = buildGateRequest(event, config)
    const response = await postSystemOne(body, config)
    const answer = coerceAnswer(response.answers?.[questionId], {
      id: questionId,
      type: questionType,
      options: body.questions[0].options ?? [],
    }, config.endpoint)
    const confidence = readConfidence(response, questionId)
    const optionScores = readOptionScores(response, questionId)
    const resolved = resolveDecision({ answer, confidence, config, questionType })
    const action = questionType !== 'choice'
      ? undefined
      : (config.gate.mode === 'harm' ? GATE_HARM_OPTIONS[answer] : GATE_ACTIONS[answer])
    return Object.freeze({
      ...resolved,
      action,
      optionScores,
    })
  } catch (error) {
    return unavailableVerdict(config, error)
  }
}

/**
 * Translate a verdict into the harness decision object.
 *
 * `ask` deliberately stays `ask`: the tool runtime converts it into an approval
 * request, and when a deployment composes no approval service the documented
 * behaviour is that it becomes a denial. Either way it is not silent passage.
 */
export function toPreToolDecision(result) {
  switch (result.decision) {
    case 'allow':
      return { kind: 'allow' }
    case 'deny':
      return {
        kind: 'deny',
        reason: `dsh-phocinae blocked this call: ${describeVerdict(result)}`,
      }
    default:
      return {
        kind: 'ask',
        reason: `dsh-phocinae escalated this call to a human: ${describeVerdict(result)}`,
        displayReason: {
          en: 'Phocinae flagged this tool call for review',
          zh: '斑海豹将此工具调用标记为需人工复核',
        },
      }
  }
}

/** One-line human-readable summary of a verdict. */
export function describeVerdict(result) {
  const confidence = result.confidence === undefined
    ? 'no calibrated confidence'
    : `confidence ${result.confidence.toFixed(4)}`
  const error = result.error ? ` (${result.error})` : ''
  return `${result.reason}, ${confidence}${error}`
}

/**
 * Build the `tools/pre-execute` listener.
 *
 * The listener is total and never throws; it always returns a decision or
 * delegates. `next()` is called exactly once, on the allow path.
 *
 * @param config - resolved configuration
 * @param logger - optional host logger (`{info, warn}`)
 * @param platform - platform string recorded in the decision state
 * @param cwd - working directory recorded in the decision state
 */
export function createPreExecuteGate(config, logger, platform, cwd) {
  const onVerdict = (event, result) => {
    if (!config.gate.audit || !logger) return
    const line = `phocinae gate: ${event.toolName || '<unknown tool>'} -> ` +
      `${result.decision} (${describeVerdict(result)})`
    if (result.decision === 'allow') logger.info?.(line)
    else logger.warn?.(line)
  }

  return async function preExecuteGate(exec, next) {
    const event = describeExecution(exec, platform, cwd)
    const result = await decideToolCall(event, config)
    onVerdict(event, result)
    if (result.decision === 'allow') return next()
    return toPreToolDecision(result)
  }
}
