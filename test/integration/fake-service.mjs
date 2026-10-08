/**
 * Fake Phocinae decision service.
 *
 * Speaks the real `/v1/systemone` contract on a port the OS picks, so an
 * assembled-headless run can exercise the whole host path — plugin activation,
 * tool registration, and the pre-execute gate — without a 330 MB checkpoint.
 * Every request is appended to `--log` as one JSON line, which is what makes the
 * gate's decisions assertable from outside the host process.
 *
 * Run: node test/integration/fake-service.mjs --log <path> [--port 0]
 * On start it prints `PHOC_FAKE_SERVICE {"port":<n>}` to stdout.
 */
import fs from 'node:fs'
import http from 'node:http'

const args = process.argv.slice(2)
function flag(name, fallback) {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}

const logPath = flag('log', '')
const requestedPort = Number(flag('port', '0'))

/**
 * Decide by keyword table, deliberately crude: the harness asserts that the
 * plugin routes the model's answer into the right verdict, not that a fake
 * model is clever. `deny` wins over `allow`, `allow` over `ask`.
 */
const RULES = [
  {
    action: 'deny',
    confidence: 0.97,
    test: /remove-item\s+-recurse|rm\s+-rf|format-volume|clear-disk|vssadmin|bcdedit|disable-?realtime|stop-computer|shutdown|\/grant\s+everyone|lsass|cipher\s+\/w|takeown|taskkill\s+\/f|reg\s+delete|truncate\s+table|delete\s+shadows/i,
  },
  {
    action: 'allow',
    confidence: 0.96,
    test: /^(git\s+(status|log|diff|branch|fetch)|get-childitem|get-content|npm\s+(ci|test|run)|python\s+-m\s+pytest|go\s+test|cargo\s+build|test-path|get-date|get-process|echo)\b/i,
  },
]

function classify(state) {
  for (const rule of RULES) {
    if (rule.test.test(state)) return rule
  }
  return { action: 'ask', confidence: 0.55 }
}

/**
 * Answer in the vocabulary of the question that was asked.
 *
 * The plugin can ask three ways (see lib/constants.mjs GATE_MODES); a fake that
 * only spoke one of them would silently "pass" the integration test for the
 * others by answering out of range.
 */
const VOCABULARY = {
  harm: { allow: 0, ask: 1, deny: 2 },
  'tri-state': { allow: 0, ask: 1, deny: 2 },
  noul: { allow: false, ask: false, deny: true },
}

function answerFor(body) {
  const question = body.questions?.[0] ?? {}
  const verdict = classify(String(body.state ?? ''))
  const answers = {}
  const confidence = {}

  if (question.type === 'choice') {
    const options = question.options ?? []
    const lexical = VOCABULARY.harm
    if (options.includes('harmless')) {
      answers[question.id] = lexical[verdict.action]
    } else if (options.includes('allow')) {
      answers[question.id] = VOCABULARY['tri-state'][verdict.action]
    } else {
      throw new Error(`fake service does not know the option set ${JSON.stringify(options)}`)
    }
  } else if (question.type === 'noul') {
    // `noul` mode asks "should this be blocked?", so true means block.
    answers[question.id] = VOCABULARY.noul[verdict.action]
  } else {
    answers[question.id] = 5
  }
  confidence[question.id] = verdict.confidence

  return {
    model: body.model ?? 'Phocinae-Largha-150M-v1',
    answers,
    usage: { input_tokens: String(body.state ?? '').length, output_tokens: 0 },
    answer_confidence: confidence,
    option_scores: {},
    routing: { model: 'fake', device: 'cpu', perm: 'none', backend: 'test-harness' },
    // annotation for the harness only; a real server sends no such key
    __verdict: verdict.action,
  }
}

const server = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ status: 'ok', model_loaded: true, device: 'cpu' }))
    return
  }
  if (request.method !== 'POST') {
    response.writeHead(404).end()
    return
  }
  const chunks = []
  request.on('data', (chunk) => chunks.push(chunk))
  request.on('end', () => {
    let body = {}
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      response.writeHead(400).end()
      return
    }
    const payload = answerFor(body)
    if (logPath) {
      fs.appendFileSync(logPath, `${JSON.stringify({
        url: request.url,
        state: body.state,
        questions: body.questions,
        answers: payload.answers,
        answer_confidence: payload.answer_confidence,
        verdict: payload.__verdict,
      })}\n`)
    }
    delete payload.__verdict
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(payload))
  })
})

server.listen(requestedPort, '127.0.0.1', () => {
  process.stdout.write(`PHOC_FAKE_SERVICE ${JSON.stringify({ port: server.address().port })}\n`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
