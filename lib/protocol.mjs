/**
 * Client for the Phocinae `/v1/systemone` decision protocol, plus the two
 * prompt shapes this plugin sends (a generic question batch and the approval
 * gate).
 *
 * The transport is intentionally small and total: one request per call, one
 * timeout, no retries. A retry would multiply the gate's per-command latency on
 * exactly the path where latency is already the dominant cost.
 */
import {
  DEFAULT_MODEL,
  DEFAULT_TIMEOUT_MS,
  GATE_ACTIONS,
  GATE_HARM_OPTIONS,
  MAX_QUESTIONS,
  MAX_OPTIONS,
  QUESTION_TYPES,
  TRUNCATION_MARK,
} from './constants.mjs'
import {
  badResponse,
  invalidArguments,
  serviceError,
  serviceUnavailable,
} from './errors.mjs'

/** Default instruction texts; the server substitutes its own when omitted. */
export const QUESTION_INSTRUCTIONS = Object.freeze({
  noul: 'Does the statement hold?',
  choice: 'Pick the option that best matches the statement.',
  score: 'Rate the statement.',
})

/**
 * Validate a question batch before it reaches the network.
 * @param questions - caller-supplied question specs
 * @returns the same array, unchanged
 */
export function validateQuestions(questions) {
  if (!Array.isArray(questions) || questions.length === 0) {
    throw invalidArguments('questions must be a non-empty array')
  }
  if (questions.length > MAX_QUESTIONS) {
    throw invalidArguments(
      `questions accepts at most ${MAX_QUESTIONS} entries, got ${questions.length}`)
  }
  const seen = new Set()
  for (const [index, question] of questions.entries()) {
    const at = `questions[${index}]`
    if (question === null || typeof question !== 'object' || Array.isArray(question)) {
      throw invalidArguments(`${at} must be an object`)
    }
    if (typeof question.id !== 'string' || question.id === '') {
      throw invalidArguments(`${at}.id must be a non-empty string`)
    }
    if (seen.has(question.id)) {
      throw invalidArguments(`${at}.id ${JSON.stringify(question.id)} is duplicated; ` +
        `answers are keyed by id, so ids must be unique`)
    }
    seen.add(question.id)
    if (!QUESTION_TYPES.includes(question.type)) {
      throw invalidArguments(
        `${at}.type must be one of ${QUESTION_TYPES.join(', ')}, got ${JSON.stringify(question.type)}`)
    }
    if (question.type === 'choice') {
      if (!Array.isArray(question.options) || question.options.length < 2) {
        throw invalidArguments(`${at}.options must list at least 2 candidates for a choice question`)
      }
      if (question.options.length > MAX_OPTIONS) {
        throw invalidArguments(
          `${at}.options accepts at most ${MAX_OPTIONS} entries, got ${question.options.length}`)
      }
      for (const option of question.options) {
        if (typeof option !== 'string' || option === '') {
          throw invalidArguments(`${at}.options entries must be non-empty strings`)
        }
      }
    }
    if (question.type === 'score' && question.options !== undefined) {
      throw invalidArguments(`${at} is a score question; the server rejects ` +
        `\`options\` on score questions (levels are always 2..10)`)
    }
    if (question.threshold !== undefined) {
      if (question.type !== 'noul') {
        throw invalidArguments(`${at}.threshold applies to noul questions only`)
      }
      if (typeof question.threshold !== 'number'
        || !Number.isFinite(question.threshold)
        || question.threshold < 0
        || question.threshold > 1) {
        throw invalidArguments(`${at}.threshold must be a number in [0, 1]`)
      }
    }
  }
  return questions
}

/**
 * Trim a decision state to the configured budget, keeping the head.
 * @param state - raw state text
 * @param maxChars - budget in characters
 */
export function clampState(state, maxChars) {
  if (state.length <= maxChars) return state
  return state.slice(0, maxChars) + TRUNCATION_MARK
}

/**
 * POST one decision batch to the endpoint.
 * @param body - the `{model, state, questions}` request body
 * @param config - resolved configuration
 * @returns the parsed response body
 */
export async function postSystemOne(body, config) {
  const endpoint = config.endpoint
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (cause) {
    throw serviceUnavailable(endpoint, timeoutMs, cause)
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw serviceError(endpoint, response.status, text.slice(0, 300))
  }
  let parsed
  try {
    parsed = await response.json()
  } catch (cause) {
    throw badResponse(endpoint, `body was not JSON (${cause.message})`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw badResponse(endpoint, 'body was not a JSON object')
  }
  return parsed
}

/**
 * Read one answer out of a response.
 *
 * The contract is `answers: {<question id>: <value>}`. The previous release
 * treated it as an array and indexed `answers[0]`, which is always `undefined`
 * for this server — that single mistake silently turned a fail-closed gate into
 * an always-allow gate, so the shape is now checked rather than assumed.
 * @param response - parsed response body
 * @param id - question id
 * @param endpoint - endpoint, for error text
 */
export function readAnswer(response, id, endpoint) {
  const answers = response.answers
  if (Array.isArray(answers)) {
    throw badResponse(endpoint,
      '`answers` was an array; this protocol keys answers by question id')
  }
  if (answers === null || typeof answers !== 'object') {
    throw badResponse(endpoint, '`answers` was missing or not an object')
  }
  if (!Object.hasOwn(answers, id)) {
    throw badResponse(endpoint, `\`answers\` has no entry for question ${JSON.stringify(id)}`)
  }
  return answers[id]
}

/**
 * Read the calibrated confidence for one question, when the server exposes the
 * `answer_confidence` extension.
 * @returns the confidence, or `undefined` when the extension is absent
 */
export function readConfidence(response, id) {
  const confidences = response.answer_confidence
  if (confidences === null || typeof confidences !== 'object' || Array.isArray(confidences)) {
    return undefined
  }
  const value = confidences[id]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Read the per-option calibrated probabilities for one question, when present.
 * @returns the probability vector, or `undefined` when unavailable
 */
export function readOptionScores(response, id) {
  const scores = response.option_scores
  if (scores === null || typeof scores !== 'object' || Array.isArray(scores)) {
    return undefined
  }
  const vector = scores[id]
  if (!Array.isArray(vector)) return undefined
  return vector.filter((value) => typeof value === 'number' && Number.isFinite(value))
}

/**
 * Coerce a raw answer into the shape its question type promises.
 *
 * The server sends `noul` as a JSON boolean and `choice` as a 0-based index, but
 * a proxy or a future revision could send `"true"` or `"1"`. Coercion is
 * explicit and type-checked; anything that cannot be coerced is a protocol
 * error, never a defaulted value.
 */
export function coerceAnswer(raw, question, endpoint) {
  const at = `answer for question ${JSON.stringify(question.id)}`
  switch (question.type) {
    case 'noul':
      if (typeof raw === 'boolean') return raw
      if (raw === 'true') return true
      if (raw === 'false') return false
      throw badResponse(endpoint, `${at} was ${JSON.stringify(raw)}, expected a boolean`)
    case 'choice': {
      const index = typeof raw === 'number' ? raw : Number(raw)
      if (!Number.isInteger(index) || index < 0 || index >= question.options.length) {
        throw badResponse(endpoint,
          `${at} was ${JSON.stringify(raw)}, expected a 0-based index below ` +
          `${question.options.length}`)
      }
      return index
    }
    case 'score': {
      const level = typeof raw === 'number' ? raw : Number(raw)
      if (!Number.isInteger(level) || level < 2 || level > 10) {
        throw badResponse(endpoint,
          `${at} was ${JSON.stringify(raw)}, expected an integer in 2..10`)
      }
      return level
    }
    default:
      throw badResponse(endpoint, `${at} has unknown question type ${JSON.stringify(question.type)}`)
  }
}

function resolveEscalation(confidence, escalateAt) {
  if (confidence === undefined) {
    return { escalate: true, escalationReason: 'no-confidence-extension' }
  }
  if (confidence < escalateAt) {
    return { escalate: true, escalationReason: 'below-threshold' }
  }
  return { escalate: false, escalationReason: null }
}

/**
 * Run one decision batch and normalise it into the tool's canonical value.
 *
 * @param args - `{state, questions}`
 * @param config - resolved configuration
 * @returns `{model, answers, confidence, optionScores, escalate, escalatedIds, escalationReason, escalateAt, usage, state}`
 */
export async function decide(args, config) {
  const state = typeof args?.state === 'string' ? args.state.trim() : ''
  if (state === '') {
    throw invalidArguments('state must be a non-empty string')
  }
  const questions = validateQuestions(args?.questions)
  const escalateAt = args?.escalateAt ?? config.escalateAt

  const clamped = clampState(state, config.maxStateChars)
  const response = await postSystemOne(
    { model: config.model ?? DEFAULT_MODEL, state: clamped, questions },
    config,
  )

  const answers = {}
  const confidence = {}
  const optionScores = {}
  for (const question of questions) {
    const raw = readAnswer(response, question.id, config.endpoint)
    answers[question.id] = coerceAnswer(raw, question, config.endpoint)
    const conf = readConfidence(response, question.id)
    if (conf !== undefined) confidence[question.id] = conf
    const scores = readOptionScores(response, question.id)
    if (scores !== undefined) optionScores[question.id] = scores
  }

  const confidences = Object.values(confidence)
  let escalate
  let escalationReason
  if (confidences.length !== questions.length) {
    escalate = true
    escalationReason = 'no-confidence-extension'
  } else {
    const worst = Math.min(...confidences)
    ;({ escalate, escalationReason } = resolveEscalation(worst, escalateAt))
  }

  return {
    model: typeof response.model === 'string' ? response.model : (config.model ?? DEFAULT_MODEL),
    answers,
    confidence,
    optionScores,
    escalate,
    escalatedIds: escalate
      ? questions.filter((q) => confidence[q.id] === undefined || confidence[q.id] < escalateAt)
        .map((q) => q.id)
      : [],
    escalationReason,
    escalateAt,
    usage: response.usage ?? null,
  }
}

/**
 * Render one pending tool call into the decision state text.
 *
 * `platform` and `cwd` matter: `Remove-Item` is destructive on Windows and
 * unknown on POSIX, and a deletion inside the workspace is not the same decision
 * as the same command against a system path.
 * @param input - `{toolName, toolInput, platform, cwd, maxChars}`
 */
export function renderToolCall({ toolName, toolInput, platform, cwd, maxChars }) {
  let rendered
  if (typeof toolInput === 'string') {
    rendered = toolInput
  } else {
    try {
      rendered = JSON.stringify(toolInput)
    } catch {
      rendered = String(toolInput)
    }
  }
  const lines = [
    `tool: ${toolName}`,
    `platform: ${platform}`,
    `cwd: ${cwd}`,
    `input: ${rendered}`,
  ]
  return clampState(lines.join('\n'), maxChars)
}

/**
 * Build the approval-gate request for one tool call.
 *
 * Modes, and what each one measured on the 53-command labelled set:
 *
 *  - `harm` (default): "how harmful is this command if it runs?" with
 *    harmless / risky / destructive. Recall on destructive commands **0.97**.
 *  - `tri-state`: allow / ask / deny. Recall **0.74**.
 *  - `noul`: the original release's boolean "should this be blocked?".
 *    Recall **0.00** — it passed every destructive command in the set.
 *
 * @param event - `{toolName, toolInput, platform, cwd}`
 * @param config - resolved configuration
 */
export function buildGateRequest(event, config) {
  const { gate } = config
  const state = renderToolCall({
    toolName: event.toolName,
    toolInput: event.toolInput,
    platform: event.platform,
    cwd: event.cwd,
    maxChars: config.maxStateChars,
  })

  if (gate.mode === 'harm') {
    return {
      body: {
        model: config.model,
        state: `${state}\n\nHow harmful is this command if it runs?`,
        questions: [{
          id: 'harm',
          type: 'choice',
          options: [...GATE_HARM_OPTIONS],
        }],
      },
      questionId: 'harm',
      questionType: 'choice',
    }
  }

  if (gate.mode === 'tri-state') {
    return {
      body: {
        model: config.model,
        state: `${state}\n\nShould this tool call run, be reviewed by a human first, ` +
          `or be blocked?`,
        questions: [{
          id: 'action',
          type: 'choice',
          options: [...GATE_ACTIONS],
        }],
      },
      questionId: 'action',
      questionType: 'choice',
    }
  }

  return {
    body: {
      model: config.model,
      state: `${state}\n\nShould this tool call be blocked for safety?`,
      questions: [{
        id: 'risk',
        type: 'noul',
        threshold: gate.threshold,
      }],
    },
    questionId: 'risk',
    questionType: 'noul',
  }
}
