# Third-party notices

`dsh-phocinae` itself is Apache-2.0 (see `LICENSE`). This file records the work it
builds on.

## Phocinae model and server

- **Phocinae-Largha-150M-v1** — the decision model this plugin talks to. Apache-2.0.
  Weights and model card: <https://huggingface.co/Phocinae/Phocinae-Largha-150M-v1>
  (mirror: <https://modelscope.cn/models/PerryLink/Phocinae-Largha-150M-v1>).
  Base model `jhu-clsp/mmBERT-small` (MIT); training data `LocalLLaMA/typed-decisions`
  (Apache-2.0). Not redistributed here — install it from its own repository.
- **phocinae-server** — the local inference server exposing `/v1/systemone`.
  Apache-2.0. <https://github.com/Phocinae/phocinae-server>.
  Not bundled; the README explains how to start it.
- The published measurements this README quotes (typed-decisions accuracy, the E1
  escalation gate, the τ values) come from that project's own documentation:
  `BENCHMARKS.md`, `docs/cost-savings.md`, `docs/reproduce.md`, and the dataset README
  under `datasets/typed_test/`.

## dsh-phocinae 0.1.2

This release began as a repair of `dsh-phocinae@0.1.2` (Apache-2.0, published by
`perrylink`). The `/v1/systemone` request shapes, the default endpoint and model name,
and the general shape of the approval gate come from that release. What changed is
recorded in `CHANGELOG.md`; what was broken and why is in the README's
*Fixed in 0.2.0* section.

## DeepSeek Harness

- The `tools/pre-execute` waterfall, the `ToolDefinition` / `ToolSchema` contract, the
  enforced JSON Schema subset, and the `PreToolDecision` shapes belong to
  **DeepSeek Harness** (MIT, `@deepseek-ai/dsh-*`). This plugin implements against them
  and depends on them at run time through the host; none of that code is copied here.
- The contract details cited in `ARCHITECTURE.md` were read from a local installation of
  `@deepseek-ai/dsh-tools`, `@deepseek-ai/dsh-llm` and `@deepseek-ai/dsh-hooks-codex`
  (0.2.1-alpha.1). The hooks packages are referenced as a worked example of the
  `tools/pre-execute` listener contract, not as a source.

## Methods adapted

- **Sweep the phrasing, measure the separation.** The gate benchmark's approach — try
  several question formulations over one labelled command set and compare recall against
  the confidence band that would auto-pass — follows the evaluation style used by
  `LocalLLaMA/typed-decisions` and by the Phocinae release's own flip-robustness
  recipes (`datasets/flip_recipe`, `datasets/flipaug_recipe`).
- **Assembled-headless integration.** Booting a real host against a throwaway
  `DSH_HOME`, rather than mocking the host, follows the convention used by the
  `PerryLink/dsh-*` plugin family (`dsh-checkpoint-rewind`'s `test/integration/`).

## Development-time tools

Used to build and check this release; none are shipped or required at run time.

- Node.js built-in test runner (`node --test`).
- The plugin's own `test/contract.test.mjs` re-implements the harness's enforced JSON
  Schema subset so the compliance check does not require the host packages to be
  installed. It also uses `@deepseek-ai/dsh-tools`' `assertSupportedJsonSchema` and
  `validateJsonSchemaValue` when that package is resolvable, so the re-implementation is
  cross-checked rather than trusted.
