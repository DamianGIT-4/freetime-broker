# Why the arithmetic lives in code

A record of the largest design change made to this project after the capstone was submitted, and the evidence that prompted it.

## The problem

The original design asked the language model to do everything: read the rates out of the policy files, work out the overrun, price three levers, compare them, rank containers against a warehouse capacity limit, apply the policy boundaries, and explain the result — all in a single pass.

It was reliable at some of that and unreliable at the rest, and the eval set showed exactly where the line fell.

| Case | What it needs | Result |
|---|---|---|
| EV-04 | Spot contradictory data, refuse | Passed every run |
| EV-05 | Spot an uncovered unit type, refuse | Passed every run |
| EV-02 | Price three levers, pick cheapest | Inconsistent across runs |
| EV-01 | Rank two containers against a daily cap | Never fully correct |
| EV-03 | Price three levers, pick cheapest | Failed |

The two cases that always passed are the two that require **no arithmetic at all**. That is not a coincidence, and it is the whole argument for this change.

The clearest single piece of evidence is EV-03. On the recorded run the model:

1. priced the extension at €650 and the expedite at €600 — both correct,
2. stated that expedite was €50 cheaper — correct,
3. confirmed the extension request window was satisfied — correct,
4. then returned `REFUSED-ESCALATE`, citing the rule it had just satisfied.

Every fact was right and the conclusion was wrong. There is no prompt instruction that fixes that, because nothing was missing from the model's knowledge.

## What was tried first

The previous iteration added two required output fields, `COUNTS` and `OPTIONS`, placed before every conclusion field, forcing the model to show its working before it decided anything.

It helped, and it did not solve the problem. EV-01 stopped refusing spuriously. EV-03 flipped to the correct answer on the first re-run and then regressed. Running the whole set again showed the fix had **moved** the fault rather than removed it: one run priced a return three days past expiry at zero demurrage and used that fiction to dismiss the right answer.

The honest reading was that requiring the working made the errors **visible**, not **absent**. That is a real improvement — the bad number now sits in `OPTIONS` where a reviewer can catch it — but it is not correctness.

## The change

The arithmetic moved into application code. The split is now:

```text
code   ->  multiply, compare, rank, allocate     deterministic
model  ->  coherence, boundaries, explanation    judgement
```

Before each request, `computePricing()` runs against the container data and the policy constants and produces a brief containing:

- **Coverage** — is the unit type listed in CC-1 for this carrier? If not, the engine returns a refusal directive and no price is produced at all.
- **Integrity** — does the data contradict itself, e.g. a free-time clock running on a container the terminal has not confirmed as discharged? If so, refusal directive again.
- **Overrun** — days between free-time expiry and the actual return date.
- **Every lever, priced on one basis** — drayage plus any premium plus any demurrage, with unavailable levers listed with the reason rather than omitted.
- **The cheapest lever**, and an explicit tie flag where XV-4 requires escalation instead of a guess.
- **Slot allocation** — where containers compete for a capped day, WP-5 sequencing is applied in code, the loser is pushed to the next weekday, and its pricing is recomputed to match.

The model receives that brief as fact. Its instructions changed from *do the arithmetic and show your working* to *transcribe these figures and judge the situation*.

## Why this fixes what it fixes

**The model can no longer get arithmetic wrong, because it no longer does arithmetic.** `€600 < €650` arrives as a given rather than as a conclusion it reached and can talk itself out of. EV-03's failure mode — correct pricing followed by a contradictory verdict — is structurally unavailable.

**The capacity constraint is now visible to something that can see all the containers at once.** The model reasons about one container per block, which is why it awarded the same move slot to two of them. Allocation is a warehouse-level problem, so it is solved at warehouse level, in code, before the model is asked anything.

**The contract boundary is enforced rather than instructed.** Previously nothing in the application checked a container's unit type against its carrier's contract; the refusal depended entirely on the model choosing to obey a policy file. Now an uncovered unit type produces a refusal directive from code. The model is asked to explain the refusal, not to decide it.

That last point resolves a limitation this project stated publicly and could not previously defend — that the boundary was a sign rather than a lock.

## What this does not fix

- **The model can still misdescribe a correct figure.** The numbers are reliable; the prose around them still needs a human reading it. That is why the review gate stays.
- **The engine's rates are transcribed from the policy files into code constants.** Edit a policy file without editing the constants and the two drift apart silently — the agent would cite a section that no longer matches what it is priced against. There is no test holding them in sync. This is a new limitation created by this change, and it is a real one.
- **The engine trusts its inputs.** It catches two fields contradicting each other. It cannot catch one that is simply out of date.
- **Intent is still invisible.** A container held deliberately looks identical to one that was forgotten.

## Verifying it

`test/engine-test.js` extracts the engine from `index.html` and checks every figure against the expectations documented in the eval cases — no API calls, no key required, pure arithmetic:

```bash
node test/engine-test.js index.html
```

42 assertions covering all five cases: the contested-slot allocation and its €75 saving, both extension-eligibility rules, the €575 / €600 / €950 comparison in EV-02, the €650 / €600 / €1400 comparison in EV-03, and both refusal paths including the assertion that no Poseidón terms leak into the uncovered-unit refusal.

Set `SHOW_BRIEF=1` to print the brief the model actually receives.

## Measuring the model, not testing it once

`test/engine-test.js` proves the arithmetic. It says nothing about whether the model narrates it correctly, which is the failure mode this change might not fix.

That is what `test/eval-runner.js` is for. It runs each case N times and reports a **pass rate**:

```bash
export ANTHROPIC_API_KEY=...
node test/eval-runner.js --runs 20
node test/eval-runner.js --case EV-03 --runs 30
```

A rate rather than a verdict, because the agent is non-deterministic — cases have been observed behaving differently on identical input, so one run is close to noise.

What it checks is only what the engine can independently prove:

- `STATUS` matches the case's expected status
- `RECOMMENDATION` names the total the engine marked cheapest
- `OPTIONS` reproduces the engine's totals rather than quietly altering one
- refusals carry no cost figure, no return day, and cite the required sections
- the output parsed into labelled fields at all

This became possible only after the engine existed. Before it, there was no independent ground truth on a live container, which is why every verdict had to be hand-entered.

It still does not score the explanation. That stays a human judgement in `evals/RESULTS.md`, and the console still never scores itself.

The runner extracts the prompt, the policies and the engine directly out of `index.html` rather than reimplementing them, so what is measured and what is served cannot drift apart. It self-tests too:

```bash
node test/eval-runner.js --self-test    # no API call
```

That replays the recorded EV-03 bug — every figure correct, the cheapest lever named, then a refusal citing the rule it had just satisfied — and confirms the checks catch it, along with a subtler case where a total is quietly altered from 600 to 550. A harness that cannot fail known-bad output cannot be trusted to pass anything.

## The console: built for a test harness, not for Lana

Everything above fixed the agent. It didn't fix the product wrapped around it.

Until this change, the console's entire navigation was five demo chips labelled by what each one *tests* — "Happy path," "Extension," "Expedite," "Conflicting data," "Boundary." That's the right vocabulary for proving the agent behaves. It is not Lana's vocabulary. She doesn't think "let me run the Boundary case" — she thinks "what's sitting in Barcelona this week that needs my attention." The product's entry point was organized around the five scenarios built to *test* it, not around the operator's actual job.

It also hid most of the yard. Of the 16 containers on the roster, only 5 appear in any eval case. The other 11 — mostly containers with a return already booked — never appeared anywhere in the UI, even though a real weekly review includes them as context: they're what's already consuming the warehouse's daily move-slot capacity.

**The fix: the console is now organized by warehouse, not by test case.**

- Two sections, WH-BCN and WH-VLC, each headed by its real occupancy and band.
- Every container with no return booked yet — the operator's actual open items — sorted by days left, each carrying a badge computed by the pricing engine: *Contested slot*, *Uncovered unit*, *Data conflict*, or *Pricing due*. Not written by hand, so it can't go stale the way the old scoreboard notes did.
- Containers already booked sit collapsed underneath, present for context, not demanding attention.
- One click opens the same five-stage review (context → decision → output → approve/edit/escalate) that already existed — nothing about the review itself changed, only how you get there.

Technically this required almost no new machinery. A warehouse's review is built as a synthetic case — `{ warehouse, scope_container_ids }` — the same shape `buildUserMessage()` and `computePricing()` already consumed for the five eval cases. `findAnyCase()` resolves either kind by id. The five documented cases still exist, still runnable, still exactly as rigorous — they just moved to the Evals tab, which is where a test harness belongs. Nothing downstream of case selection (the decision panel, the human gate, the run log) needed to change at all.

## The general lesson

The reliable half of this agent was always the judgement half — spotting that data contradicts itself, recognising that a contracted carrier supplying an uncontracted unit type is still out of contract, and explaining why in language a person can check. Those are genuinely hard, and the model did them correctly on every run.

The unreliable half was the part a pocket calculator has done perfectly since 1972.

Giving the calculator's work to the calculator is not a workaround. It is the design.
