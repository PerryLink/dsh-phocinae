/**
 * dsh-phocinae — a local, non-generative decision layer for DeepSeek Harness.
 *
 * Two contributions:
 *  1. `phocinae_ask` / `phocinae_gate` tools on `ctx.tools`, backed by a local
 *     Phocinae-Largha-150M-v1 server. Every answer carries a calibrated
 *     confidence and an advisory `escalate` flag.
 *  2. An approval gate on the `tools/pre-execute` waterfall that turns the same
 *     judgement into an allow / ask / deny verdict before a tool call runs. It
 *     fails closed: an unreachable or misbehaving service routes the call to a
 *     human instead of letting it through.
 *
 * Mounting contract (see ARCHITECTURE.md for why each piece is shaped this way):
 *  - `ctx.on('tools/pre-execute', ...)` is subscribed in the plugin body, so the
 *    gate is armed the moment the entry activates.
 *  - Tool registration waits for the `tools` service through `ctx.inject`, so the
 *    entry never touches a service it has not declared.
 *  - The plugin body throws only for configuration that cannot be honoured. A
 *    decision-service outage is never a load failure; it is a verdict.
 */
import {
  DEFAULT_ENDPOINT,
  DEFAULT_ESCALATE_AT,
  DEFAULT_MODEL,
  DEFAULT_TIMEOUT_MS,
  GATE_ACTIONS,
} from './lib/constants.mjs'
import { resolveConfig, toolMatches } from './lib/config.mjs'
import { ERROR_CODES, PhocinaeError } from './lib/errors.mjs'
import {
  GATE_REASONS,
  createPreExecuteGate,
  describeExecution,
  resolveDecision,
  toPreToolDecision,
} from './lib/guard.mjs'
import {
  QUESTION_INSTRUCTIONS,
  clampState,
  coerceAnswer,
  decide,
  postSystemOne,
  readAnswer,
  readConfidence,
  readOptionScores,
  renderToolCall,
  validateQuestions,
} from './lib/protocol.mjs'
import { createTools } from './tools.mjs'

export const PLUGIN_ID = 'phocinae'
export const BUNDLE_NAME = 'dsh-phocinae'
export const TOOL_NAMES = Object.freeze(['phocinae_ask', 'phocinae_gate'])

/** The shipped defaults, re-exported so callers can diff against their own. */
export const DEFAULTS = Object.freeze({
  endpoint: DEFAULT_ENDPOINT,
  model: DEFAULT_MODEL,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  escalateAt: DEFAULT_ESCALATE_AT,
})

export {
  GATE_ACTIONS,
  GATE_REASONS,
  ERROR_CODES,
  PhocinaeError,
  QUESTION_INSTRUCTIONS,
  resolveConfig,
  toolMatches,
  // protocol helpers, exported for embedding and for tests
  clampState,
  coerceAnswer,
  decide,
  postSystemOne,
  readAnswer,
  readConfidence,
  readOptionScores,
  renderToolCall,
  validateQuestions,
  // gate helpers
  createPreExecuteGate,
  describeExecution,
  resolveDecision,
  toPreToolDecision,
  createTools,
}

/**
 * Apply the plugin to a context.
 *
 * @param ctx - the plugin context. `ctx.on` is required; `ctx.tools` (reached
 *   through `ctx.inject`) registers the decision tools when the harness composes
 *   a tool registry.
 * @param rawConfig - deployment configuration (already merged by the loader)
 * @returns the plugin descriptor, for diagnostics and tests
 */
export function apply(ctx, rawConfig = {}) {
  const config = resolveConfig(rawConfig ?? {})
  const logger = ctx?.logger
  const environment = {
    platform: process.platform,
    cwd: process.cwd(),
  }

  const tools = createTools(config, logger, environment)

  if (typeof ctx?.inject === 'function') {
    ctx.inject(['tools'], (toolCtx) => {
      for (const definition of tools) toolCtx.tools.register(definition)
    })
  } else if (ctx?.tools && typeof ctx.tools.register === 'function') {
    // Already scoped to the tool registry (tests, or a host that hands the
    // service in directly). No probe of undeclared names, so this cannot throw.
    for (const definition of tools) ctx.tools.register(definition)
  } else if (logger) {
    logger.warn?.(
      'phocinae: no tool registry on this context — the approval gate is active, ' +
      'but phocinae_ask / phocinae_gate are not registered',
    )
  }

  if (typeof ctx?.on === 'function') {
    ctx.on('tools/pre-execute', createPreExecuteGate(config, logger, environment.platform,
      environment.cwd))
  } else if (logger) {
    logger.warn?.('phocinae: context has no event bus — the approval gate is inactive')
  }

  return Object.freeze({
    id: PLUGIN_ID,
    bundle: BUNDLE_NAME,
    tools: TOOL_NAMES,
    gateEnabled: config.gate.enabled && config.gate.mode !== 'off',
    config,
  })
}

export default apply
