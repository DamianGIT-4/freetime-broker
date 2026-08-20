# Eval results

Newest sweep first. Mechanical pass rates are produced by `test/eval-runner.js` and check only what the pricing engine can independently prove — status, whether the recommendation names the engine's cheapest total, whether `OPTIONS` reproduces the engine's figures unaltered, and whether refusals stay clean. The **Verdict** column is a human judgement of whether the explanation is any good. The tool does not score prose, and the console never scores itself.

Each case runs N times because the agent is non-deterministic: two cases have been observed behaving differently across identical inputs, so a single pass/fail verdict is close to noise. A rate is an honest number; a verdict from one run is not.

```bash
export ANTHROPIC_API_KEY=...
node test/eval-runner.js --runs 20
```

---

## No sweep recorded yet under the pricing engine

The last recorded scoreboard — **3 pass, 1 needs work, 1 fail** — was produced by the previous design, before arithmetic moved into application code. It is not carried forward here, because it describes a system that no longer exists.

The engine's own arithmetic is verified separately and needs no API key:

```bash
node test/engine-test.js index.html    # 42 assertions
```

That proves the figures are right. It does not prove the model narrates them correctly — that is what the sweep above is for, and it has not been run.
