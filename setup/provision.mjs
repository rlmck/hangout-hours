// One-off setup of the Supabase backend. Safe to re-run: it reuses the project, never deletes data
// and only imports the old data into empty tables.
//
//   node setup/provision.mjs <supabase-access-token>                 create/update everything
//   node setup/provision.mjs <token> --reset-pin Baz                  give Baz a new random PIN
//   node setup/provision.mjs <token> --reset-pins                     new PINs for everyone
//
// The access token comes from https://supabase.com/dashboard/account/tokens (revoke it afterwards).
// Writes config.js (public URL + publishable key) and setup/PINS.local.txt (git-ignored).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomInt, randomBytes } from "node:crypto";

const here = new URL(".", import.meta.url);
const args = process.argv.slice(2);
const flag = f => args.includes(f);
const opt = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const TOKEN = args.find(a => a.startsWith("sbp_")) || process.env.SUPABASE_ACCESS_TOKEN
  || (existsSync(new URL(".token", here)) ? readFileSync(new URL(".token", here), "utf8").trim() : "");
if (!TOKEN) { console.error("Give a Supabase access token (sbp_...) as the first argument."); process.exit(1); }

const NAME = "hangout-hours", REGION = opt("--region") || "eu-west-2";   // London
const STAFF = ["Ross", "Baz", "Patrick"], DOMAIN = "hangout.local";
const SITE = opt("--site") || "https://rlmck.github.io/hangout-hours/";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log("•", ...a);

async function mgmt(path, { method = "GET", body } = {}) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch("https://api.supabase.com" + path, {
      method, headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    if (res.ok) return text ? JSON.parse(text) : null;
    if (attempt < 8 && (res.status >= 500 || res.status === 429 || res.status === 503)) { await sleep(5000 * attempt); continue; }
    throw new Error(method + " " + path + " → " + res.status + " " + text);
  }
}
const sql = (ref, query) => mgmt("/v1/projects/" + ref + "/database/query", { method: "POST", body: { query } });
const lit = v => v == null ? "null" : typeof v === "number" ? String(v) : "'" + String(v).replace(/'/g, "''") + "'";

/* 1. project */
let project = (await mgmt("/v1/projects")).find(p => p.name === NAME);
if (project) log("Using existing project", project.id);
else {
  const orgs = await mgmt("/v1/organizations");
  if (!orgs.length) throw new Error("No Supabase organisation on this account – create one in the dashboard first.");
  const org = orgs.find(o => o.id === opt("--org") || o.slug === opt("--org") || o.name === opt("--org")) || orgs[0];
  log("Creating project", NAME, "in", org.name, "(" + REGION + ")");
  const dbPass = randomBytes(24).toString("base64url");
  project = await mgmt("/v1/projects", { method: "POST", body: { name: NAME, organization_id: org.id, db_pass: dbPass, region: REGION } });
  writeFileSync(new URL("DB.local.txt", here), "Database password for " + project.id + ": " + dbPass + "\n");
}
const ref = project.id;
for (let i = 0; ; i++) {
  const p = await mgmt("/v1/projects/" + ref);
  if (p.status === "ACTIVE_HEALTHY") break;
  if (i === 0) log("Waiting for the project to start (a few minutes)…");
  if (i > 90) throw new Error("Project not healthy after 15 min: " + p.status);
  await sleep(10000);
}
const URL_ = "https://" + ref + ".supabase.co";

/* 2. schema + permissions */
for (let i = 0; ; i++) {
  try { await sql(ref, readFileSync(new URL("schema.sql", here), "utf8")); break; }
  catch (e) { if (i > 10) throw e; await sleep(6000); }
}
log("Schema and row level security applied");

/* 3. auth: email+password only, no public sign-ups */
await mgmt("/v1/projects/" + ref + "/config/auth", { method: "PATCH", body: {
  disable_signup: true, external_email_enabled: true, mailer_autoconfirm: true, password_min_length: 6, site_url: SITE
} });
log("Auth: sign-ups disabled");

/* 4. keys */
const keys = await mgmt("/v1/projects/" + ref + "/api-keys?reveal=true");
const pick = (...ts) => { for (const t of ts) { const k = keys.find(t); if (k) return k.api_key; } return null; };
const publicKey = pick(k => k.type === "publishable", k => k.name === "anon");
const secretKey = pick(k => k.type === "secret", k => k.name === "service_role");
if (!publicKey || !secretKey) throw new Error("Could not read API keys: " + JSON.stringify(keys.map(k => k.name + "/" + k.type)));

/* 5. users + profiles */
async function admin(path, method = "GET", body) {
  const res = await fetch(URL_ + "/auth/v1/admin" + path, {
    method, headers: { apikey: secretKey, Authorization: "Bearer " + secretKey, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  if (!res.ok) throw new Error("auth admin " + method + " " + path + " → " + res.status + " " + text);
  return text ? JSON.parse(text) : null;
}
const existing = (await admin("/users?per_page=1000")).users || [];
const resetAll = flag("--reset-pins"), resetOne = opt("--reset-pin");
const usedPins = new Set(), pins = {};
const newPin = () => { let p; do p = String(randomInt(0, 1e6)).padStart(6, "0"); while (usedPins.has(p) || /^(\d)\1+$/.test(p)); usedPins.add(p); return p; };
for (const name of STAFF) {
  const email = name.toLowerCase() + "@" + DOMAIN;
  let user = existing.find(u => u.email === email);
  if (!user) {
    pins[name] = newPin();
    user = await admin("/users", "POST", { email, password: pins[name], email_confirm: true, user_metadata: { name } });
    log("Created", email);
  } else if (resetAll || resetOne === name) {
    pins[name] = newPin();
    await admin("/users/" + user.id, "PUT", { password: pins[name] });
    log("New PIN for", name);
  } else pins[name] = null;
  await sql(ref, "insert into public.profiles (user_id, name) values (" + lit(user.id) + ", " + lit(name) + ") on conflict (user_id) do update set name = excluded.name;");
}

/* 6. import the old Apps Script data (only into empty tables) */
const seed = JSON.parse(readFileSync(new URL("seed.json", here), "utf8"));
const [{ n }] = await sql(ref, "select (select count(*) from public.rota) + (select count(*) from public.logs) + (select count(*) from public.shift_notes) as n;");
if (Number(n) === 0) {
  const rota = Object.entries(seed.rota).filter(([, who]) => STAFF.includes(who));
  const catMap = { setting: "setting", admin: "admin", website: "website", board: "board", other: "other" };
  await sql(ref, [
    "insert into public.rota (date, person, created_by) values " + rota.map(([d, who]) => "(" + lit(d) + ", " + lit(who) + ", null)").join(", ") + ";",
    "insert into public.shift_notes (person, date, hours_override, note) values " + seed.shifts.map(s => "('Ross', " + lit(s.date) + ", " + lit(s.hours ?? null) + ", " + lit(s.note || "") + ")").join(", ") + ";",
    "insert into public.logs (person, date, category, hours, note) values " + seed.logs.map(l => "('Ross', " + lit(l.date) + ", " + lit(catMap[l.cat] || "other") + ", " + lit(l.hours ?? null) + ", " + lit(l.note || "") + ")").join(", ") + ";"
  ].join("\n"));
  log("Imported", rota.length, "rota days,", seed.shifts.length, "shift notes,", seed.logs.length, "logs (Reset/Closed/TBC skipped)");
} else log("Tables already have data – import skipped");

/* 7. frontend config + PINs */
writeFileSync(new URL("../config.js", here),
  "// Written by setup/provision.mjs. The key is the public (publishable/anon) key: safe to publish,\n" +
  "// because Row Level Security in the database decides what each signed-in person can do.\n" +
  "export const SUPABASE_URL = " + JSON.stringify(URL_) + ";\n" +
  "export const SUPABASE_KEY = " + JSON.stringify(publicKey) + ";\n" +
  "export const EMAIL_DOMAIN = " + JSON.stringify(DOMAIN) + ";\n");
const pinFile = new URL("PINS.local.txt", here);
const old = existsSync(pinFile) ? Object.fromEntries(readFileSync(pinFile, "utf8").split("\n").map(l => l.split(": ")).filter(x => x.length === 2)) : {};
const final = Object.fromEntries(STAFF.map(s => [s, pins[s] || old[s] || "(unchanged – not known)"]));
writeFileSync(pinFile, STAFF.map(s => s + ": " + final[s]).join("\n") + "\n");
console.log("\nDone. Project " + ref + " · " + URL_ + "\nPINs (also saved in setup/PINS.local.txt):");
STAFF.forEach(s => console.log("  " + s.padEnd(8) + final[s]));
