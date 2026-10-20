**English** · [中文](./README-zh.md) · [Español](./README-es.md) · [Português](./README-pt.md) · [हिन्दी](./README-hi.md)

<img src="docs/assets/logo_phocinae.png" width="120" alt="Phocinae seal logo">

# dsh-phocinae

**A local, non-generative decision layer for DeepSeek Harness.** A 150M-parameter model answers yes/no, choice and 2–10 score questions in one forward pass, and a fail-closed gate screens tool calls before they run.

- Runs on your machine; no cloud API, no API key.
- `phocinae_ask` for typed batch decisions; `phocinae_gate` for one command or action.
- The gate hooks `tools/pre-execute`: unreachable service → ask a human, never silently allow.
- The model does not write prose or code. It makes one structured decision.

## Quick start

```sh
pip install phocinae-server
huggingface-cli download Phocinae/Phocinae-Largha-150M-v1 --local-dir ./model
PHOC_MODEL_DIR=./model python -m phocinae.main
dsh plugin --profile web add dsh-phocinae@0.2.5
curl http://127.0.0.1:8155/health
```

`{"status":"ok","model_loaded":true}` means the service is ready. Pin `dsh-phocinae@0.2.5`: a bare `add dsh-phocinae` can resolve to an older build while pnpm's `minimumReleaseAge` gate holds a fresh release back.

## What you get

| Surface | What it does |
|---|---|
| `phocinae_ask` | Runs up to 64 typed questions against one state; returns answers, calibrated confidence and an advisory `escalate` flag. |
| `phocinae_gate` | Judges one command or action as `allow`, `ask` or `deny`; checks it without executing it. |
| `tools/pre-execute` gate | Screens every tool call matching `gate.tools` before execution; fail-closed. |
| `phocinae` skill | Tells the model when a local decision is the right tool and how to read `escalate`. |

## Examples

Ask two questions about one state:

```json
{"state":"The user wants to delete /tmp/build. The path is inside the workspace.","questions":[{"id":"safe","type":"noul","threshold":0.8},{"id":"urgency","type":"score"}]}
```

The response shape is:

```json
{"answers":{"safe":true,"urgency":4},"confidence":{"safe":0.92,"urgency":0.71},"escalate":false}
```

Gate a dangerous command:

```json
{"command":"rm -rf /","toolName":"shell","cwd":"/home/me/project"}
```

It returns `decision: "deny"` with a reason and confidence; the command is never run. These outputs illustrate the schema, not a recorded fixture.

## How it works

1. The host calls `phocinae_ask`, `phocinae_gate`, or the pre-execute gate.
2. The plugin sends the raw state to `http://127.0.0.1:8155/v1/systemone`.
3. The service returns one structured answer per question.
4. The gate maps the answer to `allow` / `ask` / `deny`; low confidence becomes `escalate`, and an unreachable service becomes `ask` in `failMode: closed`.

## Configuration

Defaults live in `cordis.patch.yml` and `lib/config.mjs`. Every key has a default.

| Key | Default | Meaning |
|---|---|---|
| `endpoint` | `http://127.0.0.1:8155/v1/systemone` | Decision service. Loopback only unless `allowRemoteEndpoint: true`. |
| `timeoutMs` | `3000` | Per request; one attempt. |
| `escalateAt` | `0.6` | Confidence below this marks an answer `escalate: true`. |
| `gate.mode` | `harm` | `harm`, `tri-state`, `noul` or `off`. |
| `gate.tools` | `['*']` | Tool names to screen: exact, globs, or `*`. |
| `gate.failMode` | `closed` | `closed` asks a human when the service is unreachable; `open` allows. |

To use only the tools and screen nothing:

```yaml
- id: phocinae
  config:
    gate:
      mode: off
```

## Security and boundaries

- **Loopback only.** The state contains raw tool-call text; a non-loopback endpoint is a load-time error unless explicitly allowed.
- **Fail-closed.** Service errors/timeouts route screened calls to a human; a missing tool name is not allowlisted.
- **Not a sandbox.** The gate is an additional approval signal, not a replacement for the host sandbox or human approval.
- **No generation.** The model cannot answer knowledge questions, write code, or summarize; use a chat model for that.

## Compatibility

- Node `^22.19` or `>=24`.
- DSH `>=0.2.1-0 <0.3.0`; the bundle row mounts `phocinae_ask`, `phocinae_gate`, the gate and the skill.
- `phocinae-server` must be reachable at the configured endpoint.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `PHOCINAE_SERVICE_UNAVAILABLE` | Start the server and check `curl http://127.0.0.1:8155/health`. |
| Bare add installs an old version | Re-add with `dsh-phocinae@0.2.5`; check `dsh --profile web --dump-config`. |
| The gate asks for everything | Confirm the server is up; in `failMode: closed`, an unreachable service deliberately asks. |
| The gate is too aggressive/lenient | Tune `gate.mode`, `gate.tools`, `gate.minConfidence`, `gate.autoAllow`; do not turn it off blindly. |

## License

Apache-2.0. The model card and server are separate projects: [Phocinae-Largha-150M-v1](https://huggingface.co/Phocinae/Phocinae-Largha-150M-v1) and [phocinae-server](https://github.com/Phocinae/phocinae-server).
