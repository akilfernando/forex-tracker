// Fetches NDB USD Telegraphic Transfer rate + market USD-LKR mid, appends to rates.json.
// Runs server-side (GitHub Action) so no browser CORS limit. One entry per day.
import * as cheerio from "cheerio";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const NDB_URL = "https://www.ndbbank.com/rates/exchange-rates";
const MARKET_URL = "https://open.er-api.com/v6/latest/USD"; // free, no key, direction proxy
const OUT = "rates.json";

const num = (s) => Number(String(s).replace(/[^0-9.]/g, ""));

async function getNdb() {
  const res = await fetch(NDB_URL, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error("NDB fetch " + res.status);
  const html = await res.text();
  const $ = cheerio.load(html);

  let row = null;
  $("table tr").each((_, tr) => {
    const cells = $(tr)
      .find("td")
      .map((__, td) => $(td).text().trim())
      .get();
    if (cells.some((c) => c.toUpperCase() === "USD")) row = cells;
  });
  if (!row) throw new Error("USD row not found");

  // Columns: Currency, Code, CurrBuy, CurrSell, DDBuy, DDSell, TTBuy, TTSell
  const ttBuy = num(row[6]);
  const ttSell = num(row[7]);
  if (!(ttBuy > 100 && ttBuy < 1000)) throw new Error("bad ttBuy " + ttBuy);
  if (!(ttSell > 100 && ttSell < 1000)) throw new Error("bad ttSell " + ttSell);

  let eff = null;
  const m = html.match(/Last Updated On:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
  if (m) eff = m[1];

  return { ttBuy, ttSell, eff };
}

async function getMarket() {
  try {
    const res = await fetch(MARKET_URL);
    const j = await res.json();
    const lkr = j?.rates?.LKR;
    return lkr && lkr > 0 ? Number(lkr.toFixed(4)) : null;
  } catch {
    return null;
  }
}

const today = new Date().toISOString().slice(0, 10);
const ndb = await getNdb();
const market = await getMarket();

let data = { updated_at: "", history: [] };
if (existsSync(OUT)) {
  try {
    data = JSON.parse(readFileSync(OUT, "utf8"));
  } catch {}
}
if (!Array.isArray(data.history)) data.history = [];

const entry = {
  date: today,
  ndb_effective: ndb.eff,
  ndb_buy: ndb.ttBuy,
  ndb_sell: ndb.ttSell,
  market_mid: market,
};

const i = data.history.findIndex((h) => h.date === today);
if (i >= 0) data.history[i] = entry;
else data.history.push(entry);

data.history.sort((a, b) => (a.date < b.date ? -1 : 1));
data.updated_at = new Date().toISOString();

writeFileSync(OUT, JSON.stringify(data, null, 2));
console.log("wrote", entry);
