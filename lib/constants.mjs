/**
 * Vocabulary and defaults for the Phocinae decision layer.
 *
 * Zero dependencies on purpose: every other module may import this one, and the
 * approval gate has to keep working even when nothing else in the harness is
 * loadable.
 */

/** Served model name; the server answers 422 for any other value. */
export const DEFAULT_MODEL = 'Phocinae-Largha-150M-v1'

/** Local phocinae-server decision endpoint (loopback only by design). */
export const DEFAULT_ENDPOINT = 'http://127.0.0.1:8155/v1/systemone'

/** One decision on CPU is ~1.5 s single-threaded; 3 s is a full-request budget. */
export const DEFAULT_TIMEOUT_MS = 3000

/**
 * Frozen E1 escalation threshold from the model release.
 *
 * This is the value the published routing numbers were measured at. It is the
 * default for the escalation SIGNAL only; it is not an accuracy claim — see
 * README "Escalation" for the measured escalation rate at this value.
 */
export const DEFAULT_ESCALATE_AT = 0.6

/** Question kinds accepted by the server's /v1/systemone contract. */
export const QUESTION_TYPES = Object.freeze(['noul', 'choice', 'score'])

/** Server-side caps, mirrored here so callers fail locally instead of on a 422. */
export const MAX_QUESTIONS = 64
export const MAX_OPTIONS = 255

/** Tri-state gate actions, ordered as the server renders choice options. */
export const GATE_ACTIONS = Object.freeze(['allow', 'ask', 'deny'])

/**
 * Harm scale used by the default gate formulation.
 *
 * Measured on a 53-command labelled set (31 destructive, 22 routine), this
 * question separates better than any of the six alternatives tried: it flagged
 * 30 of 31 destructive commands, and the single one it passed is caught by the
 * auto-allow list's operator rule. The boolean "should this be blocked?"
 * question that 0.1.2 shipped flagged **none** of them.
 */
export const GATE_HARM_OPTIONS = Object.freeze(['harmless', 'risky', 'destructive'])

/**
 * Gate decision modes.
 *
 * `harm` (default) asks how harmful the command is and treats anything but
 * `harmless` as a signal to stop and look.
 * `tri-state` asks allow / ask / deny — the shape an approval gate seems to want,
 * but measured recall on the same set is 0.74 against `harm`'s 0.97, so it is
 * offered rather than defaulted to.
 * `noul` reproduces the original release's boolean "should this be blocked?"
 * question, which measured recall 0.00. Kept only so an existing deployment can
 * compare old against new on its own traffic.
 * `off` disables local decision-making entirely.
 */
export const GATE_MODES = Object.freeze(['harm', 'tri-state', 'noul', 'off'])

/** Index of the only `harm` answer that passes without further thought. */
export const GATE_HARMLESS_INDEX = 0

/** What to do when the decision service cannot answer. */
export const FAIL_MODES = Object.freeze(['closed', 'open'])

/** Decision outcomes returned by the gate. */
export const DECISIONS = Object.freeze(['allow', 'ask', 'deny'])

/** Escalation outcomes attached to every decision that carries a confidence. */
export const ESCALATION_REASONS = Object.freeze({
  belowThreshold: 'below-threshold',
  noConfidence: 'no-confidence-extension',
  serviceUnavailable: 'service-unavailable',
})

/**
 * Cap on the rendered tool-call text handed to the model.
 *
 * The decision model reads a single `state` string; an unbounded heredoc or
 * base64 blob would blow the encoder budget and, worse, push the actual command
 * out of the window. The head of the command carries the verb and the target,
 * so truncation keeps the head and marks the cut.
 */
export const MAX_STATE_CHARS = 4096

/** Marker appended when a rendered state was truncated. */
export const TRUNCATION_MARK = '\n[truncated]'

/**
 * Commands that skip the model entirely.
 *
 * Measured behaviour drives this list. On a 53-command labelled set the model's
 * tri-state confidence sits in 0.27-0.54 for everything except clearly
 * destructive verbs, so a gate that asked it about `git status` would send
 * `git status` to a human. These patterns are read-only or build/test verbs with
 * no shell metacharacters, so passing them locally is not a judgement call.
 *
 * A pattern that contains a shell operator character is refused at
 * configuration time: `git status && rm -rf /` must never match an allow entry.
 */
export const DEFAULT_AUTO_ALLOW = Object.freeze([
  'git status',
  'git log',
  'git diff',
  'git show',
  'git branch',
  'git fetch',
  'git remote -v',
  'git rev-parse',
  'git describe',
  'git blame',
  'git stash list',
  'git config --get',
  'git ls-files',
  'git shortlog',
  // Windows PowerShell read verbs
  'Get-ChildItem',
  'Get-Content',
  'Get-Item',
  'Get-ItemProperty',
  'Get-Process',
  'Get-Service',
  'Get-Date',
  'Get-Location',
  'Get-Command',
  'Get-Help',
  'Get-Member',
  'Get-FileHash',
  'Get-Acl',
  'Test-Path',
  'Test-Connection',
  'Select-String',
  'Measure-Object',
  'Resolve-Path',
  'Split-Path',
  'Join-Path',
  'Compare-Object',
  'Where-Object',
  'Sort-Object',
  'Select-Object',
  // POSIX read verbs
  'ls',
  'cat',
  'head',
  'tail',
  'wc',
  'pwd',
  'whoami',
  'hostname',
  'stat',
  'file',
  'grep',
  'rg',
  'fd',
  'find',
  'which',
  'whereis',
  'type',
  'env',
  'printenv',
  'uname',
  'df',
  'du',
  'ps',
  'date',
  'echo',
  'true',
  'sleep',
  // build / test / inspect runners
  'npm test',
  'npm run test',
  'npm run lint',
  'npm run build',
  'npm run typecheck',
  'npm ci',
  'npm ls',
  'npm view',
  'pnpm test',
  'pnpm run build',
  'pnpm install',
  'yarn test',
  'node --version',
  'node --test',
  'python --version',
  'python -m pytest',
  'python -m unittest',
  'pip list',
  'pip show',
  'pytest',
  'go test',
  'go build',
  'go vet',
  'cargo build',
  'cargo test',
  'cargo check',
  'dotnet build',
  'dotnet test',
  'make',
  'tsc',
])

/**
 * Characters that make a command ineligible for the auto-allow list.
 *
 * Each of these can chain, substitute, redirect, or background a second
 * command, so a prefix match on the first word says nothing about the rest.
 */
export const SHELL_OPERATOR_PATTERN = /[;&|><`$(){}\[\]\n\r\\!]|\|\||&&|\$\$|>>|<</

