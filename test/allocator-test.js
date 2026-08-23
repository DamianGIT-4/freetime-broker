#!/usr/bin/env node
/* =====================================================================
   ALLOCATOR PROPERTIES — the invariants that must hold at any scale.

   The eval cases prove the allocator gets two containers right. They
   cannot prove it gets thirty right, because the eval set has no case
   that large — and that is exactly where the previous implementation
   was wrong: it pushed every displaced container to the next weekday
   without checking whether that day had room, so the arithmetic stayed
   correct while the plan became physically impossible.

   These are property tests, not example tests. They generate crowded
   yards, run the real engine over them, and assert invariants that must
   be true of ANY valid plan:

     1. no weekday ever exceeds its WP-4 daily move cap
     2. no container is placed on two different days
     3. no container is scheduled before its free-time clock could allow
     4. displacement always follows WP-5.1 — the container left behind
        never has a higher D&D rate than the one given the slot
     5. a displaced container's stated cost matches its stated day

   No API key required. Pure arithmetic.
   ===================================================================== */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SOURCE = process.argv[2] || path.join(__dirname, "..", "index.html");
const SRC = fs.readFileSync(SOURCE, "utf8");

function slice(a, b) {
  const i = SRC.indexOf(a), j = SRC.indexOf(b, i);
  if (i === -1 || j === -1) throw new Error("marker missing: " + a);
  return SRC.slice(i, j);
}

const sandbox = {};
vm.createContext(sandbox);
new vm.Script(
  slice("const CSV_CONTAINERS_INYARD", "const POLICY_CARRIER_CONTRACTS") + "\n" +
  slice("function parseCsv(text)", "function esc(value)") + "\n" +
  slice("const COVERED_UNIT_TYPES", "function buildUserMessage") + "\n" +
  "this.api = { CONTAINERS_INYARD, allocateSlots, slotMap, priceLevers, coverageCheck," +
  " integrityCheck, parseDate, isoDate, dayDiff, nextWeekdayAfter, CONTRACTS, DRAYAGE, MOVE_CAP };"
).runInContext(sandbox);

const A = sandbox.api;

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log("  FAIL  " + label + (detail ? "\n          " + detail : ""));
}
function section(name) { console.log("\n" + name); }
function done(name) { console.log("  " + name + ": ok"); }

/* ---- build a synthetic crowded yard ---- */

function makeYard(warehouse, count, seed) {
  /* deterministic pseudo-random so a failure is reproducible */
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

  const carriers = Object.keys(A.CONTRACTS);
  const rows = [];
  for (let i = 0; i < count; i++) {
    const carrier = carriers[Math.floor(rnd() * carriers.length)];
    const contract = A.CONTRACTS[carrier];
    /* cluster targets onto a handful of days to force contention */
    const targetDay = 3 + Math.floor(rnd() * 4);          /* 03..06 Aug */
    const expiryDay = 3 + Math.floor(rnd() * 3);
    rows.push({
      container_id: warehouse + "-C" + String(i).padStart(3, "0"),
      carrier: carrier,
      container_type: "40HDRY",
      warehouse: warehouse,
      free_time_start: "2026-07-15",
      free_time_days: String(contract.free_time_days),
      free_time_expiry: "2026-08-" + String(expiryDay).padStart(2, "0"),
      days_left: String(Math.max(0, expiryDay - 3)),
      yard_slot: "X-" + i,
      status: "in_yard",
      discharge_confirmed: "yes",
      dnd_days_accrued: "0",
      booked_return_date: "",
      next_standard_slot: "2026-08-" + String(targetDay).padStart(2, "0"),
      notes: ""
    });
  }
  return rows;
}

function priceAll(rows) {
  return rows.map(c => {
    const coverage = A.coverageCheck(c);
    const expiry = A.parseDate(c.free_time_expiry);
    const target = A.parseDate(c.booked_return_date) || A.parseDate(c.next_standard_slot);
    const daysLeft = c.days_left === "" ? null : Number(c.days_left);
    return {
      container: c, contract: coverage.contract, expiry: expiry, targetDate: target,
      daysLeft: daysLeft,
      priced: A.priceLevers(c, coverage.contract, target, expiry, daysLeft)
    };
  });
}

/* Reconstruct the final plan: where did each container actually end up? */
function finalPlan(scoped) {
  const plan = {};
  scoped.forEach(e => {
    const id = e.container.container_id;
    plan[id] = e.reallocated ? e.reallocated.date : A.isoDate(e.targetDate);
  });
  return plan;
}

/* ---- the properties ---- */

function runScenario(label, warehouse, count, seed) {
  const rows = makeYard(warehouse, count, seed);
  const scoped = priceAll(rows);
  const decisions = A.allocateSlots(scoped, rows, warehouse);
  const plan = finalPlan(scoped);
  const cap = A.MOVE_CAP[warehouse];

  /* 1 — no day over cap */
  const perDay = {};
  Object.keys(plan).forEach(id => { perDay[plan[id]] = (perDay[plan[id]] || 0) + 1; });
  const over = Object.entries(perDay).filter(([, n]) => n > cap);
  check(label + " · no day exceeds the WP-4 cap of " + cap, over.length === 0,
    over.map(([d, n]) => d + " has " + n + " moves").join("; "));

  /* 2 — nobody placed twice */
  const ids = Object.keys(plan);
  check(label + " · every container placed exactly once",
    ids.length === count && new Set(ids).size === count,
    "planned " + ids.length + " of " + count);

  /* 3 — nothing scheduled before its original target */
  const early = ids.filter(id => {
    const e = scoped.find(x => x.container.container_id === id);
    return plan[id] < A.isoDate(e.targetDate);
  });
  check(label + " · nothing moved earlier than its vendor slot", early.length === 0,
    early.join(", "));

  /* 4 — WP-5.1: the displaced container never out-ranks the one that took the slot */
  const inversions = decisions.filter(d =>
    d.winnerRate !== null && d.loserRate > d.winnerRate);
  check(label + " · WP-5.1 respected (higher D&D rate is never displaced)",
    inversions.length === 0,
    inversions.map(d => d.loser + "@" + d.loserRate + " displaced by "
      + d.winner + "@" + d.winnerRate).join("; "));

  /* 5 — a displaced container's cost matches the day it actually lands on */
  const mismatched = scoped.filter(e => {
    if (!e.reallocated) return false;
    const expected = A.DRAYAGE.standard
      + Math.max(0, A.dayDiff(e.expiry, A.parseDate(e.reallocated.date))) * e.contract.dnd_rate;
    return e.reallocated.total !== expected;
  });
  check(label + " · displaced cost matches the day landed on", mismatched.length === 0,
    mismatched.map(e => e.container.container_id).join(", "));

  return { decisions: decisions.length, days: Object.keys(perDay).length };
}

section("Current scale — the size the eval set actually covers");
runScenario("6 containers", "WH-BCN", 6, 7);
done("6 containers");

section("Regional scale — 20-30 per warehouse, cap 4-6");
[20, 25, 30].forEach(n => {
  const r = runScenario(n + " containers @ WH-BCN", "WH-BCN", n, n * 13 + 1);
  console.log("  " + n + " containers: " + r.decisions + " displacements across " + r.days + " days");
});
[20, 30].forEach(n => {
  const r = runScenario(n + " containers @ WH-VLC", "WH-VLC", n, n * 29 + 3);
  console.log("  " + n + " containers: " + r.decisions + " displacements across " + r.days + " days");
});

section("Stress — far past anything realistic");
[60, 120].forEach(n => {
  const r = runScenario(n + " containers", "WH-BCN", n, n * 7 + 5);
  console.log("  " + n + " containers: " + r.decisions + " displacements across " + r.days + " days");
});

section("Seed sweep — 40 randomised yards, all invariants");
for (let seed = 1; seed <= 40; seed++) {
  runScenario("seed " + seed, seed % 2 ? "WH-BCN" : "WH-VLC", 12 + (seed % 18), seed * 97);
}
done("40 seeds");

console.log("\n---------------------------------------------");
console.log("  " + pass + " assertions passed, " + fail + " failed");
console.log("---------------------------------------------\n");
process.exit(fail ? 1 : 0);
