# Security policy

## The trust boundary

The decision state is the **raw text of the tool calls an agent is about to make** — commands, file paths, sometimes credentials embedded in a command line. That text is sent to a decision service over HTTP.

The plugin's position: that service must be the loopback decision model, and nothing else.

- `endpoint` is validated at activation and **must be loopback** (`127.0.0.1`, `localhost`, `::1`). Anything else throws, naming the host and pointing at the escape hatch.
- `allowRemoteEndpoint: true` opts out. Set it only when you have decided that your tool-call text may leave the machine. It is the single setting in this plugin that changes what leaves your computer.
- The plugin makes no other network request. No telemetry, no update check, no error reporting.

## What the gate is, and is not

The gate is a **screening aid**, not a security control.

Measured on 53 labelled commands it stops 30 of 31 destructive ones. That is a good hit rate for a 144M-parameter model running locally in a millisecond; it is not a guarantee, and it is not a sandbox. A model that can be instructed in prose can be argued with in prose.

What the gate actually buys you:

- destructive commands are stopped by default, before they execute;
- anything the model is unsure about reaches a human instead of running;
- an unreachable or malformed answer routes to a human rather than passing;
- routine traffic is handled by a static list, so the model's judgement is reserved for cases that need it.

What it does not buy you:

- protection against a compromised decision service;
- protection against prompt injection that talks the decision model into `harmless`;
- coverage of actions that are not tool calls at all (file edits made by other means, network side effects of an approved command);
- any claim about the sandbox or approval policy of the host. Compose those separately; this plugin supplements them and never replaces them.

Use it alongside DSH's sandbox and approval policy, not instead of them.

## Fail-closed by default

`gate.failMode` defaults to `closed`. When the decision service cannot answer — refused connection, timeout, non-2xx status, unparseable body, missing `answer_confidence`, an answer index outside the option range — the call is routed to a human (`ask`), never to `allow`.

`gate.failMode: 'open'` reverses this: an unreachable service allows the call. This exists because the previous release behaved that way by accident and a deployment may have come to depend on it. It is not recommended, and turning it on should be a deliberate decision recorded in your own notes, not an inherited default.

Two further refusals to guess:

- a **missing confidence extension** (a server started with `PHOC_EXTENSIONS=0`) disables auto-passage entirely. Without a calibrated number there is nothing to be confident about, so every screened call goes to a review.
- a **low-confidence `allow`** becomes a review. The gate never converts uncertainty into passage.

## Command allow-list

`gate.autoAllow` entries are matched against the **whole** command, and a command containing any shell operator — `;`, `&`, `|`, `>`, `<`, backtick, `$`, `(`, `)`, `{`, `}`, `[`, `]`, newline, backslash, `!` — is refused by the fast path and sent to the model.

This rule is the reason the list is safe. `git status` is a read; `git status && curl … | sh` is not, and a naive prefix match would have approved it. An allow-list **entry** containing an operator is rejected at activation, so the list cannot be made to contain a bypass by editing a config file.

Set `gate.autoAllow: []` to send every covered tool call through the model. Expect a review for most of them: the model's confidence is compressed, so removing the list makes the gate noisy rather than strict.

## Auditing

`gate.audit` (default `true`) logs one line per verdict through the host logger:

```
phocinae gate: pwsh -> deny (model-called-it-destructive, confidence 0.9700)
phocinae gate: pwsh -> allow (command-on-auto-allow-list, no calibrated confidence)
```
Allowed and denied lines go to different log levels, so a filter on `warn` shows everything the gate stopped or escalated. Every verdict carries a stable reason code — `model-called-it-destructive`, `confidence-below-threshold`, `decision-service-unavailable` — so a log search does not depend on message wording.

## Data handling

| data | where it goes |
|---|---|
| tool-call text | to `endpoint` (loopback by default), and no further |
| `answer_confidence`, `option_scores` | returned to the caller; not persisted |
| configuration | read from the profile; not transmitted |
| credentials | none. The plugin holds no keys and reads none. |

Nothing is written to disk by the plugin. It has no filesystem capability at all.

## Reporting a vulnerability

Open a private security advisory on the repository, or a minimal issue that describes the affected behaviour without including a working exploit. Please include the plugin version, the DSH version, and the relevant `gate` configuration.

## Known limitations

- The decision model is small. Its confidence is compressed (mostly 0.27–0.54 for a correct `harmless`), which is why the auto-allow list carries routine traffic.
- The gate's `harm` question and its auto-allow list were tuned on a 53-command set. That is a small sample, written by the plugin's author, and it is not a substitute for evaluating the gate against your own command traffic. `bench/gate-bench.mjs` exists so you can do that; replace `bench/cases.json` with your own labelled commands.
- The gate screens `tools/pre-execute`. Anything that does not dispatch through the tool registry is outside its reach.
- `--real-endpoint` in the integration harness and `allowRemoteEndpoint` in the config are the only two ways the plugin is ever pointed away from loopback, and both are explicit.
