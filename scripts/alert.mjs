// Emails you when NDB's USD buy rate crosses UP through your floor.
// Runs in the same GitHub Action, after rates.json is refreshed.
// Floor comes from the ALERT_FLOOR repo variable (default 332) — this is
// independent of the dashboard's per-device localStorage floor.
// Email needs the SMTP_* secrets; if they're absent it logs and exits 0
// (so runs stay green until you configure them).
import { readFileSync } from "node:fs";
import nodemailer from "nodemailer";

const FLOOR = Number(process.env.ALERT_FLOOR) || 332;
const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
const ALERT_TO = process.env.ALERT_TO || SMTP_USER;

let data;
try {
  data = JSON.parse(readFileSync("rates.json", "utf8"));
} catch {
  console.log("no rates.json; nothing to alert");
  process.exit(0);
}

const hist = (data.history || [])
  .slice()
  .sort((a, b) => (a.date < b.date ? -1 : 1));
if (!hist.length) {
  console.log("empty history; nothing to alert");
  process.exit(0);
}

const latest = hist[hist.length - 1];
const prev = hist.length > 1 ? hist[hist.length - 2] : null;

// Fire only on an upward crossing (or the very first entry already at/above
// floor) so a rate that lingers above the floor doesn't email every day.
const crossedUp = latest.ndb_buy >= FLOOR && (!prev || prev.ndb_buy < FLOOR);
if (!crossedUp) {
  console.log(
    `no alert: buy ${latest.ndb_buy} vs floor ${FLOOR}` +
      (prev ? `, prev ${prev.ndb_buy}` : ", no prior day")
  );
  process.exit(0);
}

if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
  console.log("buy crossed floor but SMTP_* secrets missing — skipping email");
  process.exit(0);
}

const port = Number(SMTP_PORT) || 465;
const transport = nodemailer.createTransport({
  host: SMTP_HOST,
  port,
  secure: port === 465, // 465 = implicit TLS; 587 = STARTTLS
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});

const subject = `NDB USD buy hit ${latest.ndb_buy} (floor ${FLOOR})`;
const text = [
  `NDB is buying USD at ${latest.ndb_buy} LKR (TT).`,
  `Your floor: ${FLOOR}.`,
  `NDB sell: ${latest.ndb_sell}. Market mid: ${latest.market_mid ?? "n/a"}.`,
  `Effective ${latest.ndb_effective || "?"}, captured ${latest.date}.`,
  ``,
  `Dashboard: https://akilfernando.github.io/forex-tracker/`,
].join("\n");

await transport.sendMail({ from: SMTP_USER, to: ALERT_TO, subject, text });
console.log("alert email sent to", ALERT_TO);
