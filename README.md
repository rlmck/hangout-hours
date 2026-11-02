# Hangout hours

A small installable web app for the Hangout staff (Ross, Baz, Patrick) to plan the rota, log hours and track out-of-pocket costs.

- **Live app:** https://rlmck.github.io/hangout-hours/
- **Frontend:** plain HTML/CSS/JS on GitHub Pages (this repo). No build step.
- **Backend:** Supabase free tier (Postgres + Auth), project `hangout-hours`. No Storage, no Edge Functions.
- Staff data only. No customer data. Nothing here touches SimplyBook or any other Hangout system.

## Files

| File | What it is |
| --- | --- |
| `index.html` | Layout and styles |
| `app.js` | Screens and logic. `shiftPattern()` / `PATTERNS` hold the shift hours |
| `api.js` | **All** data access. Swap this one file to move to another backend (e.g. Google Sheets) |
| `export.js` | CSV downloads, and "Export all data" (one CSV per table, shaped like Google Sheets tabs) |
| `config.js` | Supabase URL + public key (written by `setup/provision.mjs`) |
| `sw.js`, `manifest.json`, `icons/` | Makes it installable and lets it open offline |
| `setup/schema.sql` | Tables, permissions (Row Level Security). Safe to re-run |
| `setup/provision.mjs` | Creates/updates the Supabase project, users, PINs and imports the old data |
| `setup/check.mjs` | Tests the live permissions with the real PINs |
| `setup/seed.json` | The data imported from the old Apps Script version |

## How sign-in works

Each person picks their name and types a 6-digit PIN, once per phone. Under the hood that's a Supabase
email/password user: `ross@hangout.local`, `baz@hangout.local`, `patrick@hangout.local`, password = PIN.
The session stays on the phone. There is no switch-user button. Signing in on a new phone brings everything back,
because all data lives in the database.

Public sign-ups are switched off, so nobody else can create an account.

## Who can do what (enforced in the database, not just the app)

- Everyone signed in can **see** everything: hours, shifts, costs, rota.
- Each person can only add/edit/delete **their own** logs, shift notes and costs.
- **Rota:** anyone can put anyone on or off any day, and anyone can close or reopen a day.
- **Costs:** only the person who logged a cost can mark it reimbursed or undo that. Costs can only be deleted while unpaid.

Run `node setup/check.mjs` to test this against the live database (it uses dates in 2099 and tidies up after itself).

## Change a PIN

Option A, Supabase dashboard → **SQL Editor** → run (pick your own 6 digits):

```sql
update auth.users set encrypted_password = extensions.crypt('123456', extensions.gen_salt('bf'))
where email = 'baz@hangout.local';
-- optional: sign Baz out of every phone too
delete from auth.sessions where user_id = (select id from auth.users where email = 'baz@hangout.local');
```

Option B, from this folder, with a Supabase access token (https://supabase.com/dashboard/account/tokens, revoke it afterwards):

```
node setup/provision.mjs sbp_yourtoken --reset-pin Baz
```

This prints a new random PIN and saves it in `setup/PINS.local.txt` (never committed).

## Add a person (e.g. "Sam")

1. Supabase → **Authentication → Users → Add user → Create new user**: email `sam@hangout.local`, password = their PIN, tick "Auto confirm".
2. Supabase → **SQL Editor**, allow the new name everywhere and give them a profile:

```sql
alter table profiles    drop constraint profiles_name_check,       add constraint profiles_name_check       check (name   in ('Ross','Baz','Patrick','Sam'));
alter table rota        drop constraint rota_person_check,         add constraint rota_person_check         check (person in ('Ross','Baz','Patrick','Sam'));
alter table shift_notes drop constraint shift_notes_person_check,  add constraint shift_notes_person_check  check (person in ('Ross','Baz','Patrick','Sam'));
alter table logs        drop constraint logs_person_check,         add constraint logs_person_check         check (person in ('Ross','Baz','Patrick','Sam'));
alter table expenses    drop constraint expenses_person_check,     add constraint expenses_person_check     check (person in ('Ross','Baz','Patrick','Sam'));
insert into profiles (user_id, name) select id, 'Sam' from auth.users where email = 'sam@hangout.local';
```

3. In `app.js`, add them to `PEOPLE` (short name, initial, colours), e.g.
   `Sam:{short:"Sam",ini:"S",c:"var(--sam)",bg:"var(--sam-bg)"}`, and add `--sam` / `--sam-bg` colours to the three colour blocks in `index.html`.
4. Also add the name to the `check (... in (...))` lists in `setup/schema.sql` and `STAFF` in `setup/provision.mjs` so a rebuild matches.
5. Redeploy (below).

To remove someone, take them out of `PEOPLE` in `app.js` (their history stays in the database) and delete their user in Supabase → Authentication if they should no longer sign in.

## Change the shift pattern

A shift runs from 30 minutes before opening to 30 minutes after closing. The pattern is in `app.js`:

```js
const PATTERNS = [
  {from:"2000-01-01", days:[...]},   // old hours (keeps historic totals unchanged)
  {from:"2026-11-02", days:[...]},   // Mon–Thu 15:30–22:00, Fri closed, Sat/Sun 09:30–15:00
];
```

`days` is `[Sun, Mon, Tue, Wed, Thu, Fri, Sat]`; each day is `["start","end"]` for the shift, or `null` for closed.
To change the hours from a date, **add one line** at the bottom with that date, e.g. opening on Fridays again from 1 March 2027:

```js
  {from:"2027-03-01", days:[["09:30","15:00"],["15:30","22:00"],["15:30","22:00"],["15:30","22:00"],["15:30","22:00"],["15:30","22:00"],["09:30","15:00"]]},
```

Older dates keep their old hours, so past totals never change. Each person on a rota day gets the full shift
hours unless they've set their own hours on that shift (tap the day → "Change my hours or add a note").
Closed days are greyed out in the rota and nobody can be put on them. Then redeploy.

## Close a single day (bank holiday, private event, repairs)

No code change needed: in the app, open **Rota** → tap the day → **Close the wall this day**, optionally add a reason,
then **Close this day**. Anyone on the rota that day is taken off, and the day shows as closed for everyone.
Tap it again → **Reopen this day** to undo. Only today and future days can be closed or reopened.
These are stored in the `closures` table, separate from the weekly pattern above.

## Export to CSV / move to Google Sheets

- **Hours** and **Costs** screens: "Download CSV" saves what the Me / Baz / Patrick / Everyone filter shows.
- **Hours** screen: "Export all data" saves six files: `Hangout - People.csv`, `Rota`, `Logs`, `Shifts`, `Expenses`
  and `Closed` (one per table, same columns as Google Sheets tabs). Best done on a computer.
- To move to a Google Sheet: make a sheet called "Hangout", then **File → Import → Upload** each CSV with
  "Insert new sheet(s)". To make the app use it, rewrite `api.js` only (same function names and return shapes); the UI doesn't change.
- Supabase also has a table editor with "Export to CSV" for each table, and the schema is flat and plain.

## Redeploy

Any change pushed to the `main` branch goes live on GitHub Pages in a minute or two:

```
git add -A
git commit -m "Describe the change"
git push
```

If you changed `app.js`, `index.html` or other files, phones pick up the new version next time the app is opened
online (the service worker fetches fresh files first). If something seems stuck, bump `CACHE` in `sw.js`
(e.g. `hangout-hours-v2`) and push again.

## Rebuild from scratch / reverse it

- **Rebuild:** `node setup/provision.mjs sbp_yourtoken` creates the project (London region) if missing, applies
  `schema.sql`, switches off sign-ups, creates the three users with random PINs, imports `seed.json` into empty
  tables and writes `config.js`. Then commit and push. Re-running it never deletes data.
- **Reverse:** everything is free tier. Export the CSVs first, then delete the Supabase project (Settings → General)
  and the GitHub repo. The old Apps Script version is untouched.

## Running costs and limits

Supabase free tier pauses a project after about a week with no activity; opening the app regularly keeps it awake.
If it's paused, restore it from the Supabase dashboard (data is kept). GitHub Pages is free for public repos.
The repo is public: it contains no PINs or secrets (the key in `config.js` is the public one; the database's
permissions protect the data).
