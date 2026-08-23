# Freetime Broker

**Live: https://damiangit-4.github.io/freetime-broker/**

A capstone prototype for Falla & Co., an invented retailer. It reviews inbound shipping containers once a week and recommends what to do about each one before free time runs out and demurrage starts accruing — under human review, every time.

Built by Damian G. Francois for the Agentic AI Capstone. **This is a prototype, not a production system.**

---

## The problem

A container sits in a yard on a free-time clock. When that clock expires, demurrage and detention charges start — €75 a day on one carrier's contract, €150 on another. The person deciding what to move, and in what order, is balancing carrier terms, a warehouse that can only make a fixed number of outbound moves per day, and the cost of three competing levers: return it now, buy a free-time extension, or pay a premium for expedited drayage.

No single lever always wins. That is what makes it a judgement call rather than a lookup.

## What the agent does

One loop, run once per container, in five visible stages:

1. **Input** — the operator picks a review case: a warehouse and the containers in scope. She does not type it, she selects it.
2. **Context** — the console loads the yard roster, the inbound roster and three policy files, and shows on screen exactly what is being sent to the model. Nothing about the decision hides behind the button.
3. **Decision** — the agent counts first and decides second. It writes out every threshold it checked with the items counted by id, then prices every cost lever as a total on the same basis, then gives a risk, a status and one recommended action with the policy sections it applied.
4. **Output** — every field labelled and separated, one block per container, judgeable in under a minute.
5. **Human review** — Approve, Edit or Escalate.

**Nothing is booked, bought or sent.** The agent produces a claim; a person turns it into a decision. Until someone clicks one of the three buttons, a container is UNREVIEWED and nothing has happened.

## Running it

The page loads for anyone. **Running the agent requires your own Anthropic API key**, entered in Settings.

Your key is stored only in your own browser's `localStorage` and is sent only to Anthropic's API. There is no server, no backend and no key in this repository — the pre-flight scan is part of the build process. That is deliberate security design, not a limitation: a public demo that shipped a working key would be a public demo that shipped a working key.

Without a key, you get the console's first-load state, which is the honest thing to show.

## How it's built

The arithmetic is **not** done by the language model. Application code computes coverage against the carrier contract, the overrun in days, every lever priced on one basis, the cheapest option, and the allocation of contested move slots under the warehouse's daily cap. The model receives those figures as fact.

```text
code   ->  multiply, compare, rank, allocate     deterministic
model  ->  coherence, boundaries, explanation    judgement
```

This split exists because the eval set showed exactly where the model was reliable and where it wasn't — the two cases it always passed are the two requiring no arithmetic at all. [ARCHITECTURE.md](ARCHITECTURE.md) has the full reasoning, the evidence that prompted it, and what it does *not* fix.

Run `node test/engine-test.js index.html` to check every figure against the eval expectations. No API key needed.

## Who it's built for

The console is organized by warehouse, not by test scenario. Open it and you see WH-BCN and WH-VLC, each with the containers that actually have no return booked yet — sorted by urgency, badged by what the pricing engine found. That's the operator's real weekly review, not five hand-picked demo cases. The five documented eval cases still exist and still run exactly as rigorously — they live in the Evals tab, which is where a test harness belongs, not the operator's front door. Full reasoning in [ARCHITECTURE.md](ARCHITECTURE.md).

## Honest limits

This prototype is evaluated against five test cases whose expected behaviour was written before the agent ever ran. The current scoreboard is **three pass, one needs work, one fail** — and the failures are visible in the app's own Evals view rather than hidden.

- **Refusal boundaries hold reliably.** Given a container type outside the carrier's contract, or two data fields that contradict each other, it refuses, cites the policy sections and escalates rather than inventing a number. These pass on every run.
- **The arithmetic and ranking used to be the weak half, and that is what the pricing engine addresses.** The model no longer computes totals, ranks containers against the daily move cap, or decides whether a unit type is covered — code does all three, and the engine's figures are checked by 42 assertions against the documented eval expectations. **The scoreboard above predates that change and has not yet been re-run against the live model**, so it reflects the old design. It will be re-recorded rather than assumed.
- **It takes its data at face value.** It can catch two fields contradicting each other; it cannot catch one that is simply out of date.
- **It cannot see intent.** A container held deliberately looks identical in the data to one that was forgotten.
- **Verified citations do not mean correct reasoning.** The console checks that a cited policy section exists, not that it says what the agent claims. A wrong recommendation has arrived carrying eight valid citations.

The honest reading: requiring the agent to show its working made its errors *visible*, not *absent*. That is why every output goes to a human.

## Data

**All data is synthetic.** Falla & Co., both carriers, the drayage vendor, the warehouses and every person named are invented. No real customer, employee or company record appears anywhere in this repository. The numbers interlock to produce genuine trade-offs, so the agent cannot pass the eval set by always picking a favourite lever.

A real pilot would require a formal privacy review first.

## Repository

```text
index.html    the whole console — UI, agent loop and eval view, no build step
data/         synthetic yard roster, inbound roster and the five eval cases
policies/     carrier contracts, external vendors, warehouse policy
design/       locked design tokens
```

Open `index.html` directly in a browser, or use the live link above.
