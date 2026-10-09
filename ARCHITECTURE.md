# Architecture

Three files, one seam each, and a deliberate refusal to be clever about failure.

```
index.mjs          activation: config, tool registration, gate subscription
tools.mjs          the two ToolDefinitions (phocinae_ask, phocinae_gate)
lib/config.mjs     resolution + validation, tool/command matching
lib/protocol.mjs   the /v1/systemone client, answer coercion, prompt shapes
lib/guard.mjs      verdict rules and the pre-execute listener
lib/constants.mjs  vocabulary and defaults (zero dependencies)
lib/errors.mjs     structured codes
```

`lib/` imports nothing outside `lib/`. The plugin has **no run-time dependency** beyond Node's built-ins and the `fetch` it ships with — not even `@deepseek-ai/dsh-tools`, whose `defineTool` helper is convenient but would make the plugin fail to load on a host that resolves a different version of it. The tool definitions are hand-built to the same shape, and `test/contract.test.mjs` asserts that shape and the enforced-schema rules the registry applies.

## The mounting contract

Two DSH facts shape the entry point, and both cost the previous release its entire functionality.

**1. A Cordis context throws on undeclared service access.**

```js
// wrong: throws `cannot get property "registerTool" without inject`
if (typeof ctx.registerTool === 'function') ctx.registerTool(tool)
```

A context is a proxy over the service registry. Reading a name that is not declared through `inject` is an error, not `undefined`, so a `typeof` guard is not defensive — it is the failure. The correct forms are `ctx.inject([...], cb)` to wait for a service, or a declared `inject` on the plugin.

**2. `ToolDefinition` is `{name, description, parameters, output, execute}`.**

`inputSchema` is not a field the registry reads, and `parameters` must be raw JSON Schema inside the harness's enforced subset. Getting this wrong does not fail at authoring time; it fails when the host projects the schema for the model:

```
tool "phocinae_ask" parameters must be lossless JSON before schema projection
```

The entry therefore:

- resolves configuration **once**, at activation, and throws on anything illegal — a bad endpoint or an operator-bearing allow-list entry should stop the load, not weaken the gate at run time;
- registers tools through `ctx.inject(['tools'], …)`, so it never touches an undeclared name and still mounts on a composition with no tool registry;
- subscribes `tools/pre-execute` in the plugin body, so the gate is armed even if the tool registry never appears.

## The gate's decision order

```
tool name not covered by gate.tools      -> allow   (no request)
command on gate.autoAllow, no operator   -> allow   (no request)
model says destructive                   -> deny
model says risky                         -> ask
model says harmless, confidence >= floor  -> allow
model says harmless, confidence < floor   -> ask
service unreachable / unreadable answer   -> ask   (failMode: closed)
```

Order matters. The two local checks come first so routine traffic costs nothing and never leaves the process. The `deny` band is checked before confidence so a positive finding is never softened by an uncertain model. The final rule is the one that keeps the plugin honest: **no path turns a missing or low-confidence answer into passage.**

### Why the default question is the harm scale

The gate asks the model one of three questions. Measured against 53 labelled commands (`bench/`), with the real model:

| question | recall on destructive commands |
|---|---|
| `noul` — "should this tool call be blocked for safety?" | 0.00 |
| `tri-state` — allow / ask / deny | 0.74 |
| `harm` — "how harmful is this command if it runs?" | 0.97 |

The built-in bias of each phrasing is the whole story. A boolean safety question invites the model to consider context and conclude "probably fine". A harm scale forces a positive characterisation before anything passes: *harmless* is a claim the model has to make, and on this set it made that claim 3 times out of 53, twice correctly and once about a command the allow-list operator rule already covers.

`noul` mode is retained, because a deployment that wants to compare old and new behaviour on its own traffic should be able to do so without patching the plugin. It is not the default and its measured recall is zero.

### Why the auto-allow list exists

The model's confidence is compressed. Across every formulation tried, the confidence of a correct "nothing to see here" verdict sits mostly between 0.27 and 0.54. There is no bar at which its approval becomes a reliable general-purpose filter.

The consequence is a design choice, not a tuning problem: the gate stops things, and a static list carries the routine. The list holds read-only and build/test verbs, and an entry containing a shell operator is refused at configuration time, because `git status && rm -rf /` begins with an allow-listed prefix and a prefix match on the first word says nothing about what follows.

## The escalation signal

`phocinae_ask` returns, per batch: `escalate`, `escalatedIds`, `escalationReason`, `escalateAt`, and the calibrated `confidence` map.

The plugin does not escalate anything itself. Escalating means spending someone else's tokens on a larger model, and a local gate has no business making that call. What it does is refuse to hide the uncertainty: a caller that wants the E1 routing reads `escalate` and decides. The docs are explicit about the arithmetic — at the τ=0.6 the model release calls frozen, the measured reduction is 55.0% of decisions, not the 79.6% that belongs to τ≈0.50.

## Failure design

Nothing in this plugin is allowed to fail quietly.

| condition | behaviour |
|---|---|
| illegal configuration | throws at activation, naming the key and the value |
| non-loopback endpoint | throws at activation unless explicitly allowed |
| allow-list entry containing a shell operator | throws at activation |
| decision service unreachable or slow | gate: `ask`; tool: `PHOCINAE_SERVICE_UNAVAILABLE` naming the command to start it |
| service answers non-2xx | structured error carrying the status |
| body not JSON, `answers` not an object, answer missing or out of range | structured error; the gate treats it as unreachable and asks |
| no `answer_confidence` extension | answer is marked `escalate: true`; the gate refuses to auto-pass it |
| caller aborts | the in-flight request is aborted; the decision is still returned |

The rule underneath: a lookup that failed can never read as "safe". The previous release violated exactly that, and the result was a security gate that approved everything while reporting that the model had judged it low-risk.

## Testing layers

| layer | what it proves | needs |
|---|---|---|
| `test/lib.test.mjs` | config resolution, validation, protocol normalisation, verdict rules | nothing |
| `test/contract.test.mjs` | tool definition shape and enforced-schema compliance | nothing (uses the host package when present) |
| `test/regressions.test.mjs` | D1–D12: each repaired defect stays repaired | nothing |
| `test/integration/gate-over-http.mjs` | the real entry and gate over real HTTP: deny, allow, ask, chaining, fail-closed | port 18156 |
| `test/integration/boot-headless.mjs` | a real `dsh` composition mounts the plugin and executes the gate | a `dsh` binary, a throwaway `DSH_HOME` |

The fake decision service is a deliberate simplification: a real one needs a 330 MB checkpoint, and the assertions are about routing the model's answer, not about the model being clever. `--real-endpoint` points the same harness at the real server.
