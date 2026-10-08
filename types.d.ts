/**
 * Public type surface for dsh-phocinae.
 *
 * The implementation is plain JavaScript; these declarations describe the
 * contract a host or an embedding caller can rely on. They are published but not
 * required at run time.
 */

/** One question kind accepted by the `/v1/systemone` contract. */
export type QuestionType = 'noul' | 'choice' | 'score'

/** A single decision question. */
export interface PhocinaeQuestion {
  /** Unique id within the request; answers and confidences are keyed by it. */
  id: string
  type: QuestionType
  /** `choice` only: the candidate strings, indexed in this order. */
  options?: string[]
  /** `noul` only: answer `true` only when P(true) reaches this value. */
  threshold?: number
}

/** `noul` answers a boolean, `choice` a 0-based option index, `score` an integer 2..10. */
export type PhocinaeAnswer = boolean | number

/** Stable reason codes attached to a gate verdict. */
export type GateReason =
  | 'gate-disabled'
  | 'tool-not-gated'
  | 'command-on-auto-allow-list'
  | 'model-called-it-harmless'
  | 'model-answered-low-risk'
  | 'model-answered-allow'
  | 'model-answered-ask'
  | 'model-called-it-destructive'
  | 'model-answered-deny'
  | 'confidence-below-threshold'
  | 'decision-service-unavailable'
  | 'decision-service-unavailable-fail-open'

/** Gate outcome. */
export type GateDecision = 'allow' | 'ask' | 'deny'

/** Which question the gate asks; see the README for the measured recall of each. */
export type GateMode = 'harm' | 'tri-state' | 'noul' | 'off'

/** What happens when the decision service cannot answer. */
export type FailMode = 'closed' | 'open'

/** Deployment configuration; every field has a default. */
export interface PhocinaeConfig {
  /** Decision service URL. Loopback only unless `allowRemoteEndpoint` is set. */
  endpoint?: string
  /** Served model name. */
  model?: string
  /** Per-request timeout in milliseconds. One attempt, no retry. */
  timeoutMs?: number
  /** Confidence below this marks an answer `escalate: true`. Default 0.6. */
  escalateAt?: number
  /** Cap on the rendered decision state, in characters. Default 4096. */
  maxStateChars?: number
  /** Permutation-average choice questions (4x forwards). Default false. */
  permuteChoice?: boolean
  /** Permit a non-loopback `endpoint`. Default false. */
  allowRemoteEndpoint?: boolean
  gate?: {
    /** Arm the `tools/pre-execute` gate. Default true. */
    enabled?: boolean
    /** Gate question. Default `harm`. */
    mode?: GateMode
    /** `noul` mode only: P(risky) that counts as a positive finding. Default 0.8. */
    threshold?: number
    /** Below this, an `allow` becomes a review. Default 0.45. */
    minConfidence?: number
    /** Commands passed without asking the model. Operators are refused at load. */
    autoAllow?: string[]
    /** Tool names to screen: exact names, `*` globs, or `*`. Default `['*']`. */
    tools?: string[]
    /** Default `closed`: an unreachable service asks a human. */
    failMode?: FailMode
    /** `noul` mode only: `deny` or `ask` on a positive finding. Default `deny`. */
    riskyDecision?: 'deny' | 'ask'
    /** Log every verdict through the host logger. Default true. */
    audit?: boolean
  }
}

/** The canonical value `phocinae_ask` returns. */
export interface PhocinaeAskResult {
  model: string
  /** Question id to its answer. */
  answers: Record<string, PhocinaeAnswer>
  /** Question id to calibrated top probability, when the server exposes it. */
  confidence: Record<string, number>
  /** True when any answer fell below `escalateAt`, or confidence was absent. */
  escalate: boolean
  escalatedIds: string[]
  escalationReason: 'below-threshold' | 'no-confidence-extension' | null
  escalateAt: number
  usage: unknown
}

/** The canonical value `phocinae_gate` returns. */
export interface PhocinaeGateResult {
  decision: GateDecision
  reason: GateReason
  /** What the model said, before the confidence rule was applied. */
  modelDecision: GateDecision
  escalate: boolean
  /** `null` when the server exposes no confidence extension. */
  confidence: number | null
  /** `null` on a normal verdict; the failure text when the service was unusable. */
  error: string | null
}

/** A frozen gate verdict, as produced by the guard. */
export interface GateVerdict {
  decision: GateDecision
  reason: GateReason
  confidence?: number
  escalate: boolean
  modelDecision?: GateDecision
  action?: string
  error?: string
  errorCode?: string
}

/** Error codes carried by `PhocinaeError`. */
export type PhocinaeErrorCode =
  | 'PHOCINAE_SERVICE_UNAVAILABLE'
  | 'PHOCINAE_SERVICE_ERROR'
  | 'PHOCINAE_BAD_RESPONSE'
  | 'PHOCINAE_INVALID_ARGUMENTS'
  | 'PHOCINAE_INVALID_CONFIG'

/** Structured plugin error. */
export declare class PhocinaeError extends Error {
  readonly code: PhocinaeErrorCode
  readonly details: Record<string, unknown>
  constructor(code: PhocinaeErrorCode, message: string, details?: Record<string, unknown>)
}

/** The tool names this plugin registers. */
export declare const TOOL_NAMES: readonly ['phocinae_ask', 'phocinae_gate']
export declare const PLUGIN_ID: 'phocinae'
export declare const BUNDLE_NAME: 'dsh-phocinae'
export declare const DEFAULTS: Readonly<{
  endpoint: string
  model: string
  timeoutMs: number
  escalateAt: number
}>

/** Resolve and validate a partial configuration; throws `PhocinaeError` on an illegal value. */
export declare function resolveConfig(raw?: PhocinaeConfig): Readonly<Required<PhocinaeConfig>>

/** Does `gate.tools` cover this tool name? */
export declare function toolMatches(patterns: readonly string[], toolName: string): boolean

/** The command text out of a tool call's arguments, or `null`. */
export declare function commandOf(toolInput: unknown): string | null

/** The matched auto-allow entry, or `null` when the command must be screened. */
export declare function isAutoAllowed(
  command: unknown,
  autoAllow: readonly string[],
): string | null

/** Run one decision batch. Throws `PhocinaeError` on a transport or protocol failure. */
export declare function decide(
  args: { state: string; questions: PhocinaeQuestion[]; escalateAt?: number },
  config: Readonly<Required<PhocinaeConfig>>,
): Promise<PhocinaeAskResult>

/** Fold a model answer into a verdict; pure. */
export declare function resolveDecision(input: {
  answer: boolean | number
  confidence?: number
  config: Readonly<Required<PhocinaeConfig>>
  questionType: QuestionType
  gateMode?: GateMode
}): GateVerdict

/** Translate a verdict into the harness `PreToolDecision`. */
export declare function toPreToolDecision(result: GateVerdict): unknown

/**
 * Apply the plugin to a host context.
 *
 * `ctx.on` arms the approval gate; the `tools` service, awaited through
 * `ctx.inject`, receives the tool definitions.
 */
export default function apply(ctx: unknown, config?: PhocinaeConfig): Readonly<{
  id: 'phocinae'
  bundle: 'dsh-phocinae'
  tools: readonly string[]
  gateEnabled: boolean
  config: Readonly<Required<PhocinaeConfig>>
}>
