/**
 * Configuration resolution and validation.
 *
 * Resolution is total: every field has a documented default, so an empty config
 * from a bundle patch is valid. Validation is strict and loud — an illegal value
 * throws {@link invalidConfig} at load time rather than silently degrading a
 * security-relevant gate at run time (the failure mode the previous release had).
 */
import {
  DEFAULT_AUTO_ALLOW,
  DEFAULT_ENDPOINT,
  DEFAULT_ESCALATE_AT,
  DEFAULT_MODEL,
  DEFAULT_TIMEOUT_MS,
  FAIL_MODES,
  GATE_MODES,
  MAX_STATE_CHARS,
  SHELL_OPERATOR_PATTERN,
} from './constants.mjs'
import { invalidConfig } from './errors.mjs'

/** Hosts treated as loopback. The decision service is a local process. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

export const DEFAULT_CONFIG = Object.freeze({
  endpoint: DEFAULT_ENDPOINT,
  model: DEFAULT_MODEL,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  /** Confidence below this is reported as `escalate: true`. Signal only. */
  escalateAt: DEFAULT_ESCALATE_AT,
  /** Cap on the rendered decision state (characters). */
  maxStateChars: MAX_STATE_CHARS,
  /** Ask the server to permutation-average choice questions. Costs 4x forwards. */
  permuteChoice: false,
  gate: Object.freeze({
    enabled: true,
    mode: 'harm',
    /** P(risky) at or above this is a positive risk signal in `noul` mode. */
    threshold: 0.8,
    /** Confidence below this makes the gate fall back to `ask` (humans decide). */
    escalateAt: DEFAULT_ESCALATE_AT,
    /** Tool names to gate: exact names, `*` wildcards, or `*` for everything. */
    tools: Object.freeze(['*']),
    /** `closed` = unreachable service routes to a human; `open` = allow. */
    failMode: 'closed',
    /** What a confident risky verdict does: block, or send to a human. */
    riskyDecision: 'deny',
    /**
     * Minimum confidence for an `allow` verdict to pass without review.
     *
     * The model's confidence is compressed — measured on a 53-command labelled
     * set its tri-state `allow` verdicts ran 0.27-0.54 — so demanding a high bar
     * here would route every trivially safe command to a human. Escalation for
     * the `phocinae_ask` tool stays at {@link escalateAt}; this knob exists for
     * the gate, where the cost of a false review is paid on every command.
     */
    minConfidence: 0.45,
    /**
     * Commands passed locally without asking the model at all. See
     * {@link DEFAULT_AUTO_ALLOW} for why the default list exists.
     */
    autoAllow: DEFAULT_AUTO_ALLOW,
    /** Log every gate verdict to the host logger. */
    audit: true,
  }),
})

function fail(message, details) {
  throw invalidConfig(message, details)
}

function requireBoolean(value, path) {
  if (typeof value !== 'boolean') {
    fail(`${path} must be a boolean, got ${JSON.stringify(value)}`)
  }
  return value
}

function requireUnitInterval(value, path) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    fail(`${path} must be a number in [0, 1], got ${JSON.stringify(value)}`)
  }
  return value
}

function requirePositiveInt(value, path) {
  if (!Number.isInteger(value) || value <= 0) {
    fail(`${path} must be a positive integer, got ${JSON.stringify(value)}`)
  }
  return value
}

function requireEnum(value, allowed, path) {
  if (!allowed.includes(value)) {
    fail(`${path} must be one of ${allowed.map((v) => JSON.stringify(v)).join(', ')}, ` +
      `got ${JSON.stringify(value)}`)
  }
  return value
}

/**
 * Validate the endpoint and confine it to loopback.
 *
 * The decision state is the raw text of the user's tool calls. Sending that to a
 * remote host would be an egress decision the plugin has no business making on
 * the user's behalf, so a non-loopback endpoint is a load-time configuration
 * error with an explicit escape hatch documented in SECURITY.md.
 */
function resolveEndpoint(raw) {
  let url
  try {
    url = new URL(String(raw))
  } catch {
    fail(`endpoint must be an absolute URL, got ${JSON.stringify(raw)}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    fail(`endpoint must use http or https, got ${JSON.stringify(url.protocol)}`)
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    fail(
      `endpoint host ${JSON.stringify(url.hostname)} is not loopback. The decision ` +
        `state carries raw tool-call text, so a remote endpoint would leak it. ` +
        `Set \`allowRemoteEndpoint: true\` if that egress is intended.`,
      { hostname: url.hostname },
    )
  }
  return url.toString()
}

function resolveTools(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    fail(`gate.tools must be a non-empty array of tool names, got ${JSON.stringify(raw)}`)
  }
  for (const entry of raw) {
    if (typeof entry !== 'string' || entry.trim() === '') {
      fail(`gate.tools entries must be non-empty strings, got ${JSON.stringify(entry)}`)
    }
  }
  return raw.map((entry) => entry.trim())
}

/**
 * Validate the auto-allow list.
 *
 * An entry containing a shell operator is refused outright: `git status && rm -rf /`
 * starts with an allow-listed prefix, so accepting such a pattern would create a
 * bypass. Failing at load time is the only safe response.
 */
function resolveAutoAllow(raw) {
  if (!Array.isArray(raw)) {
    fail(`gate.autoAllow must be an array of command prefixes, got ${JSON.stringify(raw)}`)
  }
  const entries = []
  for (const entry of raw) {
    if (typeof entry !== 'string' || entry.trim() === '') {
      fail(`gate.autoAllow entries must be non-empty strings, got ${JSON.stringify(entry)}`)
    }
    const trimmed = entry.trim()
    if (SHELL_OPERATOR_PATTERN.test(trimmed)) {
      fail(
        `gate.autoAllow entry ${JSON.stringify(trimmed)} contains a shell operator. ` +
          `An allow entry is matched against the whole command, so an operator would ` +
          `let a second, unchecked command ride along.`,
        { entry: trimmed },
      )
    }
    entries.push(trimmed)
  }
  return entries
}

/**
 * Resolve a caller-supplied config into a complete, validated configuration.
 * @param raw - partial config from the bundle patch, profile patch, or tests
 * @returns frozen configuration object
 */
export function resolveConfig(raw = {}) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    fail(`config must be an object, got ${JSON.stringify(raw)}`)
  }

  const allowRemoteEndpoint = raw.allowRemoteEndpoint === undefined
    ? false
    : requireBoolean(raw.allowRemoteEndpoint, 'allowRemoteEndpoint')

  let endpoint
  if (allowRemoteEndpoint) {
    try {
      endpoint = new URL(String(raw.endpoint ?? DEFAULT_ENDPOINT)).toString()
    } catch {
      fail(`endpoint must be an absolute URL, got ${JSON.stringify(raw.endpoint)}`)
    }
  } else {
    endpoint = resolveEndpoint(raw.endpoint ?? DEFAULT_ENDPOINT)
  }

  const gateRaw = raw.gate ?? {}
  if (gateRaw === null || typeof gateRaw !== 'object' || Array.isArray(gateRaw)) {
    fail(`gate must be an object, got ${JSON.stringify(gateRaw)}`)
  }

  const rawModel = raw.model === undefined ? DEFAULT_MODEL : raw.model
  if (typeof rawModel !== 'string' || rawModel === '') {
    fail(`model must be a non-empty string, got ${JSON.stringify(raw.model)}`)
  }

  const config = {
    endpoint,
    model: rawModel,
    timeoutMs: raw.timeoutMs === undefined
      ? DEFAULT_TIMEOUT_MS
      : requirePositiveInt(raw.timeoutMs, 'timeoutMs'),
    escalateAt: raw.escalateAt === undefined
      ? DEFAULT_ESCALATE_AT
      : requireUnitInterval(raw.escalateAt, 'escalateAt'),
    maxStateChars: raw.maxStateChars === undefined
      ? MAX_STATE_CHARS
      : requirePositiveInt(raw.maxStateChars, 'maxStateChars'),
    permuteChoice: raw.permuteChoice === undefined
      ? false
      : requireBoolean(raw.permuteChoice, 'permuteChoice'),
    allowRemoteEndpoint,
    gate: {
      enabled: gateRaw.enabled === undefined
        ? DEFAULT_CONFIG.gate.enabled
        : requireBoolean(gateRaw.enabled, 'gate.enabled'),
      mode: gateRaw.mode === undefined
        ? DEFAULT_CONFIG.gate.mode
        : requireEnum(gateRaw.mode, GATE_MODES, 'gate.mode'),
      threshold: gateRaw.threshold === undefined
        ? DEFAULT_CONFIG.gate.threshold
        : requireUnitInterval(gateRaw.threshold, 'gate.threshold'),
      escalateAt: gateRaw.escalateAt === undefined
        ? DEFAULT_CONFIG.gate.escalateAt
        : requireUnitInterval(gateRaw.escalateAt, 'gate.escalateAt'),
      tools: gateRaw.tools === undefined
        ? [...DEFAULT_CONFIG.gate.tools]
        : resolveTools(gateRaw.tools),
      failMode: gateRaw.failMode === undefined
        ? DEFAULT_CONFIG.gate.failMode
        : requireEnum(gateRaw.failMode, FAIL_MODES, 'gate.failMode'),
      riskyDecision: gateRaw.riskyDecision === undefined
        ? DEFAULT_CONFIG.gate.riskyDecision
        : requireEnum(gateRaw.riskyDecision, ['deny', 'ask'], 'gate.riskyDecision'),
      minConfidence: gateRaw.minConfidence === undefined
        ? DEFAULT_CONFIG.gate.minConfidence
        : requireUnitInterval(gateRaw.minConfidence, 'gate.minConfidence'),
      autoAllow: gateRaw.autoAllow === undefined
        ? [...DEFAULT_AUTO_ALLOW]
        : resolveAutoAllow(gateRaw.autoAllow),
      audit: gateRaw.audit === undefined
        ? DEFAULT_CONFIG.gate.audit
        : requireBoolean(gateRaw.audit, 'gate.audit'),
    },
  }

  return Object.freeze({ ...config, gate: Object.freeze(config.gate) })
}

/**
 * Extract the command text out of a tool call's arguments.
 *
 * Shell tools name this argument `command`; a few harnesses use `cmd` or pass the
 * raw string. Anything else has no auto-allow meaning, so it returns `null` and
 * the model is asked.
 */
export function commandOf(toolInput) {
  if (typeof toolInput === 'string') return toolInput
  if (toolInput === null || typeof toolInput !== 'object') return null
  for (const key of ['command', 'cmd', 'script', 'CommandLine']) {
    if (typeof toolInput[key] === 'string') return toolInput[key]
  }
  return null
}

/**
 * Would this command be passed without asking the model?
 *
 * Returns the matching entry when the command is a plain, operator-free command
 * whose first word is on the list. A command containing any shell operator is
 * never auto-allowed, so `git status && rm -rf /` falls through to the model.
 *
 * @param command - the command text, or a tool-input object
 * @param autoAllow - the configured list
 * @returns the matching prefix, or `null`
 */
export function isAutoAllowed(command, autoAllow) {
  const text = typeof command === 'string' ? command : commandOf(command)
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  if (trimmed === '' || SHELL_OPERATOR_PATTERN.test(trimmed)) return null
  for (const prefix of autoAllow) {
    if (trimmed === prefix || trimmed.startsWith(`${prefix} `)) return prefix
  }
  return null
}

/**
 * Does `gate.tools` cover this tool name?
 *
 * Entries are exact names, `*` for everything, or names containing `*` as a
 * wildcard. Matching is case-insensitive because tool names differ across
 * platforms (`pwsh` on Windows, `bash` elsewhere, MCP names from servers).
 * @param patterns - configured patterns
 * @param toolName - the tool about to execute
 */
export function toolMatches(patterns, toolName) {
  if (typeof toolName !== 'string' || toolName === '') return false
  const name = toolName.toLowerCase()
  for (const raw of patterns) {
    const pattern = raw.toLowerCase()
    if (pattern === '*') return true
    if (!pattern.includes('*')) {
      if (pattern === name) return true
      continue
    }
    // Escape regex metacharacters, then let * span anything.
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
    if (new RegExp(`^${escaped}$`).test(name)) return true
  }
  return false
}
