**English** · [中文](./README-zh.md) · [Español](./README-es.md) · [Português](./README-pt.md) · [हिन्दी](./README-hi.md)

# dsh-phocinae

**A local, non-generative decision layer for DeepSeek Harness.**

`phocinae_ask` / `phocinae_gate` tools backed by a [Phocinae-Largha-150M-v1](https://huggingface.co/Phocinae/Phocinae-Largha-150M-v1) server — yes/no judgements, single-choice picks and 2-10 scores, one forward pass each, on your own machine — plus a fail-closed approval gate that screens tool calls before they run.

This is **0.2.2**, a repair release. The 0.1.2 plugin did not activate at all on DSH 0.2.x: the harness logged one warning and the entry died. Everything below the *Fixed in 0.2.2* section is what changed and why.

```sh
dsh plugin --profile <name> add dsh-phocinae@0.2.2
```

Requires Node `^22.19` or `>=24`, and a reachable decision service (see [Running the decision service](#running-the-decision-service)).

### `npm i` alone does not install the plugin

Two separate things have to happen, and only the second one mounts the plugin:

| step | what it does |
|---|---|
| `npm i dsh-phocinae` | Puts the package in **the current directory's** `node_modules`. Useful for reading the code or importing the guard directly. It does **not** reach any DSH profile. |
| `dsh plugin --profile <name> add dsh-phocinae@0.2.2` | Adds it to **that profile's** `package.json` (`dependencies` **and** `dsh.profile.bundles`) and installs it there with pnpm. This is what makes the host mount it. |

Measured on this machine, with a throwaway `DSH_HOME`:

- `npm i dsh-phocinae` in an unrelated directory → installed there, profile `dependencies` still `{}`, profile `bundles` unchanged, **plugin absent from `dsh <profile> --dump-config`**;
- `dsh plugin --profile p add dsh-phocinae` → the profile gains both the dependency and the bundle entry, and the composed config contains the `phocinae` row with its endpoint;
- a dependency **without** the `dsh.profile.bundles` entry → installed but **not mounted**, because the bundle list is what the loader walks.

### Pin the version

`add dsh-phocinae` resolves through pnpm's supply-chain age gate
(`minimumReleaseAge`). A release younger than the gate's threshold is not
selected, so **for a while after a publish the bare name resolves to the previous
version** — and the previous version here is 0.1.2, which does not work.

Measured, minutes apart, on the same machine:

| when | command | resolved to |
|---|---|---|
| order 0.2.2 published + 2 min | `dsh plugin --profile p add dsh-phocinae` | **0.1.2** — `main: index.js`, the build that cannot activate |
| same, but `add dsh-phocinae@0.2.2` | | **0.2.2** — `./index.mjs`, skill present |
| same, bare add with `minimumReleaseAge: 0` in the profile's `pnpm-workspace.yaml` | | **0.2.2** |
| order 0.2.2 published + 150 min | `dsh plugin --profile p add dsh-phocinae` | **0.2.2** — `^0.2.2`, host boots clean |

When the gate holds a version back, the harness records the refusal in the
profile's `pnpm-workspace.yaml`:

```yaml
minimumReleaseAgeExclude:
  - dsh-phocinae@0.2.2
```

The gate is a sound default — a freshly published package is exactly what a
supply-chain attack looks like. It does mean **the version should be named**, both
to get the fixed build immediately and to make an install reproducible:

```sh
dsh plugin --profile <name> add dsh-phocinae@0.2.2
```

If a bare add does land you on 0.1.2, `dsh <profile> --dump-config` shows which
version is mounted, and re-adding with the pinned spec replaces it.

Git and local checkouts work the same way, and pin by construction:

```sh
dsh plugin --profile <name> add github:Phocinae/dsh-phocinae#v0.2.2
dsh plugin --profile <name> add /path/to/a/local/checkout
```

---

## What it contributes

| contribution | seam | what it does |
|---|---|---|
| `phocinae_ask` | `ctx.tools` | Runs a batch of typed questions against the local model. Every answer carries a calibrated confidence and an advisory `escalate` flag. |
| `phocinae_gate` | `ctx.tools` | Judges one command or action: `allow` / `ask` / `deny`, with confidence. Checks an action without running it. |
| approval gate | `tools/pre-execute` waterfall | Screens every tool call the configured patterns cover, before it executes. |
| `phocinae` skill | `ctx.skills` | Teaches the model when a local decision is the right tool, how to phrase one, and how to read the `escalate` flag. |

The model is not a chat model. It does not generate text, does not know facts, and cannot write code. It makes one structured decision per forward pass, which is exactly what a gate needs and nothing more.

---

## Fixed in 0.2.2

Every item below is reproduced by a test in `test/regressions.test.mjs`, named `D1`…`D12`.

### D1 — the plugin never activated

```
dsh: warning: 1 entry did not activate
phocinae (dsh-phocinae): Error: cannot get property "registerTool" without inject
```

`index.js` probed `typeof ctx.registerTool === 'function'` as a defensive check. A Cordis context is a proxy: reading an **undeclared** service name throws instead of returning `undefined`. `registerTool` is not a DSH service — the registry lives at `ctx.tools` — so the probe threw on the first line of the plugin body, taking the whole entry down before it could subscribe to anything.

**Fixed:** tool registration waits for the service through `ctx.inject(['tools'], …)`. No probe, no undeclared read, and if the service never appears the plugin still arms its gate.

### D2 — the tool definition was the wrong shape

The definition carried `{inputSchema, handler}`. `ToolDefinition` extends `ToolSchema`, which declares `{name, description, parameters}`, and the registry reads `definition.parameters`. Registering the old shape fails the model-facing projection:

```
dsh: UNKNOWN: tool "phocinae_ask" parameters must be lossless JSON before schema projection
```

**Fixed:** definitions now carry `parameters` and `output: {schema, render}` plus `execute`, all inside the harness's enforced JSON Schema subset (`required` as an array, `oneOf` for unions, no author-only keywords). `test/contract.test.mjs` re-implements that subset check, and the assembled-headless run registers the definitions in a real host.

### D3 — the gate read the answer from the wrong place

`data.answers` is an object keyed by question id. 0.1.2 did `Array.isArray(data.answers) ? data.answers[0] : …`, which is `undefined` for every real response.

### D4 — and therefore allowed everything, silently

The verdict test was `if (risk === true)`. With `risk` always `undefined`, that is always false, so `guard()` returned `{decision: 'allow'}` with the reason *"the model judged this low risk"* — for every command, including `rm -rf /`.

On the 53-command labelled set in `bench/`, recall on destructive commands was **0.00**.

**Fixed:** answers are read by id and shape-checked, a malformed body is a protocol error rather than a default, and the gate **fails closed** — an unreachable service, a missing confidence extension, or an unreadable body all route to a human.

### D5 — verdicts were thrown, not returned

The deny path called `next(err)`. The `tools/pre-execute` waterfall expects a `PreToolDecision` (`{kind: 'allow' | 'deny' | 'ask', reason}`); rejecting the waterfall is not a decision.

**Fixed:** `{kind: 'deny', reason}` and `{kind: 'ask', reason, displayReason}`, with `next()` called exactly once on the allow path.

### D6 — `gate.tools` defaulted to `['bash']`

The shell tool is `pwsh` on Windows, `bash` elsewhere, and MCP servers add their own names. On this machine the default matched nothing, so the gate never ran.

**Fixed:** the default is `['*']` — every tool — with exact names, `*` globs, and case-insensitive matching available.

### D7 — the escalation gate the release notes promised was not there

The model release documents an E1 gate: escalate a decision to a larger model when `answer_confidence` falls below τ. `0.1.2` contained no τ, no confidence comparison, and no escalation branch — a repository-wide search for `escalate` found only the Python server.

**Fixed:** `phocinae_ask` returns `escalate`, `escalatedIds`, `escalationReason` and `escalateAt`, and the gate consults the same confidence. The plugin still does not *perform* the escalation — it cannot call a large model on your behalf — but the signal is now produced rather than claimed.

### Breaking changes

| change | 0.1.2 | 0.2.2 |
|---|---|---|
| tool registry | `ctx.registerTool` / `ctx.tools.register` probe | `ctx.inject(['tools'], …)` |
| tool definition | `inputSchema` + `handler` | `parameters` + `output` + `execute` |
| gate answer source | `answers[0]` (array) | `answers[id]` (object) |
| failure direction | always `allow` | `ask` by default (`gate.failMode`) |
| tool match default | `['bash']` | `['*']` |
| verdict | `next(err)` | `{kind, reason}` |
| gate question | boolean `noul` | harm scale (`harmless`/`risky`/`destructive`) |
| `gate.mode` default | `deny` | `harm` |
| escalation | absent | `escalate` on every answer |

`gate.failMode: 'open'` restores the old always-allow behaviour for a deployment that wants it. It is not the default and should not become one.

---

## Measured behaviour

The measured figures were produced on one machine (CPU, fp32) against the released weights, with the scripts in `bench/`; re-run them on your own hardware before relying on them. The published figures come from the model release's own documents.

**Version anchors.** v1.0 — first published figures. v1.0 corrected — E1 numbers corrected (kept-subset 0.886, −54.4% LLM calls, 45.7% escalate). v1.1 (2026-10-09) — release of record (0.906 / 0.848, 45.0% escalated / −55.0% calls, kept-subset 0.9936). The pre-correction reading (0.7948 / −82% / 18%) is deprecated upstream — do not cite.

### Decision quality — the model is honest

`datasets/typed_test/test_typed_400.jsonl`, 400 cases × 5 questions = 2000 decisions, judged per decision against `gold.label`:

| metric | published (en) | measured (en) | published (zh) | measured (zh) |
|---|---|---|---|---|
| local accuracy | 0.906 | **0.7825** | 0.848 | **0.7820** |
| escalation rate @ τ=0.6 | 45.0% | **45.65%** | — | **43.00%** |
| accuracy on kept decisions | — | 0.8859 | — | 0.9035 |

The zh figures are machine-translated cases; the training mix includes machine-translated Chinese (≈2,400 rows) plus native Chinese (≈1,400 rows) — an in-mix (fitted) evaluation, not cross-lingual transfer.

The measured column is this repository's 2026-10-08 audit (pre-v1.1 weights) and is retained unchanged — audit numbers are not rewritten, and v1.1 was not re-measured here; see the version anchors for the v1.1 figures. The *"79.6% fewer LLM calls"* saving belongs to **τ≈0.50**, while the frozen E1 gate is **τ=0.6** (τ is swept on the eval set — re-scan per domain; the sweep below is the retained 2026-10-08 measurement):

| τ | escalated | LLM calls cut | accuracy on decisions kept local |
|---|---|---|---|
| 0.50 | 17.15% | **82.8%** | 0.8214 |
| **0.60** | **45.65%** | **54.4%** | 0.8859 |
| 0.70 | 67.15% | 32.9% | 0.9300 |
| 0.80 | 81.70% | 18.3% | 0.9645 |

**"79.6% saved" and "τ=0.6" cannot both be true.** At the threshold the model release calls frozen, the reduction is 55.0%. That is still a real saving, and the confidence ordering is genuinely useful — accuracy on what stays local climbs from 0.78 to 0.96 as the bar rises — but the headline number belongs to a different threshold.

### Gate quality — and why the default question changed

`bench/gate-bench.mjs`, 53 commands (31 destructive, 22 routine), all against the real model. `recall` is the share of destructive commands the gate stops; `auto-pass purity` is how often a passed command was actually safe.

| gate question | recall on destructive | confident passes that were destructive |
|---|---|---|
| `noul` — "should this be blocked?" (0.1.2's default) | **0.00** | — |
| `tri-state` — allow / ask / deny | **0.74** | 1 |
| **`harm` — harmless / risky / destructive (0.2.2 default)** | **0.97** | **0** |

The inherited boolean question is not merely weak, it is inverted: it passed **every one of the 31 destructive commands**, most with confidence between 0.54 and 0.80. Asking "is this safe?" is worse still — 27 of 31 passed with confidence as high as 0.87. The harm scale is the only formulation measured that both caught almost everything and never confidently waved a destructive command through.

Its one miss, `vssadmin delete shadows /all /quiet`, is caught by the auto-allow list's operator rule rather than by confidence, so no destructive command in the set reaches execution.

### Confidence is compressed: keep the gate narrow

The model's confidence does not separate routine commands from risky ones well enough to be a general-purpose filter. Its `harmless` verdicts sit mostly in 0.27–0.54, so a gate that asked it about `git status` would send `git status` to a human.

That is why `0.2.2` ships an **auto-allow list**: read-only and build/test commands with no shell operators never reach the model at all. The gate's job is to stop things, not to approve the routine:

- names on the list, no operator → pass locally, no request, no latency
- anything containing `;&|><`$(){}\[\]` etc. → the list is bypassed and the model decides
- model says `destructive` → deny
- model says `risky`, or `harmless` below `gate.minConfidence` → a human decides
- service unreachable → a human decides

An entry containing a shell operator is refused at load time. `git status && rm -rf /` starts with an allow-listed prefix, so accepting such a pattern would build a bypass into the list.

### Honest summary of the claims

| claim | verdict |
|---|---|
| "144.3M bilingual decision model, one forward pass, local" | **true** |
| "typed-decisions en 0.906 / zh 0.848" | **reproduces, as recorded upstream** (0.9055 / 0.848; this repository's retained reading: 0.7825 / 0.7820) |
| "cuts LLM calls by 79.6% with a τ=0.6 confidence gate" | **false as written** — 79.6% is τ≈0.50; at τ=0.6 it is 55.0% |
| "escalation improves combined accuracy to 0.8737" | **consistent** — escalation only replaces wrong local answers |
| "the plugin provides this gate" | **was false for 0.1.2** (recall 0.00, and it never loaded) |

---

## Configuration

Defaults live in `cordis.patch.yml` and are documented in `lib/config.mjs`. Every key has a default, so the bundle patch can be reduced to `enabled: true`.

| key | default | meaning |
|---|---|---|
| `endpoint` | `http://127.0.0.1:8155/v1/systemone` | decision service. **Loopback only** — the decision state carries raw tool-call text, so a remote host is a load-time error unless `allowRemoteEndpoint: true`. |
| `model` | `Phocinae-Largha-150M-v1` | served model name |
| `timeoutMs` | `3000` | per request; one attempt, no retry |
| `escalateAt` | `0.6` | confidence below this marks an answer `escalate: true` |
| `maxStateChars` | `4096` | cap on the rendered decision state |
| `permuteChoice` | `false` | permutation-average choice questions (4x forwards) |
| `gate.enabled` | `true` | arm the pre-execute gate |
| `gate.mode` | `harm` | `harm` / `tri-state` / `noul` / `off` |
| `gate.threshold` | `0.8` | `noul` mode only: P(risky) that counts as a positive signal |
| `gate.minConfidence` | `0.45` | below this, an `allow` becomes a review |
| `gate.autoAllow` | see `DEFAULT_AUTO_ALLOW` | commands passed without asking the model |
| `gate.tools` | `['*']` | tool names to screen: exact, `*` globs, or `*` |
| `gate.failMode` | `closed` | `closed` = unreachable service asks a human; `open` = allow |
| `gate.riskyDecision` | `deny` | `noul` mode only: `deny` or `ask` on a positive finding |
| `gate.audit` | `true` | log every verdict through the host logger |

To screen nothing and only use the tools:

```yaml
- id: phocinae
  config:
    gate:
      mode: off
```

To screen only the shell, and only ask:

```yaml
- id: phocinae
  config:
    gate:
      tools: ['pwsh', 'bash']
      riskyDecision: ask
```

---

## Running the decision service

The plugin talks to a local server; it does not load weights itself.

```sh
# weights (the reference download is ~330 MB)
huggingface-cli download Phocinae/Phocinae-Largha-150M-v1 --local-dir ./model
# (modelscope hosts the same repo: modelscope download --model PerryLink/Phocinae-Largha-150M-v1)

pip install phocinae-server
PHOC_MODEL_DIR=./model python -m phocinae.main
```

`GET http://127.0.0.1:8155/health` answering `{"status":"ok","model_loaded":true}` means it is up. Without it, `phocinae_ask` returns a `PHOCINAE_SERVICE_UNAVAILABLE` error naming that command, and the gate routes every screened call to a human.

---

## Development

```sh
npm test                  # unit + contract tests, no network, no model
npm run test:integration  # gate over real HTTP, then a real dsh host boot
npm run bench:gate        # the gate benchmark (needs the real service)
```

`npm run test:integration` creates a throwaway `DSH_HOME` under the system temp directory, so it never reads or writes your own profiles. Its first half drives the real gate over real HTTP against a fake service; its second half installs the plugin into that throwaway profile and boots the real `dsh`, asserting that every bundle entry activates — which is the check 0.1.2 would have failed.

The fake service exists because the real one needs a 330 MB checkpoint. Point the harness at a running real service with `--real-endpoint http://127.0.0.1:8155/v1/systemone`.

---

## Documentation

| doc | contents |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | the mounting contract, the gate's decision order, and why each choice was made |
| [SECURITY.md](./SECURITY.md) | trust boundaries, what leaves the machine, and the failure modes |
| [CHANGELOG.md](./CHANGELOG.md) | release history |
| [bench/](./bench) | the benchmark scripts and their saved results |
| [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) | reused work and its licences |

## License

Apache-2.0 — see [LICENSE](./LICENSE). The model weights are Apache-2.0 as well; their card is the authority on the model, this repository is the authority on the plugin.
