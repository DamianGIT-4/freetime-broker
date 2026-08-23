# Eval results

Newest sweep first. Mechanical pass rates are produced by `test/eval-runner.js` and check only what the pricing engine can independently prove — status, whether the recommendation names the engine's cheapest total, whether `OPTIONS` reproduces the engine's figures unaltered, and whether refusals stay clean. The **Verdict** column is a human judgement of whether the explanation is any good. The tool does not score prose, and the console never scores itself.

Each case runs N times because the agent is non-deterministic: two cases have been observed behaving differently across identical inputs, so a single pass/fail verdict is close to noise. A rate is an honest number; a verdict from one run is not.

```bash
export ANTHROPIC_API_KEY=...
node test/eval-runner.js --runs 20     # a normal sweep
node test/eval-runner.js --runs 100    # before a release
```

Each sweep writes four things, all committed:

| File | What it is |
|---|---|
| `evals/latest.json` | the last sweep — read by the product's Evals tab |
| `evals/history.jsonl` | one line per sweep, each tied to the commit that produced it |
| `evals/report.html` | the review surface: rates, deltas, sparklines, where to look first |
| `evals/runs/*.json` | raw transcripts, the underlying evidence |

---

## No sweep recorded yet under the current build

The last recorded scoreboard — **3 pass, 1 needs work, 1 fail** — was produced before arithmetic moved into application code, before the allocator was fixed, and before the eval cases were restated on the totals cost basis. It is not carried forward, because it describes a system that no longer exists.

Two suites verify the deterministic half today, and neither needs an API key:

```bash
node test/engine-test.js index.html      # 42 assertions — pricing arithmetic
node test/allocator-test.js index.html   # 240 assertions — scale invariants
```

Those prove the figures are right. They do not prove the model narrates them correctly — that is what a sweep measures, and none has been run since these changes landed.
