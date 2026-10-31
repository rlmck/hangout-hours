/**
 * CSV export. exportAll() downloads one CSV per table (People, Rota, Logs, Shifts, Expenses),
 * with the same columns as Google Sheets tabs: in a Google Sheet use File > Import > Upload,
 * "Insert new sheet", once per file.
 */
import { exportTables } from "./api.js";

function cell(v) {
  if (v == null) return "";
  let s = String(v);
  if (/^[=+@]/.test(s)) s = "'" + s;                      // stop spreadsheets treating notes as formulas
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export const toCsv = rows => rows.map(r => r.map(cell).join(",")).join("\r\n") + "\r\n";

export function download(filename, rows) {
  const blob = new Blob(["﻿" + toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export async function exportAll() {
  const tables = await exportTables();
  for (const name of Object.keys(tables)) {
    download("Hangout - " + name + ".csv", tables[name]);
    await new Promise(r => setTimeout(r, 400));             // browsers drop rapid back-to-back downloads
  }
}
