# Changelog

## [audit refresh] — 2026-10-09

### Changed

- **The published claims moved to the v1.1 figures; this repository's audit numbers did not
  move.** The five READMEs now state the model's v1.1 numbers — typed-decisions en 0.906 /
  zh 0.848 (was 0.797 / 0.789; zh is machine-translated cases), the E1 gate at τ=0.6 at
  45.0% escalated / −55.0% LLM calls with 79.6% at τ≈0.50 and kept-subset 0.9936 (was
  18% / 82% / 54.4% / 0.886), and the combined-accuracy claim 0.8737 (was 0.7948) — plus the
  version anchors (v1.0 / v1.0 corrected / v1.1; the pre-correction 0.7948 / −82% / 18%
  reading is deprecated upstream — do not cite). `SECURITY.md`: 144M → 144.3M.
- **The audit records are retained and dated, not rewritten.** This repository's own
  2026-10-08 measurements (the measured columns 0.7825 / 0.7820, the τ sweep, the 0.2.1
  report) predate the v1.1 weights and are kept unchanged for audit trace; v1.1 was not
  re-measured here. `bench/compare-upstream.mjs` gained a `rowsV11` group recording the
  v1.1 figures as documented by the release (UNTESTED in this repository where nothing was
  measured); `bench/results/upstream-comparison.json` carries a timeliness field; the 0.2.1
  report is dated as a historical snapshot. Documentation only — no code changes.

## [0.2.2] — 2026-10-08

### Fixed

- The `phocinae` skill is registered again. 0.1.2 shipped
  `skills/phocinae/SKILL.md` with nothing registering it, so the file was inert;
  0.2.0 then dropped it while rewriting the entry point, which was a feature
  regression rather than a cleanup. The body now lives in `lib/skill.mjs` and
  goes through the documented `ctx.skills.register()` surface, awaited through
  `ctx.inject(['skills'], …)` like the tool registry. A host without a skill
  registry is not an error — the tools and the gate are unaffected.

### Changed

- `repository`, `homepage` and `bugs` point at the canonical
  **Phocinae/dsh-phocinae** rather than a personal mirror, so the npm page sends
  readers upstream.

## [0.2.1] — 2026-10-08

No code change from 0.2.0: `lib/guard.mjs` and every other shipped module hash
identically, and the only difference between the two tarballs is the version
string.

0.2.0 was briefly marked deprecated on npm, on the strength of a 404 from the
registry's CDN for its tarball. That 404 was replication lag, not a broken
publish — the tarball serves normally now, and its `lib/guard.mjs` is
byte-identical to this release's — so the notice was withdrawn. 0.2.1 remains
`latest` only because it is the newer of two identical releases.

## [0.2.0] — 2026-10-08

A repair release. `0.1.2` did not activate on DSH 0.2.x, and if it had, its approval
gate would have allowed every command while reporting that the model had judged it
low-risk. Both are fixed, and `test/regressions.test.mjs` names each defect `D1`–`D12`
so a regression is a failing test rather than a silent behaviour change.

### Fixed

- **D1** — the entry no longer reads undeclared service names. `typeof ctx.registerTool`
  threw on a Cordis proxy (`cannot get property "registerTool" without inject`) and took
  the whole plugin down before it subscribed to anything. Tool registration now waits
  for the service through `ctx.inject(['tools'], …)`.
- **D2** — tool definitions carry `parameters` and `output: {schema, render}` with
  `execute`, inside the harness's enforced JSON Schema subset. The previous
  `{inputSchema, handler}` shape failed the model-facing projection with
  `tool "phocinae_ask" parameters must be lossless JSON before schema projection`.
- **D3** — the gate reads `answers[questionId]`. It previously read `answers[0]` on an
  object-keyed map, which is always `undefined`.
- **D4** — consequently the gate now denies. The old verdict test `risk === true` was
  false for `undefined`, so every command was allowed with the reason "the model judged
  this low risk". Measured recall on destructive commands was 0.00; it is 0.97 now.
- **D5** — verdicts are returned as `PreToolDecision` objects (`{kind: 'deny', reason}`,
  `{kind: 'ask', reason, displayReason}`) instead of rejecting the waterfall with
  `next(err)`.
- **D6** — `gate.tools` defaults to `['*']`. The old default was `['bash']`, which
  matches nothing on a Windows host (`pwsh`), silently disabling the gate.
- **D7** — the escalation gate the model release documents now exists. `phocinae_ask`
  returns `escalate`, `escalatedIds`, `escalationReason` and `escalateAt`. Previously the
  plugin contained no τ and no confidence comparison at all.
- The decision service is no longer treated as infallible: a non-2xx status, a non-JSON
  body, an `answers` map that is an array or missing the question, and an answer outside
  the option range are each a structured error. The gate turns all of them into `ask`.
- `state` is clamped (`maxStateChars`, default 4096) so a heredoc or base64 blob cannot
  push the command itself out of the encoder window.

### Changed — breaking

- Tool registry access moved from a `ctx.registerTool` probe to `ctx.inject(['tools'], …)`.
- Tool definition shape: `inputSchema`/`handler` → `parameters`/`output`/`execute`.
- Gate question default: the boolean `noul` question → the harm scale
  (`harmless` / `risky` / `destructive`). Measured recall 0.00 → 0.97.
- `gate.mode` default: `deny` → `harm`.
- Failure direction: always `allow` → `ask` (`gate.failMode: 'closed'`). Set
  `gate.failMode: 'open'` to restore the old behaviour.
- Tool matching default: `['bash']` → `['*']`, with `*` globs and case-insensitive
  matching.
- `phocinae_ask` answers are returned as a map plus a separate `confidence` map; the
  flat shape is gone.

### Added

- `phocinae_gate` tool: judge a command without running it.
- `gate.autoAllow` — commands passed locally without consulting the model, with a
  load-time refusal of any entry containing a shell operator. Without it, a gate that
  asked the model about `git status` would send `git status` to a human: the model's
  confidence is compressed into 0.27–0.54 for correct `harmless` verdicts.
- `gate.minConfidence` (default 0.45) — below it, an `allow` becomes a review.
- `gate.audit` — one log line per verdict, with stable reason codes.
- Loopback enforcement on `endpoint`, with `allowRemoteEndpoint` as the explicit opt-out.
- Configuration validation that throws at activation rather than degrading at run time.
- `bench/` — gate, formulation and separation benchmarks with their saved results.
- `test/integration/` — the real gate over real HTTP, and a real `dsh` host boot in a
  throwaway `DSH_HOME`.

### Documentation

- The README states the measured numbers next to the published ones, including where
  they disagree: the model's "79.6% fewer LLM calls" saving belongs to τ≈0.50, while
  the frozen E1 gate is τ=0.6, where this repository's retained 2026-10-08 measurement
  is 54.4% (en) / 57.0% (zh).
- `SECURITY.md` states plainly that the gate is a screening aid and not a sandbox.

## [0.1.2] — 2026-10-08

- Bundled into the Phocinae organization's release flow.

## [0.1.1] — 2026-10-08

- Packaging fixes.

## [0.1.0] — 2026-10-08

- First release: `phocinae_ask`, an approval gate on `tools/pre-execute`, and a
  `phocinae` skill.

[0.2.1]: https://github.com/PerryLink/dsh-phocinae/releases/tag/v0.2.1
[0.2.0]: https://github.com/PerryLink/dsh-phocinae/releases/tag/v0.2.0
