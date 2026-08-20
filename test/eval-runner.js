#!/usr/bin/env node
/* =====================================================================
   EVAL RUNNER — measures the agent instead of testing it once.

   The agent is non-deterministic. Two cases have already been observed
   behaving differently across identical runs, so a single pass/fail
   verdict is close to noise. This runs each case N times and reports a
   pass RATE.

   What it checks is mechanical, and only what the pricing engine can
   independently prove:

     - did STATUS match the case's expected status?
     - does RECOMMENDATION name the total the engine marked cheapest?
     - does OPTIONS reproduce the engine's totals, or did the model
       quietly alter one?
     - on refusal cases: no cost figure, no return day, required
       sections cited?
     - did the output parse into the labelled fields at all?

   It does NOT judge whether the explanation is any good. That stays a
   human verdict, entered in the app's Evals view. This tool never
   scores the prose — it only checks the model against arithmetic that
   was computed somewhere else.

   Usage:
     export ANTHROPIC_API_KEY=...            (never pass it as an argument)
     node test/eval-runner.js --runs 20
     node test/eval-runner.js --case EV-03 --runs 30
     node test/eval-runner.js --dry-run      (build the request, call nothing)
   ===================================================================== */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

/* ---------------- arguments ---------------- */

const argv = process.argv.slice(2);
function arg(name, fallback) {
  const i = argv.indexOf("--" + name);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
}
const FLAG = name => argv.indexOf("--" + name) !== -1;

const RUNS        = Number(arg("runs", 20));
const ONLY_CASE   = arg("case", null);
const MODEL       = arg("model", null);          /* default comes from index.html */
const CONCURRENCY = Number(arg("concurrency", 3));
const DRY_RUN     = FLAG("dry-run");
const SOURCE      = arg("source", path.join(__dirname, "..", "index.html"));

const REPO = path.join(__dirname, "..");
const RUNS_DIR = path.join(REPO, "evals", "runs");

/* ---------------- pull the real thing out of index.html ----------------
   The runner deliberately does not reimplement the prompt, the policies
   or the engine. It extracts them from the shipped file, so a drift
   between what is tested and what is served is impossible. */

const SRC = fs.readFileSync(SOURCE, "utf8");

function sliceBetween(startMarker, endMarker) {
  const a = SRC.indexOf(startMarker);
  if (a === -1) throw new Error("could not find start marker: " + startMarker);
  const b = SRC.indexOf(endMarker, a);
  if (b === -1) throw new Error("could not find end marker: " + endMarker);
  return SRC.slice(a, b);
}

/* everything from the data through buildUserMessage, stopping before the
   browser-only API call section */
const agentCallIdx = SRC.indexOf("THE AGENT CALL");
const commentStart = SRC.lastIndexOf("/*", agentCallIdx);
const mainSlab = SRC.slice(SRC.indexOf("const MODEL = "), commentStart);

/* the output parser */
const parserSlab = sliceBetween("const AGENT_FIELDS", "const ESCALATION_OWNERS");

/* The extracted slab is browser code and registers a few listeners at the
   top level. None of it runs here — these stubs exist only so the module
   body evaluates, giving access to the prompt, the engine and the parser. */
const noopEl = {
  addEventListener() {}, removeEventListener() {}, appendChild() {},
  setAttribute() {}, removeAttribute() {}, focus() {}, click() {},
  querySelector: () => null, querySelectorAll: () => [],
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  style: {}, dataset: {}, value: "", textContent: "", innerHTML: ""
};
const sandbox = {
  console,
  document: Object.assign(Object.create(noopEl), {
    getElementById: () => noopEl,
    createElement: () => noopEl,
    querySelector: () => noopEl,
    querySelectorAll: () => [],
    body: noopEl, documentElement: noopEl
  }),
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  window: Object.assign(Object.create(noopEl), { location: { href: "" } }),
  navigator: { userAgent: "eval-runner" },
  setTimeout, clearTimeout, fetch
};
vm.createContext(sandbox);
new vm.Script(mainSlab + "\n" + parserSlab + "\n" +
  "this.__api = { EVAL_CASES, SYSTEM_PROMPT, MODEL, MAX_TOKENS, buildUserMessage," +
  " computePricing, renderPricingBrief, parseAgentOutput, isoDate };",
  { filename: "extracted-from-index.html" }).runInContext(sandbox);

const API = sandbox.__api;
const MODEL_ID = MODEL || API.MODEL;

/* ---------------- the mechanical checks ---------------- */

function eurosIn(text) {
  const out = [];
  const re = /(\d[\d.,]*)\s*(?:EUR|€)|(?:EUR|€)\s*(\d[\d.,]*)/gi;
  let m;
  while ((m = re.exec(text || "")) !== null) {
    const raw = (m[1] || m[2] || "").replace(/[.,](?=\d{3}\b)/g, "").replace(",", ".");
    const n = Number(raw);
    if (!isNaN(n)) out.push(n);
  }
  return out;
}

function checkRun(evalCase, pricing, parsed) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok: !!ok, detail: detail || "" });

  add("output parsed", parsed.problems.length === 0,
      parsed.problems.slice(0, 3).join(" | "));

  const expected = (evalCase.expected_status || "").trim().toUpperCase();

  pricing.scoped.forEach(entry => {
    const id = entry.container.container_id;
    const block = parsed.blocks.find(b => (b.CONTAINER || "").indexOf(id) !== -1);

    if (!block) { add(id + ": block present", false, "no block for this container"); return; }

    if (entry.refuse) {
      add(id + ": refused", block._status === "REFUSED-ESCALATE",
          "status was " + block._status);
      add(id + ": no cost figure", eurosIn(block.RECOMMENDATION).length === 0,
          "found " + eurosIn(block.RECOMMENDATION).join(", "));
      add(id + ": no return day",
          /^\s*NONE\s*$/i.test(block["RETURN DAY"] || ""),
          "return day was " + (block["RETURN DAY"] || "(absent)"));
      const sources = (block.SOURCES || "").toUpperCase();
      entry.refuse.sections.forEach(sec => {
        add(id + ": cites " + sec, sources.indexOf(sec.toUpperCase()) !== -1,
            "SOURCES = " + (block.SOURCES || "(absent)"));
      });
      return;
    }

    /* priced container */
    add(id + ": not refused", block._status === "OK", "status was " + block._status);

    const cheapest = entry.priced.cheapest;
    if (cheapest) {
      const recEuros = eurosIn(block.RECOMMENDATION);
      add(id + ": recommends engine cheapest (" + cheapest.total + ")",
          recEuros.indexOf(cheapest.total) !== -1,
          "RECOMMENDATION had " + (recEuros.join(", ") || "no figure"));
    }

    const optEuros = eurosIn(block.OPTIONS);
    entry.priced.levers.filter(l => l.available).forEach(l => {
      add(id + ": OPTIONS keeps " + l.name + " at " + l.total,
          optEuros.indexOf(l.total) !== -1,
          "OPTIONS had " + (optEuros.join(", ") || "no figures"));
    });
  });

  const anyRefusalExpected = expected === "REFUSED-ESCALATE";
  const sawRefusal = parsed.blocks.some(b => b._status === "REFUSED-ESCALATE");
  add("case status = " + expected, anyRefusalExpected === sawRefusal,
      "expected " + expected + ", saw " + (sawRefusal ? "a refusal" : "no refusal"));

  return { checks, passed: checks.every(c => c.ok) };
}

/* ---------------- the call ---------------- */

async function callModel(userMessage, apiKey) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: MODEL_ID,
      max_tokens: API.MAX_TOKENS,
      /* The system prompt is byte-identical on every run, so it is marked
         cacheable. Across a 100-run sweep that prefix is otherwise re-sent
         100 times for no reason. */
      system: [{ type: "text", text: API.SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userMessage }]
    })
  });

  const body = await res.json();
  if (!res.ok) {
    throw new Error("HTTP " + res.status + ": " +
      (body && body.error ? body.error.message : JSON.stringify(body).slice(0, 300)));
  }
  return {
    text: (body.content || []).filter(b => b.type === "text").map(b => b.text).join(""),
    usage: body.usage || {}
  };
}

async function pool(items, size, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }));
  return results;
}

/* ---------------- self-test ----------------
   Proves the checks above actually catch the failure they were written
   for, by replaying the recorded EV-03 bug: every figure correct, the
   cheapest lever named, and then a refusal citing the rule it had just
   satisfied. If the runner cannot fail that output, it cannot be trusted
   to pass anything. Makes no API call. */

function block(fields) {
  return Object.entries(fields).map(([k, v]) => k + ": " + v).join("\n");
}

function selfTest() {
  const evalCase = API.EVAL_CASES.find(c => c.case_id === "EV-03");
  const pricing = API.computePricing(evalCase);
  let ok = true;

  const common = {
    CONTAINER: "L-5533", CARRIER: "Leviatán Lines", "CONTAINER TYPE": "20DRY",
    "DAYS LEFT": "8",
    COUNTS: "1 container within 2 days of expiry (none); threshold 5; NOT MET.",
    OPTIONS: "accept overrun 6 days = 1400 EUR; expedite = 600 EUR; " +
             "extension 6 days = 650 EUR; CHEAPEST: expedite 600 EUR",
    RATIONALE: "Expedite at 600 EUR beats the 650 EUR extension by 50 EUR.",
    WHY: "days_left, next_standard_slot; CC-3, XV-2, XV-4",
    SOURCES: "L-5533, CC-3, XV-2, XV-4"
  };

  const good = "WAREHOUSE SUMMARY: WH-BCN 84% at-risk, 1 reviewed, 1 at risk, 0 escalated, 600 EUR\n" +
    block(Object.assign({}, common, {
      RISK: "AT RISK", STATUS: "OK",
      RECOMMENDATION: "Expedite the return at 600 EUR.",
      "RETURN DAY": "2026-08-11", ESCALATION: "NONE"
    }));

  /* the recorded failure: correct arithmetic, contradictory verdict */
  const historical = "WAREHOUSE SUMMARY: WH-BCN 84% at-risk, 1 reviewed, 1 at risk, 1 escalated, 0 EUR\n" +
    block(Object.assign({}, common, {
      RISK: "ESCALATE", STATUS: "REFUSED-ESCALATE",
      RECOMMENDATION: "REFUSED — carrier_contracts.md CC-3: extension request window.",
      "RETURN DAY": "NONE", ESCALATION: "No feasible plan — could not settle the levers."
    }));

  /* the subtler failure: refuses nothing, but quietly alters a total */
  const altered = "WAREHOUSE SUMMARY: WH-BCN 84% at-risk, 1 reviewed, 1 at risk, 0 escalated, 550 EUR\n" +
    block(Object.assign({}, common, {
      OPTIONS: "accept overrun 6 days = 1400 EUR; expedite = 550 EUR; " +
               "extension 6 days = 650 EUR; CHEAPEST: expedite 550 EUR",
      RISK: "AT RISK", STATUS: "OK",
      RECOMMENDATION: "Expedite the return at 550 EUR.",
      "RETURN DAY": "2026-08-11", ESCALATION: "NONE"
    }));

  function run(label, text, shouldPass, expectFailure) {
    const verdict = checkRun(evalCase, pricing, API.parseAgentOutput(text));
    const good = verdict.passed === shouldPass;
    const failed = verdict.checks.filter(c => !c.ok).map(c => c.name);
    const caught = !expectFailure || failed.some(n => n.indexOf(expectFailure) !== -1);
    const pass = good && caught;
    if (!pass) ok = false;
    console.log("  " + (pass ? "PASS" : "FAIL") + "  " + label +
      (shouldPass ? "  (expected clean)" : "  (expected to be caught)"));
    if (!shouldPass) failed.slice(0, 4).forEach(n => console.log("          caught: " + n));
    if (!pass) console.log("          !! verdict.passed = " + verdict.passed);
  }

  console.log("\nSelf-test — can the runner tell good output from the recorded bug?\n");
  run("a correct EV-03 answer", good, true, null);
  run("the recorded EV-03 failure (correct maths, contradictory refusal)",
      historical, false, "not refused");
  run("a quietly altered total (600 -> 550)", altered, false, "OPTIONS keeps");

  console.log("\n  " + (ok ? "Self-test passed." : "SELF-TEST FAILED — the checks are not trustworthy.") + "\n");
  return ok;
}

/* ---------------- main ---------------- */

(async function main() {
  if (FLAG("self-test")) { process.exit(selfTest() ? 0 : 1); }

  const cases = API.EVAL_CASES.filter(c => !ONLY_CASE || c.case_id === ONLY_CASE);
  if (!cases.length) {
    console.error("No such case: " + ONLY_CASE);
    console.error("Available: " + API.EVAL_CASES.map(c => c.case_id).join(", "));
    process.exit(2);
  }

  if (DRY_RUN) {
    const c = cases[0];
    const msg = API.buildUserMessage(c);
    console.log("Model:  " + MODEL_ID);
    console.log("Case:   " + c.case_id + " — " + c.case_name);
    console.log("System prompt: " + API.SYSTEM_PROMPT.length + " chars");
    console.log("User message:  " + msg.length + " chars\n");
    console.log("--- pricing brief the model will receive ---\n");
    console.log(API.renderPricingBrief(API.computePricing(c)));
    console.log("--- no API call made (--dry-run) ---");
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY is not set.\n");
    console.error("  export ANTHROPIC_API_KEY=sk-ant-...");
    console.error("  node test/eval-runner.js --runs " + RUNS + "\n");
    console.error("Pass it as an environment variable, never as a command argument —");
    console.error("arguments end up in your shell history.");
    process.exit(2);
  }

  const started = new Date();
  console.log("Model: " + MODEL_ID + " · " + cases.length + " case(s) × " + RUNS +
              " runs · concurrency " + CONCURRENCY + "\n");

  const record = { started: started.toISOString(), model: MODEL_ID, runs_per_case: RUNS, cases: {} };
  const summary = [];

  for (const evalCase of cases) {
    const pricing = API.computePricing(evalCase);
    const userMessage = API.buildUserMessage(evalCase);
    const attempts = Array.from({ length: RUNS }, (_, i) => i + 1);

    process.stdout.write(evalCase.case_id + "  ");

    const results = await pool(attempts, CONCURRENCY, async () => {
      try {
        const { text, usage } = await callModel(userMessage, apiKey);
        const parsed = API.parseAgentOutput(text);
        const verdict = checkRun(evalCase, pricing, parsed);
        process.stdout.write(verdict.passed ? "." : "x");
        return { ok: true, passed: verdict.passed, checks: verdict.checks, text, usage };
      } catch (err) {
        process.stdout.write("!");
        return { ok: false, passed: false, error: String(err.message || err) };
      }
    });

    const errored = results.filter(r => !r.ok).length;
    const passes = results.filter(r => r.passed).length;
    const rate = Math.round((passes / RUNS) * 100);

    /* which specific check failed most often — the useful diagnostic */
    const failCounts = {};
    results.filter(r => r.ok && !r.passed).forEach(r =>
      r.checks.filter(c => !c.ok).forEach(c => { failCounts[c.name] = (failCounts[c.name] || 0) + 1; }));
    const worst = Object.entries(failCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);

    console.log("  " + passes + "/" + RUNS + "  " + rate + "%" +
                (errored ? "  (" + errored + " API error(s))" : ""));
    worst.forEach(([name, n]) => console.log("        " + n + "x  " + name));

    summary.push({ id: evalCase.case_id, name: evalCase.case_name, passes, rate, errored, worst });
    record.cases[evalCase.case_id] = {
      name: evalCase.case_name,
      expected_status: evalCase.expected_status,
      passes, runs: RUNS, rate,
      failures: failCounts,
      raw: results.map(r => r.ok ? { passed: r.passed, text: r.text, usage: r.usage }
                                 : { passed: false, error: r.error })
    };
  }

  /* ---- write the evidence ---- */
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  const stamp = started.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outFile = path.join(RUNS_DIR, stamp + ".json");
  fs.writeFileSync(outFile, JSON.stringify(record, null, 2));

  console.log("\n" + "-".repeat(58));
  console.log("  case    rate     mechanical checks");
  console.log("-".repeat(58));
  summary.forEach(s => console.log("  " + s.id.padEnd(8) + (s.rate + "%").padEnd(9) +
    s.passes + "/" + RUNS + " runs clean"));
  console.log("-".repeat(58));
  console.log("\nRaw outputs: " + path.relative(REPO, outFile));

  /* ---- results stub for the human verdicts ---- */
  const resultsPath = path.join(REPO, "evals", "RESULTS.md");
  const block = [
    "## Sweep " + started.toISOString().slice(0, 10) + " · " + MODEL_ID + " · " + RUNS + " runs per case",
    "",
    "Mechanical pass rate is checked automatically against the pricing engine.",
    "The verdict column is a human judgement of the explanation and is filled in by hand.",
    "",
    "| Case | Mechanical | Verdict | Note |",
    "|---|---|---|---|",
    ...summary.map(s => "| " + s.id + " | " + s.rate + "% (" + s.passes + "/" + RUNS + ") | | |"),
    "",
    "Raw outputs: `" + path.relative(REPO, outFile) + "`",
    ""
  ].join("\n");

  let existing = "";
  if (fs.existsSync(resultsPath)) {
    existing = fs.readFileSync(resultsPath, "utf8");
  } else {
    existing = [
      "# Eval results",
      "",
      "Newest sweep first. Mechanical pass rates are produced by `test/eval-runner.js`",
      "and check only what the pricing engine can independently prove. The Verdict",
      "column is a human judgement of whether the explanation is any good — the tool",
      "does not score prose, and the console never scores itself.",
      ""
    ].join("\n");
  }
  const marker = "\n## Sweep ";
  const head = existing.indexOf(marker) === -1 ? existing : existing.slice(0, existing.indexOf(marker) + 1);
  const tail = existing.indexOf(marker) === -1 ? "" : existing.slice(existing.indexOf(marker) + 1);
  fs.writeFileSync(resultsPath, head + "\n" + block + "\n" + tail);

  console.log("Scoreboard:  evals/RESULTS.md   (verdict column is yours to fill in)");
})().catch(err => {
  console.error("\n" + err.stack || err);
  process.exit(1);
});
