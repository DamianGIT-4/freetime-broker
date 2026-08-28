# Decisions

Why this codebase looks the way it does. Each entry states what was true before, what
changed, and the evidence that settled it — so a decision can be re-opened on new
information rather than re-argued from scratch, and so the reasoning survives longer
than anyone's memory of it.

The commit log carries the same reasoning per change; this file is the version you can
read end to end. Code comments carry the *why* at the line it applies to.

---

## The boundaries that do not move

These are properties of the product, not preferences. Changing any of them is a
different product, not a new version of this one.

- **The agent recommends. It never acts.** No booking trucking, no buying free-time
  extension, no committing spend, no contacting anyone. Every recommendation waits for
  a human to approve, edit, or escalate.
- **A refusal is a complete answer.** When policy does not cover a case, the agent
  refuses and escalates with the rule cited. It does not soften a refusal with an
  illustrative figure or a "what if" price.
- **Citations are checkable.** Every container block names the container ids and policy
  sections it relied on, and the console verifies each one against the real files. An
  invented citation is worse than none, because it cannot be checked.
- **All data is synthetic.** Falla & Co., its warehouses, carriers, and containers are
  fictional.

---

## 1 · Arithmetic lives in application code, not in the model

**Before.** The model did the pricing: overrun days, per-lever totals, which lever was
cheapest. It was right most of the time.

**Now.** A deterministic engine computes all of it from the policy files and hands the
model a `PRE-COMPUTED PRICING` brief. The model's instructions say to transcribe those
figures and never recalculate them.

**Why.** "Right most of the time" is the wrong target for money. The model's real job is
the part code cannot do — judging whether a situation is coherent, applying policy
boundaries, and explaining a decision in language a person can check. Arithmetic is not
that job, and leaving it with the model made every number a thing to re-verify.

**Evidence.** `test/engine-test.js` — 42 assertions over the pricing rules, no API key
required.

---

## 2 · The console is organised around the operator, not the test cases

**Before.** Five demo chips named after what they *test*: "Happy path", "Boundary",
"Conflicting data". That is test-harness vocabulary.

**Now.** Warehouse-first. Each warehouse shows occupancy, total exposure, and its
containers split into two triage lanes — *Needs you* and *Confirm the pick* — decided by
the engine with zero model calls. The eval cases moved to their own tab.

**Why.** Nobody's job is "run the boundary case". The job is "review this week's
containers". The triage split also implements a batch-approval rule the policy already
stated (`warehouse_policy.md` WP-7) rather than inventing a new concept.

---

## 3 · Cost has exactly one definition

**Decision.** `total = drayage + premium + carrying cost`, documented above
`priceLevers()`.

**Why.** The eval-case text and the engine had been describing cost two different ways.
Both were defensible readings of the same policy clause, which is what made it
dangerous: nothing failed, and any downstream automated judge would have been grading
against an ambiguity. One definition, written down once, in the code that implements it.

---

## 4 · The allocator is capacity-forward

**Before.** When two containers competed for one outbound move slot, the loser was
pushed to the next weekday — without checking whether *that* day had capacity.

**Now.** Sequential allocation that carries displaced containers forward, checking
capacity at each day.

**Why and the evidence.** The old version passed the 6-container eval case and failed 27
property assertions the moment the yard was realistic. `test/allocator-test.js` runs 240
assertions against generated yards of up to 120 containers, with no API key. This is the
clearest case in the repo of eval-set-scale testing hiding a real bug: correct at the
size you test, silently wrong at the size you ship.

---

## 5 · Evals are committed evidence, not a screen

**Before.** An in-product control panel with hand-typed verdicts, seeded from a
hardcoded object that went stale.

**Now.** `node test/eval-runner.js --runs N` runs a sweep and writes four committed
artifacts: `evals/latest.json` (read by the product's now read-only Evals tab),
`evals/history.jsonl` (one line per sweep, tied to the commit that produced it),
`evals/report.html` (rates, deltas, sparklines, failures ranked by frequency), and
`evals/RESULTS.md` (human verdicts, filled in by hand).

**Why.** A scoreboard the product draws for itself is not evidence. Each case runs N
times because the agent is non-deterministic — two cases have been observed behaving
differently on identical inputs, so a single pass/fail is close to noise. A rate is an
honest number; a verdict from one run is not.

`--rescore <path>` re-grades transcripts already on disk against an improved checker,
with zero new API calls. It exists because of decision 6.

---

## 6 · The engine hands the model a pre-summed total

**The bug, and how it was found.** The first real sweep reported 100% (5/5). A
spot-check of one transcript found the `WAREHOUSE SUMMARY` exposure figure wrong while
`OPTIONS` and `RECOMMENDATION` were correct. Checking all five: **4 of 5 had the wrong
summary figure.** The mechanical checks only looked inside each container's own block,
so a clean 5/5 was hiding it. A check was added and the run re-scored honestly to
**20% (1/5)**.

**Root cause.** The brief gave the model each container's cheapest-lever cost
individually, then asked for one total across all of them — leaving the model to do the
addition. Exactly the failure decision 1 exists to prevent, in the one place it had
been overlooked.

**Fix.** `renderPricingBrief()` computes `TOTAL WAREHOUSE EXPOSURE` once, using the same
formula that drives the UI, and the model transcribes it. The independent check stays
in place, so a model that recalculates anyway is still caught.

**What this cost, and what it bought.** A 100% that was really 20%. It is the strongest
argument in the project for mechanical checks over reading a few transcripts and calling
it good.

---

## 7 · Structured output is rendered from the engine, not re-narrated

**Decision.** Where the console displays something the engine already computed — the
lever comparison under `OPTIONS`, the exposure figure — it draws from the engine's own
data structures, not from the model's prose restatement of them.

**Why.** The model was handed exact figures and asked to write them back out. Rendering
its prose meant re-deriving numbers that already existed, and gave a transcription slip
somewhere to hide. Drawing from the engine means the display cannot disagree with what
the model was told to transcribe. The model's prose is still shown for cases the engine
cannot price, such as refusals.

---

## 8 · The warehouse id stays on screen beside the city

**Decision.** Warehouses display as `Barcelona · WH-BCN`, not one or the other.

**Why.** `WH-BCN` reads as a code you have to already know, so the city leads. But the
id is not decoration: it is the identifier in the `warehouse` column of every data row,
in the policy occupancy table, in every eval case, and in the `SOURCES` citations the
agent writes back — its summary line opens with it. Showing only the city would mean the
agent cites `WH-BCN` while nothing on screen connects that to "Barcelona". This is a
display-layer change; the id is untouched underneath.

---

## 9 · The name stays "Freetime Broker"

**Considered.** Compared against how real logistics products name themselves — literal
category names, domain-word compounds, and universally legible metaphors. Five
alternatives were mocked up in the actual console chrome.

**Decision.** Keep it.

**Why.** The objection was that "free time" is shipping jargon — it means the days a
carrier allows before demurrage and detention charges start, not leisure — and that
"broker" implies more agency than a tool that never transacts. Both hold for a general
reader. Neither holds for this product's actual audience: logistics practitioners, for
whom the terminology is a credibility signal rather than a barrier, and for whom
"broker" reads as the well-understood freight-broker role.

**When to re-open.** Only if that audience assumption changes. Renaming would touch the
live URL, the repository, and external material, so it is not a low-cost change.

---

## Running the checks

Two suites verify the deterministic half. Neither needs an API key:

```bash
node test/engine-test.js index.html      # 42 assertions — pricing arithmetic
node test/allocator-test.js index.html   # 240 assertions — scale invariants
```

Measuring the model itself does need a key:

```bash
export ANTHROPIC_API_KEY=...
node test/eval-runner.js --runs 20
```
