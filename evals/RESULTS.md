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






## Sweep 2026-11-08 · claude-sonnet-4-5 · 20 runs per case · re-scored

Commit `8b830f0`. Mechanical pass rate is checked automatically against the pricing engine.
The verdict column is a human judgement of the explanation and is filled in by hand.

| Case | Mechanical | Verdict | Note |
|---|---|---|---|
| EV-01 | 100% (20/20) | Pass | Slot ordering correct every run (L-5518 before P-2041); totals exact; rationale clear. |
| EV-02 | 100% (20/20) | Pass | Correct choice and figures. Minor noise: WHY/SOURCES sometimes list unrelated containers. |
| EV-03 | 100% (20/20) | Needs work | Right option and price, but RETURN DAY is invented: 2026-08-05 in 13/20, 2026-08-09 in 5/20, a phrase in 2/20. XV-2 (48h) gives 2026-08-05. The engine does not supply the expedite date and no check covers it. |
| EV-04 | 100% (20/20) | Pass | Refuses every run; names both readings of the discharge conflict and what would resolve it. |
| EV-05 | 100% (20/20) | Pass | Refuses every run; cites CC-1 and CC-5 correctly. |

Raw outputs: `evals/runs/2026-11-08T15-10-37.json`

## Sweep 2026-11-08 · claude-sonnet-4-5 · 1 runs per case

Commit `8b830f0`. Mechanical pass rate is checked automatically against the pricing engine.
The verdict column is a human judgement of the explanation and is filled in by hand.

| Case | Mechanical | Verdict | Note |
|---|---|---|---|
| EV-01 | 100% (1/1) | | |
| EV-02 | 100% (1/1) | | |
| EV-03 | 100% (1/1) | | |
| EV-04 | 100% (1/1) | | |
| EV-05 | 100% (1/1) | | |

Raw outputs: `evals/runs/2026-11-08T15-05-11.json`

## Sweep 2026-08-23 · claude-sonnet-4-5 · 5 runs per case · re-scored

Commit `9a238b4`. Mechanical pass rate is checked automatically against the pricing engine.
The verdict column is a human judgement of the explanation and is filled in by hand.

Manually consolidated 2026-08-28 — this run originally scored 100% (5/5); a spot-check of
one transcript found `WAREHOUSE SUMMARY`'s stated exposure wrong while `OPTIONS` and
`RECOMMENDATION` were correct, a mechanical check for it was added, and the honest re-score
below is what stands. See HANDOFF.md for the full account. (The `--rescore` tool previously
recorded this as two separate blocks for the same run; it now updates one block in place —
see `finalizeSweep()` in `test/eval-runner.js`.)

| Case | Mechanical | Verdict | Note |
|---|---|---|---|
| EV-03 | 20% (1/5) | | |

Raw outputs: `evals/runs/2026-08-23T12-57-15.json`

