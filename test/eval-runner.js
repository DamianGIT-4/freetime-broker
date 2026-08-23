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

/* ---------------- the review surface ----------------------------------
   A sweep produces JSON. JSON is evidence, not a review surface. This
   writes evals/report.html: self-contained, no server, committed with
   the run it describes.

   Built around one assumption — at 100 runs the bottleneck is human
   attention, not measurement. So the report leads with what changed
   since last time and which specific check failed most often, and keeps
   transcripts one click away rather than on the page. Its job is to tell
   you which three runs to read out of five hundred.
   -------------------------------------------------------------------- */

function escHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function writeReport(repo, latest, historyPath, record) {
  const e = escHtml;
  let history = [];
  try {
    history = fs.readFileSync(historyPath, "utf8").trim().split("\n")
      .filter(Boolean).map(l => JSON.parse(l));
  } catch (err) { /* first sweep */ }

  const previous = history.length > 1 ? history[history.length - 2] : null;
  const ids = Object.keys(latest.cases);

  const rows = ids.map(id => {
    const c = latest.cases[id];
    const pct = Math.round(c.mechanical_rate * 100);
    const kind = pct >= 95 ? "ok" : pct >= 80 ? "warn" : "bad";

    let delta = "<span class='flat'>—</span>";
    if (previous && typeof (previous.rates || {})[id] === "number") {
      const d = Math.round((c.mechanical_rate - previous.rates[id]) * 100);
      delta = d > 0 ? "<span class='up'>+" + d + "</span>"
            : d < 0 ? "<span class='down'>" + d + "</span>"
            : "<span class='flat'>0</span>";
    }

    const spark = history.map(h => {
      const r = (h.rates || {})[id];
      if (typeof r !== "number") return "";
      return "<i style='height:" + Math.max(2, Math.round(r * 18)) + "px' title='"
        + e(h.sweep_id) + ": " + Math.round(r * 100) + "%'></i>";
    }).join("");

    return "<tr>"
      + "<td class='mono'>" + e(id) + "<div class='sub'>" + e(c.name) + "</div></td>"
      + "<td class='rate'><span class='track'><span class='fill " + kind
        + "' style='width:" + pct + "%'></span></span>"
        + "<span class='num'>" + pct + "%</span></td>"
      + "<td class='mono'>" + e(c.passes) + "/" + e(c.runs) + "</td>"
      + "<td>" + delta + "</td>"
      + "<td class='spark'>" + spark + "</td>"
      + "<td>" + (c.top_failure ? "<span class='fail'>" + e(c.top_failure) + "</span>"
                                : "<span class='flat'>clean</span>") + "</td>"
      + "<td>" + (c.verdict ? e(c.verdict) : "<span class='flat'>not judged</span>")
        + (c.note ? "<div class='sub'>" + e(c.note) + "</div>" : "") + "</td>"
      + "</tr>";
  }).join("");

  const allFailures = {};
  Object.keys(record.cases).forEach(id => {
    Object.entries(record.cases[id].failures || {}).forEach(function (pair) {
      const key = id + " · " + pair[0];
      allFailures[key] = (allFailures[key] || 0) + pair[1];
    });
  });
  const failureRows = Object.entries(allFailures)
    .sort((a, b) => b[1] - a[1]).slice(0, 12)
    .map(pair => "<tr><td class='mono'>" + e(pair[1]) + "×</td><td>" + e(pair[0]) + "</td></tr>")
    .join("") || "<tr><td colspan='2' class='flat'>No failing checks in this sweep.</td></tr>";

  const sweepRows = history.slice().reverse().slice(0, 12).map(h =>
    "<tr><td class='mono'>" + e((h.started || "").slice(0, 16).replace("T", " ")) + "</td>"
    + "<td class='mono'>" + e(h.git_sha || "—") + "</td>"
    + "<td class='mono'>" + e(h.runs_per_case) + "</td>"
    + "<td>" + ids.map(id => {
        const r = (h.rates || {})[id];
        return typeof r === "number"
          ? "<span class='pill'>" + e(id.replace("EV-", "")) + " " + Math.round(r * 100) + "%</span>"
          : "";
      }).join(" ") + "</td></tr>"
  ).join("");

  const html = [
    "<!doctype html>", "<meta charset=\"utf-8\">",
    "<title>Freetime Broker — eval report</title>",
    "<style>",
    ":root{color-scheme:dark;--bg:#0d1117;--card:#161b22;--line:#30363d;--ink:#e6edf3;",
    "--ink2:#9aa6b2;--ok:#3fb950;--warn:#d29922;--bad:#f85149}",
    "body{margin:0;padding:32px;background:var(--bg);color:var(--ink);",
    "font:14px/1.55 ui-sans-serif,-apple-system,Segoe UI,Roboto,sans-serif}",
    "h1{font-size:20px;margin:0 0 4px}",
    "h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink2);margin:32px 0 10px}",
    ".meta{color:var(--ink2);font-size:13px}",
    ".mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}",
    ".card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:18px 20px;margin-top:12px}",
    "table{width:100%;border-collapse:collapse}",
    "th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em;",
    "color:var(--ink2);font-weight:600;padding:6px 10px 6px 0}",
    "td{padding:10px 10px 10px 0;border-top:1px solid var(--line);vertical-align:top}",
    ".sub{color:var(--ink2);font-size:12px;margin-top:2px}",
    ".rate{min-width:190px}",
    ".track{display:inline-block;width:130px;height:8px;border-radius:99px;background:#21262d;",
    "overflow:hidden;vertical-align:middle}",
    ".fill{display:block;height:100%}",
    ".fill.ok{background:var(--ok)}.fill.warn{background:var(--warn)}.fill.bad{background:var(--bad)}",
    ".num{margin-left:8px;font-family:ui-monospace,monospace}",
    ".up{color:var(--ok)}.down{color:var(--bad)}.flat{color:var(--ink2)}.fail{color:var(--warn)}",
    ".spark{white-space:nowrap}",
    ".spark i{display:inline-block;width:5px;margin-right:2px;background:#3b82f6;border-radius:1px;vertical-align:bottom}",
    ".pill{display:inline-block;padding:1px 7px;border-radius:99px;background:#21262d;",
    "color:var(--ink2);font-size:12px;font-family:ui-monospace,monospace}",
    ".note{color:var(--ink2);font-size:13px;border-left:2px solid var(--line);padding-left:12px;margin-top:16px}",
    "</style>",
    "<h1>Freetime Broker — eval report</h1>",
    "<p class=\"meta\">Sweep " + e((latest.started || "").slice(0, 16).replace("T", " "))
      + " · " + e(latest.model) + " · " + e(latest.runs_per_case) + " runs per case"
      + " · commit <span class=\"mono\">" + e(latest.git_sha || "unknown") + "</span></p>",
    "<h2>This sweep</h2><div class=\"card\"><table>",
    "<tr><th>Case</th><th>Mechanical rate</th><th>Clean</th><th>&Delta;</th>",
    "<th>History</th><th>Most common failure</th><th>Your verdict</th></tr>",
    rows,
    "</table><p class=\"note\">Mechanical checks compare the model's output against the pricing",
    "engine — independently computed arithmetic, not the agent grading itself. They do not judge",
    "whether the explanation is any good. That is the verdict column, and it is yours.</p></div>",
    "<h2>Where to look first</h2><div class=\"card\"><table>",
    "<tr><th>Count</th><th>Failing check</th></tr>", failureRows, "</table>",
    "<p class=\"note\">Ranked by frequency across every run in this sweep. At 100 runs per case you",
    "cannot read 500 transcripts — this is the list that says which handful to open. Full",
    "transcripts: <span class=\"mono\">" + e(latest.source || "evals/runs/") + "</span></p></div>",
    "<h2>Memory — every sweep on record</h2><div class=\"card\"><table>",
    "<tr><th>When</th><th>Commit</th><th>Runs</th><th>Rates</th></tr>", sweepRows, "</table>",
    "<p class=\"note\">Each sweep is tied to the commit that produced it. A pass rate without the",
    "code behind it is a statistic; with it, it is a record of cause and effect.</p></div>"
  ].join("\n");

  fs.writeFileSync(path.join(repo, "evals", "report.html"), html);
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

  /* Which commit produced these numbers. A pass rate without the code that
     produced it is a statistic; with it, it is evidence. This one field is
     what turns history.jsonl into a record of cause and effect. */
  const gitSha = (function () {
    try {
      return require("child_process")
        .execSync("git rev-parse --short HEAD", { cwd: REPO, stdio: ["ignore", "pipe", "ignore"] })
        .toString().trim();
    } catch (e) { return null; }
  })();

  const record = {
    started: started.toISOString(), model: MODEL_ID, runs_per_case: RUNS,
    git_sha: gitSha, cases: {}
  };
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

    const topFailure = worst.length ? worst[0][0] : null;

    summary.push({ id: evalCase.case_id, name: evalCase.case_name, passes, rate, errored, worst });
    record.cases[evalCase.case_id] = {
      name: evalCase.case_name,
      expected_status: evalCase.expected_status,
      passes, runs: RUNS, rate,
      mechanical_rate: passes / RUNS,
      top_failure: topFailure,
      verdict: "",                 /* filled in by hand — see evals/RESULTS.md */
      note: "",
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

  /* ---- latest.json — what the product's Evals tab reads ----------------
     Deliberately WITHOUT the raw transcripts: the page needs rates and
     provenance, not several megabytes of model output. The transcripts
     stay in evals/runs/ where the report and a human can reach them. */
  const latest = {
    started: record.started, model: record.model, git_sha: record.git_sha,
    runs_per_case: record.runs_per_case, source: path.relative(REPO, outFile),
    cases: {}
  };
  Object.keys(record.cases).forEach(id => {
    const c = record.cases[id];
    latest.cases[id] = {
      name: c.name, passes: c.passes, runs: c.runs,
      mechanical_rate: c.mechanical_rate, top_failure: c.top_failure,
      verdict: c.verdict, note: c.note
    };
  });
  const latestPath = path.join(REPO, "evals", "latest.json");
  fs.writeFileSync(latestPath, JSON.stringify(latest, null, 2));

  /* ---- history.jsonl — memory across sweeps ---------------------------
     Append-only, one line per sweep, each tied to the commit that
     produced it. This is what makes "EV-03 went 12% -> 94%" a claim about
     a specific change rather than a number with no cause. */
  const historyPath = path.join(REPO, "evals", "history.jsonl");
  const historyLine = JSON.stringify({
    sweep_id: stamp, started: record.started, git_sha: record.git_sha,
    model: record.model, runs_per_case: RUNS,
    rates: summary.reduce((acc, s) => { acc[s.id] = s.passes / RUNS; return acc; }, {}),
    source: path.relative(REPO, outFile)
  });
  fs.appendFileSync(historyPath, historyLine + "\n");

  /* ---- previous sweep, for the delta ---- */
  let previous = null;
  try {
    const lines = fs.readFileSync(historyPath, "utf8").trim().split("\n").filter(Boolean);
    if (lines.length > 1) previous = JSON.parse(lines[lines.length - 2]);
  } catch (e) { /* first sweep */ }

  if (previous) {
    console.log("\nAgainst the previous sweep (" + (previous.git_sha || "unknown commit") + "):");
    summary.forEach(s => {
      const before = previous.rates && previous.rates[s.id];
      if (typeof before !== "number") return;
      const delta = Math.round((s.passes / RUNS - before) * 100);
      const arrow = delta > 0 ? "up " + delta : delta < 0 ? "down " + Math.abs(delta) : "unchanged";
      console.log("  " + s.id.padEnd(8) + Math.round(before * 100) + "% -> " + s.rate + "%  " + arrow);
    });
  }

  writeReport(REPO, latest, historyPath, record);

  /* ---- results stub for the human verdicts ---- */
  const resultsPath = path.join(REPO, "evals", "RESULTS.md");
  const block = [
    "## Sweep " + started.toISOString().slice(0, 10) + " · " + MODEL_ID + " · " + RUNS + " runs per case",
    "",
    (record.git_sha ? "Commit `" + record.git_sha + "`. " : "")
      + "Mechanical pass rate is checked automatically against the pricing engine.",
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

  console.log("\nWritten:");
  console.log("  evals/latest.json      <- the product's Evals tab reads this");
  console.log("  evals/history.jsonl    <- one line per sweep, tied to a commit");
  console.log("  evals/report.html      <- open this to review");
  console.log("  evals/RESULTS.md       <- verdict column is yours to fill in");
})().catch(err => {
  console.error("\n" + err.stack || err);
  process.exit(1);
});
