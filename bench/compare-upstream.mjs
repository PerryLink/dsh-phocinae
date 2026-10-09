/**
 * Diff the upstream Phocinae claims against what this machine measured.
 *
 * TIMELINESS — read this before quoting anything the script prints:
 *   - This is a HISTORICAL comparison, not a live check. The `rows` group holds
 *     the upstream README as fetched 2026-10-08T05:22Z (its v1.0-corrected
 *     revision) against measurements saved under bench/results/ from the same
 *     day; the `rowsV11` group records the 2026-10-09 v1.1 figures as documented
 *     by the release. Nothing is re-fetched and nothing is re-measured — the
 *     script only re-reads evidence that is already in this repository.
 *   - For the figures to cite today, see the version anchors in the five READMEs
 *     (v1.0 / v1.0 corrected / v1.1) together with the `rowsV11` group below.
 *   - Rows whose verdict starts with UNTESTED were never measured here. They stay
 *     UNTESTED until someone actually runs the measurement; do not cite them as
 *     passing.
 *
 * History: the upstream README was rewritten on 2026-10-08 (repo pushed
 * 05:22:52Z) and refreshed again to v1.1 on 2026-10-09.
 *
 * Usage: node bench/compare-upstream.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.dirname(HERE)
const results = (name) => JSON.parse(fs.readFileSync(
  path.join(REPO, 'bench/results', name), 'utf8'))

const tokenSavings = results('token-savings-en.json')
const economics = results('economics.json')
const cost = results('context-cost.json')
const gateModes = results('gate-by-mode.json')
const latency = results('latency.json')

const latencyBy = Object.fromEntries(latency.map((entry) => [entry.label, entry]))
const hybrid = (tau) => economics.hybrid[`hybrid-tau-${tau}`]
const shipped = gateModes[0]

/**
 * Escalation at decision granularity — the granularity upstream publishes.
 * `token-savings-en.json` records one row per decision, so this is a straight
 * pass over it rather than a re-run.
 *
 * The distinction matters and is easy to get wrong: a case carries five
 * decisions, and the hybrid strategy escalates a whole case when any of its
 * decisions is unsure. Case-level escalation therefore runs much higher than
 * decision-level, and only the decision-level number is comparable to the
 * upstream figure.
 */
function decisionLevel(tau) {
  const per = tokenSavings.perDecision
  const escalated = per.filter((d) => d.confidence === null || d.confidence < tau)
  const kept = per.filter((d) => d.confidence !== null && d.confidence >= tau)
  return {
    escalated: escalated.length,
    total: per.length,
    rate: escalated.length / per.length,
    keptAccuracy: kept.filter((d) => d.localOk).length / Math.max(1, kept.length),
    saving: 1 - escalated.length / per.length,
  }
}
const d06 = decisionLevel(0.6)
const d05 = decisionLevel(0.5)

/**
 * Each row: the updated upstream claim, the measurement that tests it, and an
 * independent verdict. `upstream` values are quoted from the README fetched at
 * 2026-10-08T05:22Z.
 */
const rows = [
  {
    claim: 'parameters 144.3M',
    upstream: '144.3M',
    measured: '144,292,867 loaded by phocinae-server',
    verdict: 'AGREES',
  },
  {
    claim: 'typed-decisions en accuracy',
    upstream: '0.797',
    measured: `${tokenSavings.localAccuracy.toFixed(4)} (mixed rendering; 0.7825 under the row set's own rendering, from the earlier run)`,
    verdict: 'AGREES, within the stated fp16/fp32 noise',
  },
  {
    claim: 'escalate gate: LLM-cost reduction at tau=0.6',
    upstream: '-54%  (updated from the withdrawn "82%")',
    measured: `${(d06.saving * 100).toFixed(1)}% of decisions stay local, so ${(d06.saving * 100).toFixed(1)}% ` +
      'of the decision traffic never reaches the API. Measured against a real large model on the ' +
      'same workload the case-level saving is 9.2%, because escalating one unsure decision ' +
      're-sends its whole case — a cost the decision-level figure does not show',
    verdict: 'AGREES at the published granularity; the case-level cost is higher and is ' +
      'disclosed here',
  },
  {
    claim: 'escalation rate at tau=0.6',
    upstream: '45.7%',
    measured: `${(d06.rate * 100).toFixed(1)}% of decisions (${d06.escalated}/${d06.total}); ` +
      `${(tokenSavings.strategies['hybrid-tau-0.6'].escalationRate * 100).toFixed(1)}% of cases, ` +
      'because a case escalates as a unit',
    verdict: 'AGREES (decision granularity)',
  },
  {
    claim: 'kept-subset accuracy at tau=0.6',
    upstream: '0.797 -> 0.886 (kept subset)',
    measured: `${d06.keptAccuracy.toFixed(4)} on decisions kept at tau=0.6 in this run; ` +
      '0.8859 on the like-for-like run that used the row set\'s own rendering',
    verdict: 'AGREES on the like-for-like run',
  },
  {
    claim: '82.8% saving belongs to tau=0.5',
    upstream: 'now disclosed as "(82.8% at tau=0.5)"',
    measured: `${(d05.saving * 100).toFixed(1)}% of decisions kept local at tau=0.5 — ` +
      'and case-level accuracy falls to 0.7065, below both a pure large model (0.7085) ' +
      'and a pure local model (0.7320)',
    verdict: 'AGREES on the number; the README does not mention that tau=0.5 costs ' +
      'accuracy when the large model is weaker than the local one',
  },
  {
    claim: 'CPU single-thread p50 per case',
    upstream: '1.51 s  (stated as ~0.28 s per decision)',
    measured: `${latencyBy['single-thread'].perCaseMs.p50} ms per case ` +
      `(${latencyBy['single-thread'].perDecisionMs} ms per decision), PHOC_THREADS=1`,
    verdict: 'AGREES in order of magnitude; 1.6x faster here',
  },
  {
    claim: 'CPU 8-thread batch throughput',
    upstream: '8-21 decisions/s',
    measured: `${(latencyBy['default-threads'].casesPerSecond * 5).toFixed(1)} decisions/s ` +
      'at default threading (1.08 cases/s single-thread = 5.4 decisions/s)',
    verdict: 'AGREES',
  },
  {
    claim: 'GPU fp16 p50 18.6 ms',
    upstream: '18.6 ms',
    measured: 'not measurable here — no CUDA device is exposed to this server (device: cpu)',
    verdict: 'UNTESTED',
  },
  {
    claim: 'option-order flip robustness',
    upstream: 'flip400 0.0300',
    measured: 'not measured in this round',
    verdict: 'UNTESTED (an earlier audit observed a 0.44 flip rate when the false/true ' +
      'option order of noul questions was reversed, a different protocol from flip400)',
  },
  {
    claim: 'JevBench public-231 0.5108',
    upstream: '0.5108 (118/231), gate not passed',
    measured: 'not measured — the row set is not in this repository',
    verdict: 'UNTESTED',
  },
  {
    claim: 'the plugin provides this gate',
    upstream: 'the dsh-phocinae README still documents the escalate gate 0.1.2 never had',
    measured: 'Phocinae/dsh-phocinae was last pushed 2026-10-08T02:23:13Z; its index.js, ' +
      'hooks/guard.js and tools/phocinae_ask.js are byte-identical to the 0.1.2 audited here',
    verdict: 'STILL UNFIXED UPSTREAM — 0.2.1 in this repository is the only working build',
  },
  {
    claim: 'is it as cheap as "a local decision costs nothing"?',
    upstream: 'not stated',
    measured: `plugin adds ${cost.tokensPerRequest.bothToolDefinitions} tokens to every request ` +
      `plus ${cost.tokensPerRequest.oneCallArguments + cost.tokensPerRequest.oneCallResult} per decision`,
    verdict: 'DISCLOSED HERE ONLY',
  },
  {
    claim: 'is the gate worth its cost for safely?',
    upstream: 'not stated',
    measured: `shipped default stops ${(shipped.recall * 100).toFixed(1)}% of destructive commands ` +
      `(${shipped.destructivePassed} passed of ${shipped.rows.filter((r) => r.label).length}), ` +
      `${shipped.benignReviewed} of ${shipped.rows.filter((r) => !r.label).length} benign sent to review, ` +
      `${shipped.meanMs.toFixed(1)} ms, 0 conversation tokens`,
    verdict: 'DISCLOSED HERE ONLY',
  },
]

/**
 * rowsV11 — the 2026-10-09 v1.1 refresh, held to the same rules.
 *
 * Same shape as `rows`: an upstream claim, what this repository records, a
 * verdict. This repository did not re-measure v1.1 — nothing under
 * bench/results/ was produced with the v1.1 weights — so the `measured` strings
 * quote only what is on record here (the 2026-10-08 audit) or the v1.1 figures
 * as documented by the release, each labelled as such. Anything without such a
 * record is UNTESTED. No value here was re-measured for this group, and none is
 * invented.
 */
const rowsV11 = [
  {
    claim: 'typed-decisions en accuracy (v1.1)',
    upstream: '0.906',
    measured: 'not re-measured in this repository — the v1.1 release documents a cold re-run of 0.9055; the last measurement here is 0.7825, from the 2026-10-08 audit round (pre-v1.1 weights, retained in the README measured column)',
    verdict: 'UNTESTED for v1.1 in this repository — 0.9055 is upstream-recorded only',
  },
  {
    claim: 'typed-decisions zh accuracy (v1.1)',
    upstream: '0.848',
    measured: 'not re-measured in this repository — v1.1 documents 0.848 (machine-translated cases; in-mix/fitted evaluation, not cross-lingual transfer); the retained 2026-10-08 reading is 0.7820',
    verdict: 'UNTESTED for v1.1 in this repository — 0.848 is upstream-recorded only',
  },
  {
    claim: 'escalation rate at tau=0.6 (v1.1)',
    upstream: '45.0%',
    measured: 'not re-measured in this repository — the retained 2026-10-08 audit measured 45.65% of decisions (43.00% zh) at tau=0.6',
    verdict: 'UNTESTED for v1.1 in this repository — prior-round reading retained',
  },
  {
    claim: 'LLM-call reduction at tau=0.6 (v1.1)',
    upstream: '−55.0%',
    measured: 'not re-measured — 55.0% follows from the release-documented 45.0% escalated at tau=0.6; the retained 2026-10-08 sweep measured a 54.4% reduction there',
    verdict: 'UNTESTED for v1.1 in this repository — prior-round 54.4% retained',
  },
  {
    claim: 'kept-subset accuracy at tau=0.6 (v1.1)',
    upstream: '0.9936',
    measured: 'not re-measured — v1.1 documents 0.9936; the retained 2026-10-08 reading is 0.8859',
    verdict: 'UNTESTED for v1.1 in this repository',
  },
  {
    claim: 'the 79.6% headline at tau≈0.50 (v1.1)',
    upstream: '−79.6% at tau=0.5 (20.4% escalated)',
    measured: 'not re-measured — v1.1 documents 20.4% escalated / 79.6% kept local; the retained 2026-10-08 sweep measured 17.15% / 82.8% there',
    verdict: 'UNTESTED for v1.1 in this repository (prior-round sweep retained)',
  },
  {
    claim: 'CPU single-thread latency (v1.1)',
    upstream: '1.64 s/case',
    measured: 'not re-measured — v1.1 documents 1.64 s/case; the retained 2026-10-08 audit measured 923.6 ms/case single-thread where the then-claim was 1.51 s/case',
    verdict: 'UNTESTED for v1.1 in this repository — prior-round reading retained',
  },
  {
    claim: 'GPU fp16 p50 latency (v1.1)',
    upstream: '21.0 ms on an RTX 5090',
    measured: 'not measured in this repository — no CUDA device in this environment, and no latency run was added for v1.1; the only latency files under bench/results/ are from the 0.2.1 era',
    verdict: 'UNTESTED',
  },
  {
    claim: 'option-order flip robustness (v1.1)',
    upstream: 'flip150 0.0200 · flip400 0.0217',
    measured: 'not measured in this repository — flip150/flip400 are not run here',
    verdict: 'UNTESTED (the earlier audit\'s 0.44 flip rate used a different protocol — reversed noul option order — not flip400)',
  },
  {
    claim: 'JevBench public-231 (v1.1)',
    upstream: '0.5455 (126/231) — gate not passed',
    measured: 'not measured in this repository — the row set is not here; disclosure: the public 58.4% gate is NOT passed',
    verdict: 'UNTESTED here — when cited, the not-passed gate must be disclosed',
  },
]
console.log('upstream claims (README fetched 2026-10-08T05:22Z) vs measurement\n')
let agrees = 0
let differs = 0
let untested = 0
for (const row of rows) {
  const marker = row.verdict.startsWith('AGREES') ? '='
    : (row.verdict.startsWith('UNTESTED') ? '?' : '!')
  if (marker === '=') agrees += 1
  else if (marker === '?') untested += 1
  else differs += 1
  console.log(`${marker} ${row.claim}`)
  console.log(`    upstream : ${row.upstream}`)
  console.log(`    measured : ${row.measured}`)
  console.log(`    verdict  : ${row.verdict}`)
  console.log('')
}
console.log(`${agrees} agree, ${differs} need attention, ${untested} untested\n`)

console.log('v1.1 claims (the 2026-10-09 refresh, as documented by the release — not re-measured in this repository)\n')
let agreesV11 = 0
let differsV11 = 0
let untestedV11 = 0
for (const row of rowsV11) {
  const marker = row.verdict.startsWith('AGREES') ? '='
    : (row.verdict.startsWith('UNTESTED') ? '?' : '!')
  if (marker === '=') agreesV11 += 1
  else if (marker === '?') untestedV11 += 1
  else differsV11 += 1
  console.log(`${marker} ${row.claim}`)
  console.log(`    upstream : ${row.upstream}`)
  console.log(`    recorded : ${row.measured}`)
  console.log(`    verdict  : ${row.verdict}`)
  console.log('')
}
console.log(`${agreesV11} agree, ${differsV11} need attention, ${untestedV11} untested\n`)

// ------------------------------------------------------------------ what changed
console.log('what the upstream rewrite changed, in its own words')
console.log('  before : "Cuts LLM calls by 82% with a τ=0.6 confidence gate"')
console.log('  after  : "54% fewer LLM calls ... (82.8% at τ=0.5)"')
console.log('  before : "combined accuracy 0.789 -> 0.7948"')
console.log('  after  : "+0.089 kept-subset acc (0.797 -> 0.886 (kept subset))"')
console.log('')
console.log('The first correction is the one this repository already published: at the')
console.log('frozen tau=0.6 the reduction is ~54%, and 82% belongs to tau=0.5.')
console.log('The second is a change of metric rather than a change of result: 0.7948 was')
console.log('"combined accuracy with escalated decisions resolved by the large model",')
console.log('0.886 is "accuracy on the decisions the gate kept local". Both are true; they')
console.log('answer different questions, and only the second is comparable across models.')

const outPath = path.join(REPO, 'bench/results/upstream-comparison.json')
// WARNING: `fetchedAt` below is a HARD-CODED snapshot — the moment the upstream
// README was fetched (2026-10-08T05:22Z), never the time this script runs. Every
// run re-writes the same value, so it must not be read as the file's recency. The
// v1.1 figures (2026-10-09) live in `rowsV11` as documented by the release —
// neither re-fetched nor re-measured here; UNTESTED stays UNTESTED.
fs.writeFileSync(outPath, `${JSON.stringify({
  fetchedAt: '2026-10-08T05:22Z',
  upstreamRepoPushedAt: '2026-10-08T05:22:52Z',
  pluginRepoPushedAt: '2026-10-08T02:23:13Z',
  timeliness: 'Historical comparison — do not read as current. fetchedAt is a hard-coded snapshot of the 2026-10-08 upstream fetch, not the run time of this script; re-running rewrites the same value. The `rows` group compares the 2026-10-08 upstream revision against 0.2.1-era measurements; `rowsV11` records the 2026-10-09 v1.1 figures as documented by the release — this repository did not re-measure v1.1, and its own retained readings (2026-10-08, pre-v1.1 weights) are quoted as such. UNTESTED rows were never measured and must stay UNTESTED when cited. The version anchors to cite live in the five READMEs.',
  rows, agrees, differs, untested,
  rowsV11, agreesV11, differsV11, untestedV11,
}, null, 1)}\n`, 'utf8')
console.log(`\nwrote ${outPath}`)
