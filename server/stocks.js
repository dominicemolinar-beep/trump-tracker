/**
 * stocks.js — Yahoo Finance price fetcher + Trump mention tracker
 *
 * Maps company names → tickers, fetches current + historical prices,
 * stores "first mention price" when Trump mentions a company for the first time.
 */

const axios = require("axios");

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
  // Check cache
  const cached = priceCache[ticker];
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.price;
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`;
    const res = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json",
      },
      timeout: 8000,
    });

    const result = res.data?.chart?.result?.[0];
    if (!result) return null;

    // Use regular market price or last close
    const meta = result.meta;
    const price =
      meta.regularMarketPrice ||
      meta.previousClose ||
      result.indicators?.quote?.[0]?.close?.slice(-1)[0];

    if (!price) return null;

    priceCache[ticker] = { price: Number(price.toFixed(2)), fetchedAt: Date.now() };
    return priceCache[ticker].price;
  } catch (e) {
    return null;
  }
}

/**
 * Fetch historical price on a specific date (YYYY-MM-DD).
 * Falls back to nearest available trading day.
 */
async function fetchPriceOnDate(ticker, dateStr) {
  try {
    const date = new Date(dateStr);
    const from = Math.floor(date.getTime() / 1000) - 86400; // day before
    const to = Math.floor(date.getTime() / 1000) + 86400 * 3; // 3 days after (weekend buffer)

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&period1=${from}&period2=${to}`;
    const res = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
      timeout: 8000,
    });

    const result = res.data?.chart?.result?.[0];
    if (!result) return null;

    const closes = result.indicators?.quote?.[0]?.close;
    if (!closes || closes.length === 0) return null;

    // Find first non-null close
    const price = closes.find(p => p !== null && p !== undefined);
    return price ? Number(price.toFixed(2)) : null;
  } catch (e) {
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
    // First time — fetch historical price for that date
    const price = await fetchPriceOnDate(ticker, date);
    mentionPriceStore[company] = {
      ticker,
      company,
      firstMentionDate: date,
      firstMentionSpeech: speechTitle,
      firstMentionPrice: price,
    };
    console.log(`  💰 First mention: ${company} (${ticker}) on ${date} @ $${price}`);
  }
}

/**
 * Build the daily digest — all mentioned companies with price comparison.
 */
async function buildDailyDigest() {
  const entries = [];

  for (const [company, record] of Object.entries(mentionPriceStore)) {
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

module.exports = { recordMention, buildDailyDigest, fetchCurrentPrice, fetchPriceOnDate, getTicker, mentionPriceStore };
