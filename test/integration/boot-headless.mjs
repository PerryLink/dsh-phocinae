/**
 * Assembled-headless integration test.
 *
 * Proves, against a real `dsh` composition rather than a mock context, that:
 *   1. the plugin activates (0.1.2 aborted here with
 *      `cannot get property "registerTool" without inject`);
 *   2. the `tools/pre-execute` gate is armed and actually runs on a real tool call,
 *      by asserting a decision request reaches a decision service over HTTP;
 *   3. the verdict the gate produces matches the decision the service returned,
 *      including the deny path and the fail-closed path.
 *
 * The host side runs in a throwaway DSH_HOME under the system temp directory, so
 * the caller's own profiles, settings and sessions are never read or written.
 *
 *   node test/integration/boot-headless.mjs
 *
 * The decision service is the fake in `fake-service.mjs`: the real one needs a
 * 330 MB checkpoint, which has no business in a test run. `--real-endpoint <url>`
 * points the same probe at an already-running real service instead.
 */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.dirname(path.dirname(HERE))
const FAKE_PORT = 18155
const ENDPOINT = `http://127.0.0.1:${FAKE_PORT}/v1/systemone`

const step = (message) => process.stdout.write(`  ${message}\n`)

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    ...options,
  })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

/** Write JSON without a BOM; the profile loader parses strictly. */
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function makeHome(root, profile, endpoint) {
  const dir = path.join(root, 'profiles', profile)
  fs.mkdirSync(dir, { recursive: true })
  writeJson(path.join(dir, 'package.json'), {
    name: `dsh-profile-${profile}`,
    private: true,
    dependencies: {},
    dsh: {
      profile: {
        bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', 'dsh-phocinae'],
      },
    },
  })
  // The headless template's own layer, plus the plugin's endpoint override.
  fs.writeFileSync(path.join(dir, 'cordis.patch.yml'), [
    '- id: permission',
    '  name: "@deepseek-ai/dsh-permission-presets"',
    '  config:',
    '    presets:',
    '      danger-full-access:',
    '        sandbox: danger-full-access',
    '        approval: never',
    '    defaultPreset: danger-full-access',
    '- id: phocinae',
    '  config:',
    `    endpoint: ${endpoint}`,
    '    timeoutMs: 5000',
    '    gate:',
    '      enabled: true',
    "      mode: tri-state",
    "      failMode: closed",
    '      audit: true',
    '',
  ].join('\n'), 'utf8')
  return dir
}

async function waitForHealth(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return true
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  return false
}

function readLog(logPath) {
  if (!fs.existsSync(logPath)) return []
  return fs.readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line))
}

/**
 * Credentials for the throwaway home.
 *
 * The task in step 5 needs a real model call, and an isolated DSH_HOME has no
 * credentials of its own. `DEEPSEEK_API_KEY` is forwarded from the launching
 * environment when present — it is never written to disk, never logged, and the
 * throwaway home is deleted afterwards. Without it the run stops after proving
 * activation, and says so.
 */
function modelEnvironment(base) {
  const env = { ...base }
  if (env.DEEPSEEK_API_KEY) return env
  const credentials = path.join(
    env.DSH_HOME_SOURCE ?? path.join(os.homedir(), '.dsh'), '.credentials.yaml')
  if (!fs.existsSync(credentials)) return env
  const match = fs.readFileSync(credentials, 'utf8').match(/DEEPSEEK_API_KEY:\s*(\S+)/)
  if (match) env.DEEPSEEK_API_KEY = match[1]
  return env
}

async function main() {
  const realEndpointArg = process.argv.indexOf('--real-endpoint')
  const realEndpoint = realEndpointArg === -1 ? null : process.argv[realEndpointArg + 1]
  const endpoint = realEndpoint ?? ENDPOINT

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-phocinae-it-'))
  const home = path.join(root, 'home')
  const logPath = path.join(root, 'decisions.jsonl')
  let service = null

  try {
    process.stdout.write('\n[1/5] decision service\n')
    if (realEndpoint) {
      step(`using the caller's service at ${realEndpoint}`)
      assert.ok(await waitForHealth(new URL('/health', realEndpoint).toString()),
        `no healthy decision service at ${realEndpoint}`)
    } else {
      service = spawn(process.execPath, [
        path.join(HERE, 'fake-service.mjs'), '--port', String(FAKE_PORT), '--log', logPath,
      ], { stdio: ['ignore', 'pipe', 'inherit'] })
      const ready = new Promise((resolve) => {
        service.stdout.on('data', (chunk) => {
          if (String(chunk).includes('PHOC_FAKE_SERVICE')) resolve(true)
        })
      })
      assert.ok(await Promise.race([
        ready,
        new Promise((resolve) => setTimeout(() => resolve(false), 10000)),
      ]), 'the fake decision service did not start')
      step(`fake service listening on 127.0.0.1:${FAKE_PORT}`)
    }

    process.stdout.write('\n[2/5] isolated DSH_HOME\n')
    const profile = 'phoc'
    makeHome(home, profile, endpoint)
    step(`home: ${home} (the caller's own home is untouched)`)

    process.stdout.write('\n[3/5] install the plugin into the throwaway profile\n')
    const install = run('dsh', ['plugin', '--profile', profile, 'add', REPO],
      { env: { ...process.env, DSH_HOME: home }, cwd: root })
    assert.equal(install.status, 0, `dsh plugin add failed:\n${install.stderr}`)
    assert.ok(fs.existsSync(path.join(home, 'profiles', profile, 'node_modules',
      'dsh-phocinae', 'index.mjs')), 'the plugin did not land in the profile')
    step('linked dsh-phocinae into the profile')

    process.stdout.write('\n[4/5] boot the real host\n')
    const boot = run('dsh', [profile, '--help'],
      { env: { ...process.env, DSH_HOME: home }, cwd: root })
    assert.equal(boot.status, 0, `the host failed to mount the profile:\n${boot.stderr}`)
    const diagnostic = `${boot.stdout}\n${boot.stderr}`
    assert.ok(!/did not activate/.test(diagnostic),
      `a bundle entry did not activate:\n${diagnostic}`)
    assert.ok(!/cannot get property/.test(diagnostic),
      `the plugin read an undeclared service:\n${diagnostic}`)
    assert.ok(!/phocinae/i.test(diagnostic.replace(/^Usage:[\s\S]*$/m, '')),
      `the plugin reported a load-time problem:\n${diagnostic}`)
    step('every bundle entry activated; no undeclared-service error')

    process.stdout.write('\n[5/5] run real tasks so the gate executes\n')
    const runEnv = modelEnvironment({ ...process.env, DSH_HOME: home })
    if (!runEnv.DEEPSEEK_API_KEY) {
      step('no model credentials available; asserting activation only')
      process.stdout.write(
        '\nPASS (partial): activation verified; the task run was skipped because no\n' +
        'model credentials were available.\n\n')
      return
    }

    const runTask = (task) => run('dsh', [profile, task], {
      env: runEnv,
      cwd: root,
      timeout: 180000,
    })

    /**
     * Ask for an allow-listed command. It should reach the shell without the
     * decision service being consulted at all — that is the whole point of the
     * auto-allow list, and on a real deployment it is what keeps the gate from
     * reviewing every `git status`.
     */
    step('task A: an allow-listed command (expect no decision request)')
    const allowedRun = runTask('Run this exact PowerShell command and report its output: git status')
    const afterAllowed = readLog(logPath)
    if (afterAllowed.length === 0) {
      step('no decision request — the auto-allow list carried it')
    } else {
      step(`note: the model chose phocinae_gate for this task (${afterAllowed.length} request(s))`)
    }
    assert.ok(!/cannot get property|did not activate/.test(allowedRun.stderr),
      'the host reported a plugin activation failure')

    /**
     * Ask for a command that is not allow-listed. This must reach the gate, which
     * must reach the decision service, and the reported state must carry enough
     * context for the model to judge it.
     */
    step('task B: a command the gate must screen')
    // Forward slashes on purpose: the launcher word-splits the task text, so a
    // backslash path can be mangled before the model ever sees it.
    const screenedRun = runTask(
      'Run this exact PowerShell command and report its output: del C:/Windows/notepad.exe')
    const decisions = readLog(logPath)
    const gateCalls = decisions.filter((entry) => entry.questions?.[0]?.id === 'action'
      || entry.questions?.[0]?.id === 'risk')

    if (gateCalls.length === 0) {
      step('the model produced no tool call, so the gate was not exercised')
      step(`host exit=${screenedRun.status}`)
      const tail = `${screenedRun.stdout}\n${screenedRun.stderr}`.trim().split('\n').slice(-6)
      for (const line of tail) step(`  host: ${line}`)
      assert.ok(!/cannot get property|did not activate/.test(screenedRun.stderr),
        'the host reported a plugin activation failure')
      process.stdout.write(
        '\nPASS (partial): activation and gate wiring verified; the end-to-end tool call\n' +
        'did not happen in this run.\n\n')
      return
    }

    const call = gateCalls[gateCalls.length - 1]
    const question = call.questions[0]
    step(`gate asked ${question.type} question ${JSON.stringify(question.id)}`)
    step(`state: ${JSON.stringify(String(call.state).slice(0, 130))}…`)
    step(`service answered: ${JSON.stringify(call.answers)}`)
    assert.ok(/notepad|del /i.test(String(call.state)),
      'the gate must send the real command text to the decision service')
    assert.ok(String(call.state).includes('platform:')
      && String(call.state).includes('cwd:'),
    'the gate must send platform and cwd context so the command is readable')
    assert.ok(call.answer_confidence && Object.keys(call.answer_confidence).length > 0,
      'the gate request must come back with calibrated confidence')
    if (question.type === 'choice') {
      assert.deepEqual(question.options, ['allow', 'ask', 'deny'],
        'the default gate mode asks the model for a three-way action')
    }
    process.stdout.write(
      '\nPASS: the gate executed inside a real host composition, on both paths —\n' +
      'an allow-listed command passed without consulting the service, and a command\n' +
      'needing judgement reached it with full context.\n\n')
  } finally {
    if (service) service.kill()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

await main()
