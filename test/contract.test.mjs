/**
 * Tool-definition contract tests.
 *
 * These replicate the checks the DSH tool registry performs when a definition is
 * registered and when its schema is projected for the model. They exist because
 * a definition that looks fine in isolation still fails at host boot:
 *
 *   dsh: UNKNOWN: tool "phocinae_ask" parameters must be lossless JSON
 *   before schema projection
 *
 * …which is what the first build of this release produced, because the
 * definition carried `inputSchema` where the registry reads `parameters`.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const { createTools } = await import(pathToFileURL(join(ROOT, 'tools.mjs')).href)
const { resolveConfig } = await import(pathToFileURL(join(ROOT, 'lib/config.mjs')).href)
const { assertSupportedJsonSchema, validateJsonSchemaValue } =
  await import(pathToFileURL(join(
    'C:/Users/zzhdz/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules',
    '@deepseek-ai/dsh-tools/lib/index.js',
  )).href).catch(() => ({}))

const TOOLS = createTools(resolveConfig({}), undefined, { platform: 'test', cwd: '/w' })

/** The enforced JSON Schema subset, re-implemented so the test does not depend
 *  on the host being installed. Mirrors `assertSupportedJsonSchema`. */
function assertEnforcedSubset(node, path = 'schema') {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    assert.fail(`${path}: a schema node must be an object`)
  }
  const allowed = new Set(['type', 'oneOf', 'properties', 'required', 'additionalProperties',
    'items', 'enum', 'const', 'description', 'title', 'default', 'examples'])
  for (const key of Object.keys(node)) {
    assert.ok(allowed.has(key), `${path}: unsupported keyword ${JSON.stringify(key)}`)
  }
  if (node.oneOf !== undefined) {
    assert.ok(Array.isArray(node.oneOf) && node.oneOf.length >= 2,
      `${path}.oneOf needs at least two branches`)
    node.oneOf.forEach((branch, index) => assertEnforcedSubset(branch, `${path}.oneOf[${index}]`))
  }
  if (node.type === 'object' || node.properties !== undefined) {
    assert.equal(node.type, 'object', `${path}: properties requires type "object"`)
    if (node.required !== undefined) {
      assert.ok(Array.isArray(node.required) && node.required.every((k) => typeof k === 'string'),
        `${path}.required must be an array of names`)
      for (const key of node.required) {
        assert.ok(Object.hasOwn(node.properties ?? {}, key),
          `${path}.required names ${key}, which is not declared`)
      }
    }
    for (const [key, child] of Object.entries(node.properties ?? {})) {
      assertEnforcedSubset(child, `${path}.properties.${key}`)
    }
  }
  if (node.items !== undefined) {
    assert.equal(node.type, 'array', `${path}: items requires type "array"`)
    assertEnforcedSubset(node.items, `${path}.items`)
  }
}

test('every tool declares exactly the registry-visible fields', () => {
  for (const tool of TOOLS) {
    assert.equal(typeof tool.name, 'string')
    assert.equal(typeof tool.description, 'string')
    assert.equal(typeof tool.execute, 'function')
    assert.equal(typeof tool.output?.schema, 'object')
    assert.equal(typeof tool.output?.render, 'function')
    assert.equal(tool.parameters?.type, 'object',
      `${tool.name}: the registry reads \`parameters\`, not \`inputSchema\``)
    assert.equal(tool.inputSchema, undefined,
      `${tool.name}: \`inputSchema\` is not part of ToolDefinition`)
  }
})

test('parameters stay inside the enforced JSON Schema subset', () => {
  for (const tool of TOOLS) {
    assertEnforcedSubset(tool.parameters, `${tool.name}.parameters`)
    // The host projects the parameters through snapshotJsonValue and rejects
    // author-only keywords such as a per-property `required: true`.
    for (const [key, child] of Object.entries(tool.parameters.properties)) {
      assert.equal(child.required, undefined,
        `${tool.name}.parameters.${key}: \`required: true\` is an author-only keyword`)
    }
    // Losslessness: a structured clone of the schema must round-trip.
    assert.deepEqual(JSON.parse(JSON.stringify(tool.parameters)), tool.parameters)
  }
})

test('output schemas stay inside the enforced JSON Schema subset', () => {
  for (const tool of TOOLS) {
    assertEnforcedSubset(tool.output.schema, `${tool.name}.output.schema`)
    assert.deepEqual(JSON.parse(JSON.stringify(tool.output.schema)), tool.output.schema)
  }
})

test('the host-side schema assertion accepts our parameters when available', (t) => {
  if (typeof assertSupportedJsonSchema !== 'function') {
    t.skip('@deepseek-ai/dsh-tools is not installed in this checkout')
    return
  }
  for (const tool of TOOLS) {
    assertSupportedJsonSchema(tool.parameters)
    assertSupportedJsonSchema(tool.output.schema)
  }
})

test('a required parameter is actually required by the projected schema', (t) => {
  const ask = TOOLS.find((tool) => tool.name === 'phocinae_ask')
  assert.deepEqual(ask.parameters.required, ['state', 'questions'])
  const gate = TOOLS.find((tool) => tool.name === 'phocinae_gate')
  assert.deepEqual(gate.parameters.required, ['command'])

  if (typeof validateJsonSchemaValue !== 'function') {
    t.skip('@deepseek-ai/dsh-tools is not installed in this checkout')
    return
  }
  assert.ok(validateJsonSchemaValue(ask.parameters, {}).length > 0)
  assert.deepEqual(validateJsonSchemaValue(ask.parameters, {
    state: 'x',
    questions: [{ id: 'q', type: 'noul' }],
  }), [])
})

test('executors return values their own output schema accepts', async (t) => {
  if (typeof validateJsonSchemaValue !== 'function') {
    t.skip('@deepseek-ai/dsh-tools is not installed in this checkout')
    return
  }
  const original = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    // Answer whatever question id the tool actually asked, so the mock stays
    // honest when a tool's question ids change.
    const body = JSON.parse(init.body)
    const question = body.questions[0]
    return {
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({
        model: 'Phocinae-Largha-150M-v1',
        answers: { [question.id]: question.type === 'choice' ? 0 : true },
        answer_confidence: { [question.id]: 0.93 },
        usage: { input_tokens: 12, output_tokens: 0 },
      }),
    }
  }
  try {
    for (const tool of TOOLS) {
      const args = tool.name === 'phocinae_ask'
        ? { state: 'a decision', questions: [{ id: 'q', type: 'noul' }] }
        : { command: 'git status' }
      const value = await tool.execute(args, { signal: new AbortController().signal })
      const violations = validateJsonSchemaValue(tool.output.schema, value)
      assert.deepEqual(violations, [],
        `${tool.name}: output schema rejected its own value: ${violations.join('; ')}`)
      // The renderer must also accept what the executor produced.
      const blocks = tool.output.render(args, value)
      assert.ok(Array.isArray(blocks) && blocks.length > 0)
      assert.equal(blocks[0].type, 'text')
      assert.equal(typeof blocks[0].text, 'string')
    }
  } finally {
    globalThis.fetch = original
  }
})
