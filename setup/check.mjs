// Checks the live permissions (Row Level Security) using the real PINs. Run: node setup/check.mjs
// Uses dates in 2099 and cleans up after itself.
import { readFileSync } from "node:fs";
import { SUPABASE_URL as URL_, SUPABASE_KEY as KEY } from "../config.js";

const pins = Object.fromEntries(readFileSync(new URL("PINS.local.txt", import.meta.url), "utf8").trim().split("\n").map(l => l.split(": ")));
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "  ok   " : "  FAIL ") + msg); if (!cond) fails++; };

async function signIn(name) {
  const r = await fetch(URL_ + "/auth/v1/token?grant_type=password", { method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: name.toLowerCase() + "@hangout.local", password: pins[name] }) });
  const j = await r.json(); if (!r.ok) throw new Error(name + " sign-in failed: " + JSON.stringify(j));
  return j.access_token;
}
async function rest(tok, method, path, body) {
  const r = await fetch(URL_ + "/rest/v1/" + path, { method, body: body ? JSON.stringify(body) : undefined,
    headers: { apikey: KEY, ...(tok ? { Authorization: "Bearer " + tok } : {}), "Content-Type": "application/json", Prefer: "return=representation" } });
  const text = await r.text(); let data = null; try { data = JSON.parse(text); } catch {}
  return { status: r.status, ok: r.ok, data };
}

const T = { Ross: await signIn("Ross"), Baz: await signIn("Baz"), Patrick: await signIn("Patrick") };
ok(true, "all three PINs sign in");

const bad = await fetch(URL_ + "/auth/v1/token?grant_type=password", { method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ email: "ross@hangout.local", password: "000000x" }) });
ok(!bad.ok, "wrong PIN is rejected");
const su = await fetch(URL_ + "/auth/v1/signup", { method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ email: "intruder@example.com", password: "12345678" }) });
ok(!su.ok, "public sign-up is disabled");

const anon = await rest(null, "GET", "rota?select=*");
ok(!anon.ok || (Array.isArray(anon.data) && anon.data.length === 0), "signed-out visitors see nothing");

const rota = await rest(T.Baz, "GET", "rota?select=*");
ok(rota.ok && rota.data.length > 0, "Baz can read the rota (" + (rota.data || []).length + " rows)");
const rossLogs = await rest(T.Patrick, "GET", "logs?select=*&person=eq.Ross");
ok(rossLogs.ok && rossLogs.data.length > 0, "Patrick can read Ross's logs");

// rota: anyone adds/removes anyone, two people on one day
const D = "2099-06-01";
ok((await rest(T.Baz, "POST", "rota", { date: D, person: "Ross" })).ok, "Baz can put Ross on the rota");
ok((await rest(T.Baz, "POST", "rota", { date: D, person: "Patrick" })).ok, "…and Patrick on the same day");
const day = await rest(T.Ross, "GET", "rota?select=person&date=eq." + D);
ok(day.data.length === 2, "two people on one day");
const spoof = await rest(T.Baz, "POST", "rota", { date: "2099-06-02", person: "Baz", created_by: "00000000-0000-0000-0000-000000000000" });
ok(!spoof.ok, "rota rows can't claim someone else added them");
const rm = await rest(T.Patrick, "DELETE", "rota?date=eq." + D);
ok(rm.ok && rm.data.length === 2, "Patrick can take both off");

// logs: own only
const forged = await rest(T.Baz, "POST", "logs", { person: "Ross", date: D, category: "other", hours: 1 });
ok(!forged.ok, "Baz can't log hours as Ross");
const mine = await rest(T.Baz, "POST", "logs", { person: "Baz", date: D, category: "maintenance", hours: 1.5, note: "check" });
ok(mine.ok, "Baz can log his own hours");
const id = mine.data && mine.data[0] && mine.data[0].id;
const edit = await rest(T.Ross, "PATCH", "logs?id=eq." + id, { hours: 9 });
ok(edit.ok && edit.data.length === 0, "Ross can't edit Baz's log");
const del = await rest(T.Ross, "DELETE", "logs?id=eq." + id);
ok(del.ok && del.data.length === 0, "Ross can't delete Baz's log");
ok((await rest(T.Baz, "DELETE", "logs?id=eq." + id)).data.length === 1, "Baz can delete his own log");
ok(!(await rest(T.Baz, "POST", "logs", { person: "Baz", date: D, category: "other", hours: 25 })).ok, "hours over 24 are refused");

// shift notes: own only
ok(!(await rest(T.Baz, "POST", "shift_notes", { person: "Ross", date: D, note: "x" })).ok, "Baz can't write Ross's shift note");

// costs
const c = await rest(T.Ross, "POST", "expenses", { person: "Ross", date: D, amount_gbp: 12.5, description: "check" });
ok(c.ok, "Ross can add a cost");
const cid = c.data && c.data[0] && c.data[0].id;
const pay = { status: "reimbursed", reimbursed_at: new Date().toISOString(), reimbursed_method: "bank" };
ok((await rest(T.Baz, "PATCH", "expenses?id=eq." + cid, pay)).data.length === 0, "Baz can't mark Ross's cost reimbursed");
ok(!(await rest(T.Baz, "POST", "expenses", { person: "Ross", date: D, amount_gbp: 1, description: "x" })).ok, "Baz can't add a cost as Ross");
ok(!(await rest(T.Ross, "POST", "expenses", { person: "Ross", date: D, amount_gbp: 0, description: "x" })).ok, "£0 costs are refused");
ok((await rest(T.Ross, "PATCH", "expenses?id=eq." + cid, pay)).data.length === 1, "Ross can mark it reimbursed (bank)");
ok((await rest(T.Ross, "DELETE", "expenses?id=eq." + cid)).data.length === 0, "a reimbursed cost can't be deleted");
ok((await rest(T.Ross, "PATCH", "expenses?id=eq." + cid, { status: "unpaid", reimbursed_at: null, reimbursed_method: null })).data.length === 1, "Ross can undo it");
ok((await rest(T.Baz, "DELETE", "expenses?id=eq." + cid)).data.length === 0, "Baz can't delete Ross's cost");
ok((await rest(T.Ross, "DELETE", "expenses?id=eq." + cid)).data.length === 1, "Ross can delete his unpaid cost");

console.log(fails ? "\n" + fails + " check(s) FAILED" : "\nAll checks passed");
process.exit(fails ? 1 : 0);
