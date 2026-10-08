/**
 * Tool definitions registered on `ctx.tools`.
 *
 * These are hand-built `ToolDefinition` objects rather than `defineTool(...)`
 * results, so the plugin has no run-time dependency on `@deepseek-ai/dsh-tools`.
 * Two schema facts the registry enforces (discovered by booting a real host):
 *
 *  - The model-facing field is `parameters` (raw JSON Schema), not `inputSchema`.
 *    `ToolSchema`, which `ToolDefinition` extends, declares exactly
 *    `{name, description, parameters}`.
 *  - Both `parameters` and `output.schema` must live inside the harness's
 *    enforced JSON Schema subset: one scalar `type` per node, `required` as an
 *    array of names, `oneOf` for unions, and no author-only keywords such as a
 *    per-property `required: true` (`valueSchemaSpecToJsonSchema` rejects those).
 *
 * `test/contract.test.mjs` asserts both properties, and the assembled-headless
 * integration run registers these definitions in a real host.
 */
import { decide } from './lib/protocol.mjs'
import { GATE_ACTIONS } from './lib/constants.mjs'
import { decideToolCall } from './lib/guard.mjs'

const NULLABLE_NUMBER = { oneOf: [{ type: 'number' }, { type: 'null' }] }
const NULLABLE_STRING = { oneOf: [{ type: 'string' }, { type: 'null' }] }
const STRING_ARRAY = { type: 'array', items: { type: 'string' } }

const QUESTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: {
      type: 'string',
      description: 'Unique id for this question. Answers and confidences are keyed by it.',
    },
    type: {
      type: 'string',
      enum: ['noul', 'choice', 'score'],
      description: 'noul: yes/no. choice: pick one option index. score: integer 2..10.',
    },
    options: {
      ...STRING_ARRAY,
      description: 'choice only: the candidate strings, in the order you want them indexed.',
    },
    threshold: {
      type: 'number',
      description: 'noul only: answer true only when P(true) reaches this value (default 0.5).',
    },
  },
  required: ['id', 'type'],
}

const ASK_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    state: {
      type: 'string',
      description:
        'The full decision context, verbatim. Do not paraphrase, summarise, or drop ' +
        'constraints — wording changes can flip the verdict, and the model has no other input.',
    },
    questions: {
      type: 'array',
      items: QUESTION_SCHEMA,
      description: 'One or more decisions to make against the same state (max 64).',
    },
    escalateAt: {
      type: 'number',
      description:
        'Confidence below this makes the result carry `escalate: true` (default 0.6). ' +
        'Escalation is advisory: the caller decides whether to involve a larger model.',
    },
  },
  required: ['state', 'questions'],
}

const ASK_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    model: { type: 'string' },
    answers: {
      type: 'object',
      additionalProperties: true,
      description: 'Question id mapped to its answer: boolean, option index, or 2..10.',
    },
    confidence: {
      type: 'object',
      additionalProperties: true,
      description: 'Calibrated top probability per question, when the server exposes it.',
    },
    escalate: {
      type: 'boolean',
      description: 'True when any answer fell below the escalation threshold.',
    },
    escalatedIds: STRING_ARRAY,
    escalationReason: NULLABLE_STRING,
    escalateAt: { type: 'number' },
    usage: {
      type: 'object',
      additionalProperties: true,
      description: 'Server-reported token usage; output tokens are always zero.',
    },
  },
  required: ['model', 'answers', 'confidence', 'escalate', 'escalatedIds', 'escalationReason',
    'escalateAt', 'usage'],
}

const GATE_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    command: {
      type: 'string',
      description: 'The exact command or action text to judge, verbatim.',
    },
    toolName: {
      type: 'string',
      description: 'Name of the tool that would run it (default "shell").',
    },
    cwd: {
      type: 'string',
      description: 'Working directory the action would run in. A deletion inside the workspace ' +
        'is a different decision from the same command against a system path.',
    },
  },
  required: ['command'],
}

const GATE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    decision: { type: 'string', enum: [...GATE_ACTIONS] },
    reason: { type: 'string' },
    modelDecision: { type: 'string', enum: [...GATE_ACTIONS] },
    escalate: { type: 'boolean' },
    confidence: NULLABLE_NUMBER,
    error: NULLABLE_STRING,
  },
  required: ['decision', 'reason', 'modelDecision', 'escalate', 'confidence', 'error'],
}

/** Render a nullable number for display. */
function showNumber(value) {
  return value === null || value === undefined ? 'n/a' : Number(value).toFixed(4)
}

/**
 * Build the tool definitions for one plugin instance.
 * @param config - resolved configuration
 * @param logger - optional host logger (`{info, warn}`)
 * @param environment - `{platform, cwd}` recorded in decision states
 */
export function createTools(config, logger, environment = {}) {
  const platform = environment.platform ?? process.platform
  const defaultCwd = environment.cwd ?? process.cwd()

  const askTool = {
    name: 'phocinae_ask',
    description:
      'Make structured decisions with the local Phocinae decision model ' +
      '(Phocinae-Largha-150M-v1): yes/no judgements, single-choice picks, and 2-10 ' +
      'scores — one forward pass each, on your own machine, no text generation. Use it ' +
      'for repeatable, thresholdable checks such as approval pre-screening, triage, ' +
      'routing, risk scoring, and batch classification. Do not use it to write, ' +
      'summarise, or answer knowledge questions. Every result carries a calibrated ' +
      'confidence and an `escalate` flag; when `escalate` is true the answer is the ' +
      "model's best guess and a larger model should decide instead.",
    parameters: ASK_PARAMETERS,
    output: {
      schema: ASK_OUTPUT_SCHEMA,
      render(_args, value) {
        const ids = Object.keys(value.answers)
        const lines = ids.map((id) => {
          const confidence = value.confidence[id]
          const flag = value.escalatedIds.includes(id) ? '  [escalate]' : ''
          return `  ${id} = ${JSON.stringify(value.answers[id])}` +
            `  (confidence ${showNumber(confidence)})${flag}`
        })
        const header = value.escalate
          ? `Local decision model answered, but ${value.escalatedIds.length} of ${ids.length} ` +
            `answer(s) fell below the escalation threshold ${value.escalateAt} ` +
            `(${value.escalationReason}). Treat those as provisional and decide them with a ` +
            `larger model.`
          : `Local decision model answered all ${ids.length} question(s) at or above the ` +
            `escalation threshold ${value.escalateAt}.`
        return [{ type: 'text', text: `${header}\n${lines.join('\n')}` }]
      },
    },
    async execute(args, exec) {
      const result = await decide(args, config)
      if (logger && exec?.signal?.aborted) {
        logger.warn?.('phocinae_ask: the caller aborted after the decision was computed')
      }
      return {
        model: result.model,
        answers: result.answers,
        confidence: result.confidence,
        escalate: result.escalate,
        escalatedIds: result.escalatedIds,
        escalationReason: result.escalationReason,
        escalateAt: result.escalateAt,
        usage: result.usage,
      }
    },
  }

  const gateTool = {
    name: 'phocinae_gate',
    description:
      'Ask the local Phocinae decision model whether one command or action should run, be ' +
      "reviewed by a human, or be blocked. Returns allow / ask / deny with the model's " +
      'confidence. The same judgement drives the automatic pre-execute approval gate; call ' +
      'this tool to check an action you are about to take, without running it.',
    parameters: GATE_PARAMETERS,
    output: {
      schema: GATE_OUTPUT_SCHEMA,
      render(_args, value) {
        const summary = value.decision === 'allow'
          ? 'may run'
          : (value.decision === 'deny' ? 'is blocked' : 'needs human review')
        const error = value.error === null || value.error === undefined
          ? ''
          : ` (${value.error})`
        return [{
          type: 'text',
          text: `Phocinae: this action ${summary} — ${value.reason}, confidence ` +
            `${showNumber(value.confidence)}${error}`,
        }]
      },
    },
    async execute(args) {
      const result = await decideToolCall({
        toolName: typeof args.toolName === 'string' && args.toolName !== ''
          ? args.toolName
          : 'shell',
        toolInput: args.command,
        platform,
        cwd: typeof args.cwd === 'string' && args.cwd !== '' ? args.cwd : defaultCwd,
      }, config)
      return {
        decision: result.decision,
        reason: result.reason,
        modelDecision: result.modelDecision ?? result.decision,
        escalate: Boolean(result.escalate),
        confidence: result.confidence ?? null,
        error: result.error ?? null,
      }
    },
  }

  return [askTool, gateTool]
}
