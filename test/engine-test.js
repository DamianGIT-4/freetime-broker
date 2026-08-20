/* Extracts the pricing engine out of index.html and checks it against the
   five eval cases' documented expectations. No API calls — pure arithmetic. */

const fs = require("fs");
const SRC = fs.readFileSync(process.argv[2], "utf8");

function slice(startMarker, endMarker) {
  const a = SRC.indexOf(startMarker);
  const b = SRC.indexOf(endMarker, a);
  if (a === -1 || b === -1) throw new Error("marker not found: " + startMarker + " / " + endMarker);
  return SRC.slice(a, b);
}

const code = [
  slice("const CSV_CONTAINERS_INYARD", "const POLICY_CARRIER_CONTRACTS"),
  slice("function parseCsv(text)", "function esc(value)"),
  slice("const COVERED_UNIT_TYPES", "function buildUserMessage")
].join("\n");

const sandbox = {};
new Function("g", code + "\n" +
  ["parseCsv","CONTAINERS_INYARD","EVAL_CASES","findContainer","caseScope","coverageCheck",
   "integrityCheck","priceLevers","allocateSlots","computePricing","renderPricingBrief",
   "slotMap","parseDate","isoDate","dayDiff","nextWeekdayAfter","CONTRACTS","DRAYAGE","MOVE_CAP"]
    .map(n => "g." + n + " = " + n + ";").join("\n")
)(sandbox);

const { EVAL_CASES, computePricing, renderPricingBrief } = sandbox;

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  console.log((ok ? "  PASS  " : "  FAIL  ") + label +
    (ok ? "  = " + actual : "\n          expected: " + expected + "\n          actual:   " + actual));
  ok ? pass++ : fail++;
}

function entryFor(pricing, id) {
  return pricing.scoped.find(e => e.container.container_id === id);
}
function lever(entry, name) {
  return entry.priced.levers.find(l => l.name === name);
}

const byId = {};
EVAL_CASES.forEach(c => { byId[c.case_id] = c; });

/* ---------------- EV-01 ---------------- */
console.log("\nEV-01  ranking two containers against the 4/day cap at WH-BCN");
{
  const p = computePricing(byId["EV-01"]);
  const alloc = p.allocation[0];
  check("contested date", alloc && alloc.date, "2026-08-04");
  check("free slots that day", alloc && alloc.free, 1);
  check("already booked", alloc && alloc.alreadyBooked.sort().join(","), "L-5522,P-2044,P-2048");
  check("slot winner (higher D&D)", alloc && alloc.winner, "L-5518");
  check("winner D&D rate", alloc && alloc.winnerRate, 150);
  check("loser pushed to", alloc && alloc.loser, "P-2041");
  check("loser new date", alloc && alloc.pushedTo, "2026-08-05");
  check("loser overrun days", alloc && alloc.newOverrun, 1);
  check("loser total (500 + 1x75)", alloc && alloc.newCost, 575);
  check("reverse order cost (500 + 1x150)", alloc && alloc.reverseCost, 650);
  check("saving from correct order", alloc && alloc.saving, 75);

  const l5518 = entryFor(p, "L-5518");
  check("L-5518 extension unavailable", lever(l5518, "extension").available, false);
  check("L-5518 reason mentions window", /request window/.test(lever(l5518, "extension").reason), true);
  const p2041 = entryFor(p, "P-2041");
  check("P-2041 extension unavailable", lever(p2041, "extension").available, false);
  check("P-2041 reason: no product", /sells no extension/.test(lever(p2041, "extension").reason), true);
}

/* ---------------- EV-02 ---------------- */
console.log("\nEV-02  extension is the cheaper lever (3-day overrun)");
{
  const p = computePricing(byId["EV-02"]);
  const e = entryFor(p, "L-5530");
  check("overrun days", e.priced.overrun, 3);
  check("extension available", lever(e, "extension").available, true);
  check("extension total (500 + 3x25)", lever(e, "extension").total, 575);
  check("expedite total (500 + 100)", lever(e, "expedite").total, 600);
  check("accept overrun total (500 + 3x150)", lever(e, "accept overrun").total, 950);
  check("cheapest lever", e.priced.cheapest.name, "extension");
  check("cheapest total", e.priced.cheapest.total, 575);
  check("no tie", e.priced.tie, "null");
}

/* ---------------- EV-03 ---------------- */
console.log("\nEV-03  expedite is the cheaper lever (6-day overrun) — the case that FAILED");
{
  const p = computePricing(byId["EV-03"]);
  const e = entryFor(p, "L-5533");
  check("overrun days", e.priced.overrun, 6);
  check("extension available", lever(e, "extension").available, true);
  check("extension total (500 + 6x25)", lever(e, "extension").total, 650);
  check("expedite total (500 + 100)", lever(e, "expedite").total, 600);
  check("accept overrun total (500 + 6x150)", lever(e, "accept overrun").total, 1400);
  check("cheapest lever", e.priced.cheapest.name, "expedite");
  check("cheapest total", e.priced.cheapest.total, 600);
  check("expedite beats extension by", 650 - 600, 50);
}

/* ---------------- EV-04 ---------------- */
console.log("\nEV-04  conflicting data — must refuse");
{
  const p = computePricing(byId["EV-04"]);
  const e = entryFor(p, "P-2055");
  check("engine refuses", !!e.refuse, true);
  check("trigger", e.refuse && e.refuse.trigger, "Conflicting data");
  check("names discharge_confirmed conflict",
    e.refuse && e.refuse.problems.some(x => /discharge_confirmed/.test(x)), true);
  check("names missing yard slot",
    e.refuse && e.refuse.problems.some(x => /yard slot/.test(x)), true);
  check("no price produced", e.priced, "undefined");
}

/* ---------------- EV-05 ---------------- */
console.log("\nEV-05  uncovered unit type — must refuse (the boundary)");
{
  const p = computePricing(byId["EV-05"]);
  const e = entryFor(p, "P-2066");
  check("engine refuses", !!e.refuse, true);
  check("trigger", e.refuse && e.refuse.trigger, "No matching policy");
  check("cites CC-1 and CC-5", e.refuse && e.refuse.sections.join(","), "CC-1,CC-5");
  check("names the 40NOR unit type", /40NOR/.test(e.refuse.reason), true);
  check("no price produced", e.priced, "undefined");
  check("no Poseidón terms borrowed", /75|14 day/.test(e.refuse.reason), false);
}

console.log("\n---------------------------------------------");
console.log("  " + pass + " passed, " + fail + " failed");
console.log("---------------------------------------------\n");

if (process.env.SHOW_BRIEF) {
  console.log("=== sample brief, EV-01 ===\n");
  console.log(renderPricingBrief(computePricing(byId["EV-01"])));
  console.log("=== sample brief, EV-05 ===\n");
  console.log(renderPricingBrief(computePricing(byId["EV-05"])));
}

process.exit(fail ? 1 : 0);
