# Carrier Contracts — Free Time and Demurrage & Detention

Falla & Co. · Inbound Logistics · Contract year 2026
All figures are contractual and may not be estimated, rounded, or inferred.

## CC-1 · Scope

Falla & Co. holds inbound container contracts with exactly two carriers: **Poseidón Freight** and **Leviatán Lines**.

Both contracts are written against **dry cargo unit types only**:

| Covered unit type | Description |
|---|---|
| `20DRY` | 20ft standard dry |
| `40DRY` | 40ft standard dry |
| `40HDRY` | 40ft high-cube dry |

No other unit type is covered. See CC-5.

## CC-2 · Poseidón Freight

Applies to `20DRY`, `40DRY`, `40HDRY` only.

- Free time: **14 calendar days** from discharge.
- Demurrage & detention after free time: **€75 per container per day.**
- Free-time extension: **not available.** Poseidón does not sell extension days under the 2026 contract.
- Remaining levers once free time is short: return on a standard slot, expedite the return, or accept D&D.

## CC-3 · Leviatán Lines

Applies to `20DRY`, `40DRY`, `40HDRY` only.

- Free time: **21 calendar days** from discharge.
- Demurrage & detention after free time: **€150 per container per day.**
- Free-time extension: **available at €25 per container per day.**
  - Maximum **10 extension days** per container.
  - Extension must be requested **at least 5 calendar days before free-time expiry.** A request made inside 5 days of expiry is refused by the carrier and must not be recommended.

## CC-4 · How free time is counted

- The free-time clock starts on the **confirmed discharge date**, recorded as `free_time_start`.
- A recorded `free_time_start` is only valid if `discharge_confirmed` is `yes`. If discharge is not confirmed, the clock has **not** started and any days-left figure derived from it is unreliable — see WP-6 in `warehouse_policy.md`.
- Free-time expiry = `free_time_start` + contracted free-time days.
- D&D accrues for each calendar day the container remains in the yard **after** expiry, counted from the day after expiry through the gate-out day inclusive. Weekends and holidays are chargeable days.

## CC-5 · Uncovered units — hard boundary

A container falls outside contract when **either** of these is true:

1. **The unit type is not listed in CC-1.** This includes Non-Operating Reefers (`NOR`), live reefers, open-tops, flat-racks, and tanks — **even when supplied by Poseidón Freight or Leviatán Lines**, and even when supplied as a substitution for a booked DRY or HDRY unit. A contracted carrier does not make an uncontracted unit type contractual.
2. **The carrier is not listed in CC-2 or CC-3.**

For any such container Falla & Co. has **no agreed free-time period and no agreed D&D rate**. The agent must:

1. Refuse to produce a risk classification, a cost figure, or a recommended action.
2. State plainly which condition applies — uncovered unit type, or uncontracted carrier.
3. Escalate to the Inbound Logistics Manager for commercial review.

The agent must **never** apply a carrier's DRY/HDRY terms to an uncovered unit type, must never borrow another carrier's terms, and must never estimate or invent a rate. A complete-looking table built on invented terms is a worse outcome than a visible gap.
