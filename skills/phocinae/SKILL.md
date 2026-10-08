# phocinae — local decision model

Use the local Phocinae decision model (`Phocinae-Largha-150M-v1`) for **fast,
repeatable, thresholdable judgements** instead of spending a large-model call on
them.

## When to use it

Reach for `phocinae_ask` when the question has a small, enumerable answer set and
you would otherwise ask a language model to pick one:

- **yes/no checks** — is this risky, does this match, should this proceed
- **single-choice routing** — which tool, which queue, which category
- **ordinal scoring** — severity, urgency, confidence, quality, 2–10
- **batch triage** — screen a list of items with one call rather than one call each
- **approval pre-screening** — judge a command before running it

Reach for `phocinae_gate` when you want a second opinion on **one command or
action** before taking it. It returns `allow` / `ask` / `deny`, and the same
judgement already runs automatically before every screened tool call.

## When not to use it

The model does not generate text. It cannot write, summarise, translate, answer
knowledge questions, reason over long documents, or hold a conversation. Asking it
to do any of those produces a confident, meaningless answer.

## How to ask

One call carries several questions against **one** state:

```
phocinae_ask({
  state: "<the decision context, verbatim>",
  questions: [
    { id: "risk",     type: "noul",   threshold: 0.8 },
    { id: "action",   type: "choice", options: ["continue", "review", "stop"] },
    { id: "severity", type: "score" }
  ]
})
```

Three rules decide whether the answer is worth anything:

1. **Paste the state verbatim.** Do not paraphrase, condense, or reorganise it.
   The model reads exactly what you send and nothing else; measured option-order
   and wording sensitivity is real, and a rewritten state is a different question.
2. **Put the candidate text in `options`.** A `choice` question is only as good as
   its option strings — prefer `"human_review: queue this for a human"` over
   `"2"`. Long options are truncated by the encoder, so lead with the
   distinguishing words.
3. **Set `threshold` deliberately** on `noul` questions. It is the probability at
   which the answer flips to `true`; the default of 0.5 is a coin flip's edge, not
   a considered cut.

## Reading the answer

Every answer comes back with a calibrated confidence and an `escalate` flag:

- `escalate: false` — the model was confident; use the answer.
- `escalate: true` — the confidence fell below the threshold (default 0.6). The
  answer is still the model's best guess, but it is the case to hand to a larger
  model, or to a human.

**Do not treat a low-confidence answer as a decision.** The measured behaviour on
the decision benchmark is that answers kept above the threshold are markedly more
accurate than answers below it, which is the whole point of the flag. When
`escalate` is true and the decision matters, escalate — do not proceed on it and
do not silently re-ask hoping for a different answer; the model is deterministic,
so a repeat returns the same verdict.

Report which answers were escalated when you summarise a batch. A caller who
knows three of twenty items were uncertain can act on that; one who is told
"twenty items classified" cannot.

## Approval gate

The plugin also installs a `tools/pre-execute` gate that screens tool calls before
they run, using the harm scale (`harmless` / `risky` / `destructive`). You do not
invoke it; it acts on its own:

- read-only commands on the configured allow-list pass without a model call
- anything else is judged, and a `risky` or `destructive` verdict stops the call
  for a human
- an unreachable decision service routes to a human rather than letting the call
  through

If a call you expected to run comes back blocked or awaiting approval, that is the
gate, not a tool failure. The reason string names the verdict.
