# External Vendors — Drayage and Expedite Pricing

Falla & Co. · Inbound Logistics · Contract year 2026

## XV-1 · Primary drayage vendor

**Transportes Ibéricos del Sur (TIS)** — container return haulage for WH-BCN and WH-VLC.

- Standard return: **€500 per container.**
- Must be booked at least **48 hours** in advance.
- Runs **Monday to Friday only.** No Saturday, Sunday, or public-holiday moves.
- Standard slots are allocated by TIS from their own weekly capacity. The next slot TIS has confirmed for a container is recorded per container as `next_standard_slot`. That date cannot be assumed earlier than recorded.

## XV-2 · Expedite premium

- Expedited return: **€500 standard + €100 expedite premium = €600 per container.**
- The premium is **flat per container**, regardless of how many days earlier the pickup lands.
- Guarantees pickup within **48 hours** of the request.
- Expedite buys an **earlier truck**. It does **not** buy warehouse dock capacity — see `warehouse_policy.md` section WP-4.

## XV-3 · Backup vendor

**Costa Levante Logística** — overflow haulage, WH-VLC only.

- Standard return: **€560 per container.** No expedite product.
- Use only when TIS has no slot. Not to be recommended on price.

## XV-4 · Choosing between the levers

For a container heading past free-time expiry, exactly three levers exist:

| Lever | Cost | Availability |
|---|---|---|
| Buy free-time extension | €25 per container per day | Leviatán Lines only, and only if requested ≥5 days before expiry — see `carrier_contracts.md` CC-3 |
| Expedite the return | €100 flat premium | Both carriers |
| Accept the overrun | €75/day (Poseidón) or €150/day (Leviatán) | Always — this is the do-nothing cost |

Because the expedite premium is flat at €100 and extension is €25 per day, extension is cheaper than expedite at **3 overrun days or fewer**, and expedite is cheaper at **5 overrun days or more**. At exactly 4 days the two cost €100 each and the choice must be escalated rather than guessed.

## XV-5 · Spend authority

No vendor booking, expedite request, or extension purchase may be placed by the agent. Every option in this file is a **recommendation only** and requires the Inbound Logistics Manager to approve, edit, or escalate before anything is committed.
