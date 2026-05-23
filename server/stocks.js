/**
 * stocks.js — Yahoo Finance price fetcher + Trump mention tracker
 *
 * Maps company names → tickers, fetches current + historical prices,
 * stores "first mention price" when Trump mentions a company for the first time.
 */

const axios = require("axios");
const yahooFinanceModule = require("yahoo-finance2");
const yahooFinance = new yahooFinanceModule.default({ suppressNotices: ["ripHistorical"] });
const { saveMentionPrice, loadMentionPrices } = require("./db");

const FINNHUB_KEY = process.env.FINNHUB_API_KEY;

// ─── Company → Ticker map ─────────────────────────────────────────────────────
const TICKER_MAP = {
  "Apple": "AAPL",
  "Tesla": "TSLA",
  "Ford": "F",
  "GM": "GM",
  "General Motors": "GM",
  "Boeing": "BA",
  "Amazon": "AMZN",
  "Nvidia": "NVDA",
  "Walmart": "WMT",
  "Target": "TGT",
  "Coca-Cola": "KO",
  "Google": "GOOGL",
  "Alphabet": "GOOGL",
  "Microsoft": "MSFT",
  "Meta": "META",
  "Facebook": "META",
  "JPMorgan": "JPM",
  "Goldman Sachs": "GS",
  "Morgan Stanley": "MS",
  "ExxonMobil": "XOM",
  "Chevron": "CVX",
  "AT&T": "T",
  "Verizon": "VZ",
  "Disney": "DIS",
  "Netflix": "NFLX",
  "Uber": "UBER",
  "Palantir": "PLTR",
  "Pfizer": "PFE",
  "Moderna": "MRNA",
  "Johnson & Johnson": "JNJ",
  "United Airlines": "UAL",
  "Delta": "DAL",
  "American Airlines": "AAL",
  "Lockheed Martin": "LMT",
  "Raytheon": "RTX",
  "Northrop Grumman": "NOC",
  "US Steel": "X",
  "Nucor": "NUE",
  "Caterpillar": "CAT",
  "Deere": "DE",
  "John Deere": "DE",
  "Harley-Davidson": "HOG",
  "Carrier": "CARR",
  "Whirlpool": "WHR",
  "Tyson Foods": "TSN",
  "Archer Daniels Midland": "ADM",
  "ADM": "ADM",
  "Halliburton": "HAL",
  "Baker Hughes": "BKR",
  "ConocoPhillips": "COP",
  "Marathon Oil": "MRO",
  "Bank of America": "BAC",
  "Wells Fargo": "WFC",
  "Citigroup": "C",
  "BlackRock": "BLK",
};

// In-memory store: company → { firstMentionPrice, firstMentionDate, firstMentionSpeech, ticker }
const mentionPriceStore = {};

// Simple price cache so we don't hammer Yahoo Finance
const priceCache = {}; // ticker → { price, fetchedAt }
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch current stock price from Yahoo Finance v8 chart endpoint.
 * Returns null if unavailable.
 */
async function fetchCurrentPrice(ticker) {
  const cached = priceCache[ticker];
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.price;
  }

  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB_KEY}`;
    const { data } = await axios.get(url, { timeout: 8000 });
    const price = data?.c || data?.pc;
    if (!price) return null;
    priceCache[ticker] = { price: Number(price.toFixed(2)), fetchedAt: Date.now() };
    return priceCache[ticker].price;
  } catch (e) {
    return null;
  }
}

/**
 * Fetch historical closing price on a specific date (YYYY-MM-DD) via Yahoo Finance.
 * Falls back to nearest available trading day within a week.
 */
async function fetchPriceOnDate(ticker, dateStr) {
  try {
    const date = new Date(dateStr + "T12:00:00Z");
    const from = new Date(date.getTime() - 86400 * 4 * 1000); // 4 days before
    const to   = new Date(date.getTime() + 86400 * 4 * 1000); // 4 days after

    const result = await yahooFinance.historical(ticker, {
      period1: from.toISOString().split("T")[0],
      period2: to.toISOString().split("T")[0],
      interval: "1d",
    });

    if (!result || result.length === 0) return null;

    // Find the closest date to the target
    const target = date.getTime();
    const closest = result.reduce((best, row) => {
      const diff = Math.abs(new Date(row.date).getTime() - target);
      const bestDiff = Math.abs(new Date(best.date).getTime() - target);
      return diff < bestDiff ? row : best;
    });

    console.log(`  [Yahoo historical] ${ticker} ${dateStr}: $${closest.close}`);
    return Number(closest.close.toFixed(2));
  } catch (e) {
    console.error(`  [Yahoo historical error] ${ticker} ${dateStr}: ${e.message}`);
    return null;
  }
}

/**
 * Called when a company is mentioned in a speech.
 * Records first-mention price if this is the first time we've seen this company.
 */
async function recordMention(company, date, speechTitle) {
  const ticker = TICKER_MAP[company];
  if (!ticker) return; // No ticker for this company (e.g. SpaceX, OpenAI)

  if (!mentionPriceStore[company]) {
    const isHistorical = date && new Date(date) < new Date(Date.now() - 86400 * 1000);
    const price = isHistorical
      ? (await fetchPriceOnDate(ticker, date)) || (await fetchCurrentPrice(ticker))
      : await fetchCurrentPrice(ticker);
    mentionPriceStore[company] = {
      ticker,
      company,
      firstMentionDate: date,
      firstMentionSpeech: speechTitle,
      firstMentionPrice: price,
    };
    console.log(`  💰 First mention: ${company} (${ticker}) on ${date} @ $${price}`);
    await saveMentionPrice(mentionPriceStore[company]);
  }
}

/**
 * Build the daily digest — all mentioned companies with price comparison.
 */
async function buildDailyDigest() {
  const entries = [];

  for (const [company, record] of Object.entries(mentionPriceStore)) {
    // Retry first-mention price if it never loaded (e.g. market was closed at mention time)
    if (!record.firstMentionPrice) {
      const retried = await fetchCurrentPrice(record.ticker);
      if (retried) record.firstMentionPrice = retried;
    }

    const currentPrice = await fetchCurrentPrice(record.ticker);

    let pctChange = null;
    if (record.firstMentionPrice && currentPrice) {
      pctChange = ((currentPrice - record.firstMentionPrice) / record.firstMentionPrice) * 100;
    }

    entries.push({
      company,
      ticker: record.ticker,
      firstMentionDate: record.firstMentionDate,
      firstMentionSpeech: record.firstMentionSpeech,
      firstMentionPrice: record.firstMentionPrice,
      currentPrice,
      pctChange: pctChange !== null ? Number(pctChange.toFixed(2)) : null,
      direction: pctChange === null ? null : pctChange >= 0 ? "up" : "down",
    });
  }

  // Sort by absolute % change descending (biggest movers first)
  return entries.sort((a, b) => {
    const absA = a.pctChange !== null ? Math.abs(a.pctChange) : -1;
    const absB = b.pctChange !== null ? Math.abs(b.pctChange) : -1;
    return absB - absA;
  });
}

function getTicker(company) {
  return TICKER_MAP[company] || null;
}

async function restoreMentionPrices() {
  const saved = await loadMentionPrices();
  for (const record of saved) {
    if (!mentionPriceStore[record.company]) {
      mentionPriceStore[record.company] = record;
    }
  }
  if (saved.length > 0) console.log(`[DB] Restored ${saved.length} mention prices.`);
}

module.exports = { recordMention, buildDailyDigest, fetchCurrentPrice, fetchPriceOnDate, getTicker, mentionPriceStore, restoreMentionPrices };
