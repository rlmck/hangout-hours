/**
 * Hangout hours – ALL data access lives here.
 * The UI only uses the functions exported below and the plain objects they return,
 * so swapping Supabase for something else (e.g. Google Sheets) means rewriting this file only.
 *
 * Shapes returned by loadAll():
 *   rota:     {date, person}
 *   closures: {date, reason}                      (extra closed days on top of the weekly pattern)
 *   shifts:   {person, date, hours, note}          (hours = override or null)
 *   logs:     {id, person, date, cat, hours, note}
 *   expenses: {id, person, date, amount, description, status, reimbursedAt, method}
 * Dates are "YYYY-MM-DD" strings. Errors with message "AUTH" mean "not signed in".
 */
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY, EMAIL_DOMAIN } from "./config.js";

export const configured = !!(SUPABASE_URL && SUPABASE_KEY);
const db = configured ? createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "hangout-auth" }
}) : null;

const authErr = e => e && (e.status === 401 || /JWT|not authenticated|permission denied/i.test(e.message || "") || e.code === "PGRST301");
function check({ data, error }) {
  if (error) throw authErr(error) ? new Error("AUTH") : new Error(error.message || "Request failed");
  return data;
}
const num = v => v == null ? null : Number(v);

/* ---------- auth ---------- */
export async function signIn(name, pin) {
  const { error } = await db.auth.signInWithPassword({ email: name.toLowerCase() + "@" + EMAIL_DOMAIN, password: String(pin) });
  if (error) throw new Error(/invalid/i.test(error.message) ? "AUTH" : error.message);
  return whoAmI();
}

/** Name of the signed-in person on this device, or null if nobody is signed in. Throws if offline. */
export async function whoAmI() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) return null;
  const row = check(await db.from("profiles").select("name").eq("user_id", session.user.id).maybeSingle());
  return row ? row.name : null;
}

/* ---------- read ---------- */
async function all(table, cols, order) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const rows = check(await db.from(table).select(cols).order(order).range(from, from + 999));
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

export async function loadAll() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) throw new Error("AUTH");
  const [rota, notes, logs, exp, closures] = await Promise.all([
    all("rota", "date,person", "date"),
    all("shift_notes", "person,date,hours_override,note", "date"),
    all("logs", "id,person,date,category,hours,note", "date"),
    all("expenses", "id,person,date,amount_gbp,description,status,reimbursed_at,reimbursed_method", "date"),
    all("closures", "date,reason", "date").catch(e => { if (e.message === "AUTH") throw e; console.warn("closures:", e); return []; })  // table may not exist yet
  ]);
  return {
    rota: rota.map(r => ({ date: r.date, person: r.person })),
    closures: closures.map(c => ({ date: c.date, reason: c.reason || "" })),
    shifts: notes.map(s => ({ person: s.person, date: s.date, hours: num(s.hours_override), note: s.note || "" })),
    logs: logs.map(l => ({ id: l.id, person: l.person, date: l.date, cat: l.category, hours: num(l.hours), note: l.note || "" })),
    expenses: exp.map(e => ({ id: e.id, person: e.person, date: e.date, amount: Number(e.amount_gbp), description: e.description,
      status: e.status, reimbursedAt: e.reimbursed_at, method: e.reimbursed_method }))
  };
}

/* ---------- rota (anyone can add/remove anyone) ---------- */
export async function addRota(date, person) {
  check(await db.from("rota").upsert({ date, person }, { onConflict: "date,person", ignoreDuplicates: true }));
}
export async function removeRota(date, person) {
  check(await db.from("rota").delete().eq("date", date).eq("person", person));
}

/* ---------- closed days (anyone can close/reopen) ---------- */
export async function closeDay(date, reason) {
  // ignoreDuplicates: if someone else already closed it, keep theirs (no UPDATE permission on this table)
  check(await db.from("closures").upsert({ date, reason: reason || "" }, { onConflict: "date", ignoreDuplicates: true }));
}
export async function reopenDay(date) {
  check(await db.from("closures").delete().eq("date", date));
}

/* ---------- own shift notes / hours override ---------- */
export async function saveShift({ person, date, hours, note }) {
  if (hours == null && !note) return deleteShift(person, date);
  check(await db.from("shift_notes").upsert({ person, date, hours_override: hours, note: note || "" }, { onConflict: "person,date" }));
}
export async function deleteShift(person, date) {
  check(await db.from("shift_notes").delete().eq("person", person).eq("date", date));
}

/* ---------- own logs ---------- */
export async function saveLog({ id, person, date, cat, hours, note }) {
  check(await db.from("logs").upsert({ id, person, date, category: cat, hours, note: note || "" }));
}
export async function deleteLog(id) {
  check(await db.from("logs").delete().eq("id", id));
}

/* ---------- own costs ---------- */
export async function saveExpense({ id, person, date, amount, description }) {
  check(await db.from("expenses").upsert({ id, person, date, amount_gbp: amount, description }));
}
export async function deleteExpense(id) {
  check(await db.from("expenses").delete().eq("id", id));
}
/** method: 'cash_drawer' | 'bank' | 'other' to mark reimbursed, or null to undo. */
export async function setReimbursed(id, method) {
  check(await db.from("expenses").update(method
    ? { status: "reimbursed", reimbursed_at: new Date().toISOString(), reimbursed_method: method }
    : { status: "unpaid", reimbursed_at: null, reimbursed_method: null }).eq("id", id));
}

/* ---------- export: every table as rows shaped like Google Sheets tabs ---------- */
export async function exportTables() {
  const [people, rota, notes, logs, exp, closures] = await Promise.all([
    all("profiles", "user_id,name", "name"),
    all("rota", "date,person,created_by,created_at", "date"),
    all("shift_notes", "person,date,hours_override,note", "date"),
    all("logs", "id,person,date,category,hours,note,created_at", "date"),
    all("expenses", "id,person,date,amount_gbp,description,status,reimbursed_at,reimbursed_method,created_at", "date"),
    all("closures", "date,reason,created_by,created_at", "date").catch(() => [])
  ]);
  const nameOf = Object.fromEntries(people.map(p => [p.user_id, p.name]));
  return {
    People: [["Name", "Email"], ...people.map(p => [p.name, p.name.toLowerCase() + "@" + EMAIL_DOMAIN])],
    Rota: [["Date", "Who", "Added by", "Added at"], ...rota.map(r => [r.date, r.person, nameOf[r.created_by] || "", r.created_at])],
    Closed: [["Date", "Reason", "Closed by", "Closed at"], ...closures.map(c => [c.date, c.reason, nameOf[c.created_by] || "", c.created_at])],
    Logs: [["ID", "Person", "Date", "Type", "Hours", "Note", "Logged at"], ...logs.map(l => [l.id, l.person, l.date, l.category, l.hours, l.note, l.created_at])],
    Shifts: [["Person", "Date", "Hours override", "Note"], ...notes.map(s => [s.person, s.date, s.hours_override, s.note])],
    Expenses: [["ID", "Person", "Date", "Amount (GBP)", "Description", "Status", "Reimbursed at", "Reimbursed method", "Logged at"],
      ...exp.map(e => [e.id, e.person, e.date, e.amount_gbp, e.description, e.status, e.reimbursed_at, e.reimbursed_method, e.created_at])]
  };
}
