# Warehouse Policy — Capacity, Throughput and Escalation

Falla & Co. · Inbound Logistics · Effective 2026-01-01
Weekly review date for the current run: **Monday 2026-08-03.**

## WP-1 · The two warehouses

| Warehouse | Site | Container slots | Currently occupied | Occupancy |
|---|---|---|---|---|
| WH-BCN | Barcelona · Zona Franca | **180** | 151 | **84%** |
| WH-VLC | Valencia · Puerto Sur | **240** | 118 | **49%** |

## WP-2 · Occupancy thresholds

| Band | Occupancy | Meaning |
|---|---|---|
| Healthy | below 70% | Normal operation. Return on standard slots. |
| Watch | 70% to 80% | Sequence returns deliberately. Avoid new overruns. |
| At-risk | above 80% | Yard space is the binding constraint. Every inbound arrival must be matched by a planned outbound move. |

WH-BCN is currently **at-risk**. WH-VLC is **healthy**.

## WP-3 · What the container files cover

`containers_inyard.csv` lists the containers **under active return management** this week — not the full yard. The occupancy figures in WP-1 are the full standing count including long-dwell and stored units. Do not attempt to derive occupancy by counting rows in the CSV.

`containers_inbound.csv` lists confirmed and provisional arrivals for the week ahead. Provisional arrivals may shift and must be labelled as provisional in any forecast.

## WP-4 · Daily outbound move cap — hard constraint

| Warehouse | Maximum outbound container moves per day |
|---|---|
| WH-BCN | **4** |
| WH-VLC | **6** |

This cap is a **physical yard and gate-labour limit**. It is hard.

Expedited trucking does **not** raise it. Paying the €100 expedite premium buys an earlier truck from the vendor, but if the warehouse has no free move slot that day, the move cannot happen. When more containers need returning on a day than the cap allows, they must be **sequenced across days**, and the sequencing decision is a cost decision.

A container with a `booked_return_date` already consumes one of that day's move slots.

## WP-5 · Sequencing rule

When two or more containers compete for the same move slot:

1. Rank by **cost exposure per day of delay**, not by days remaining alone.
2. Where days remaining are equal, the container with the **higher D&D rate** takes the earlier slot.
3. Where a cheaper lever exists for one container — an eligible free-time extension, for example — apply that lever instead of spending the contested slot on it.
4. State the rejected alternative and its cost, so the reviewer can see the saving.

## WP-6 · Escalation triggers

The agent must stop and escalate, naming the trigger, when any of these are true:

| Trigger | Definition |
|---|---|
| No matching policy | The unit type is not one of `20DRY` / `40DRY` / `40HDRY`, or the carrier is not under contract — see `carrier_contracts.md` CC-5. A contracted carrier supplying an uncovered unit type still fires this trigger. |
| Missing data | A field required for the cost calculation is blank or absent. |
| Conflicting data | Two fields or two files disagree — for example a `free_time_start` recorded on a container whose `discharge_confirmed` is `no`, or a unit with a running clock but no assigned yard slot. |
| No feasible plan | Every available lever still breaches free time or the daily cap. |
| High-stakes concentration | **5 or more containers** in one warehouse within 2 days of free-time expiry. |

### Unconfirmed discharge — how to reassess

If `discharge_confirmed` is `no` but a `free_time_start` is recorded, the two possible readings give opposite answers and the agent cannot choose between them:

- **Discharge happened and was not logged** → the clock has been running since `free_time_start`, days-left is real, and the container may be close to breach.
- **Discharge is genuinely delayed** → the clock has not started at all, `days_left` and `free_time_expiry` are meaningless, and any cost figure derived from them is fiction.

The agent must present both readings, state that terminal confirmation is required to choose, and escalate. It must not pick the more urgent reading to be safe, and must not pick the calmer one to keep the table clean.

On escalation the agent produces the reason and the evidence, and **no cost recommendation**.

## WP-7 · Human approval gate

The agent recommends. It does not act.

Nothing in this workflow is committed — no truck booked, no expedite requested, no extension purchased, no spend of any kind — until the **Inbound Logistics Manager** approves, edits, or escalates it.

Routine recommendations may be batch-approved. Anything carrying an escalation trigger from WP-6 requires individual review.

There are two separate handoffs, and they must not be confused:

| Handoff | From | To | When |
|---|---|---|---|
| Agent escalation | The agent | Inbound Logistics Manager | Any WP-6 trigger fires. The agent produces the reason and the evidence, and no cost recommendation. |
| Human escalation | Inbound Logistics Manager | One of the owners in WP-8 | The decision sits outside her authority. She names the owner and records the reason. |

The agent never escalates to a WP-8 owner directly. It escalates to the Inbound Logistics Manager, who decides whether to send it on and to whom.

## WP-8 · Escalation owners

| Owner | Owns | Typical case |
|---|---|---|
| **Procurement** | Carrier contracts, agreed rates, non-contract units, spend above the manager's limit | A carrier supplies a unit type with no contracted terms |
| **Operations** | Yard, terminal and container data | A free-time clock is running on a unit the terminal has not confirmed as discharged |
| **Carrier Customer Services** | Bookings, free-time extension requests, unit substitutions | Requesting an extension, or asking a carrier to swap a wrongly supplied unit |

Choosing the owner is the manager's judgement, not the agent's. The agent states the trigger and the evidence; it does not name an owner.
