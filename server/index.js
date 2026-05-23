/**
 * Trump Speech Signal Tracker — Backend Server
 *
 * What this does:
 *  - Polls Rev.com and Senate Dems/Factbase every 5 minutes for new Trump transcripts
 *  - Scans each new transcript for market-moving language (buy signals, company mentions)
 *  - Uses Claude AI for deep analysis of each appearance
 *  - Exposes a REST API consumed by the React frontend
 *  - Stores all data in memory (swap for SQLite/Postgres for persistence)
 */

const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cron = require("node-cron");
const cors = require("cors");
const Anthropic = require("@anthropic-ai/sdk");
const { recordMention, buildDailyDigest, getTicker, mentionPriceStore, restoreMentionPrices } = require("./stocks");
const { initDb, saveSignalPost, loadSignalPosts } = require("./db");

const app = express();
app.use(cors());
app.use(express.json());

// ─── Config ────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const POLL_INTERVAL_MINUTES = 5;

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// ─── In-memory store ────────────────────────────────────────────────────────
const store = {
  appearances: [],        // All tracked appearances
  signals: [],            // All detected market signals
  truthPosts: [],         // Truth Social posts
  backfill: null,
  lastPoll: null,
  pollCount: 0,
  errors: [],
  seenUrls: new Set(),    // Dedup: don't re-scan the same transcript
  seenTruthIds: new Set(),
};

// ─── Signal detection patterns ──────────────────────────────────────────────
const SIGNAL_PATTERNS = [
  { type: "STRONG_BUY",  weight: 10, patterns: ["you have to buy", "you should buy", "buy the stock", "get in on", "you should own", "you've got to get"] },
  { type: "BUY",         weight:  7, patterns: ["buy ", "great investment", "buy american", "invest in"] },
  { type: "POSITIVE",    weight:  5, patterns: ["incredible company", "great company", "great american company", "doing an incredible job", "doing a great job", "very strong", "unbelievable company", "fantastic company", "beautiful company"] },
  { type: "POSITIVE",    weight:  3, patterns: ["incredible", "fantastic", "unbelievable", "tremendous", "the best"] },
  { type: "NEGATIVE",    weight: -6, patterns: ["not a buy", "disaster", "not being fair", "moved jobs", "not so great", "i would not buy", "terrible", "horrible", "do not buy"] },
  { type: "AVOID",       weight: -9, patterns: ["disgrace", "failing", "going out of business", "bankrupt", "crooked"] },
];

const KNOWN_COMPANIES = [
  "Apple", "Tesla", "Ford", "GM", "General Motors", "Boeing", "Amazon", "Nvidia",
  "Walmart", "Target", "Coca-Cola", "Google", "Alphabet", "Microsoft", "Meta",
  "Facebook", "JPMorgan", "Goldman Sachs", "Morgan Stanley", "ExxonMobil",
  "Chevron", "AT&T", "Verizon", "Disney", "Netflix", "Uber", "Palantir",
  "Pfizer", "Moderna", "Johnson & Johnson", "United Airlines", "Delta",
  "American Airlines", "Lockheed Martin", "Raytheon", "Northrop Grumman",
  "US Steel", "Nucor", "Caterpillar", "Deere", "John Deere", "Harley-Davidson",
  "Carrier", "Whirlpool", "Tyson Foods", "Archer Daniels Midland", "ADM",
  "Halliburton", "Baker Hughes", "ConocoPhillips", "Marathon Oil",
  "Bank of America", "Wells Fargo", "Citigroup", "BlackRock",
  "OpenAI", "SpaceX", "X Corp", "Twitter",
];

// ─── Signal detection engine ────────────────────────────────────────────────
function detectSignals(text) {
  const results = [];
  const lowerText = text.toLowerCase();
  const sentences = text.match(/[^.!?\n]+[.!?\n]+/g) || [text];

  KNOWN_COMPANIES.forEach((company) => {
    const lowerCompany = company.toLowerCase();
    const wordBoundary = new RegExp(`\\b${lowerCompany.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    if (!wordBoundary.test(lowerText)) return;

    let score = 0;
    const hits = [];

    sentences.forEach((sentence) => {
      const lowerSentence = sentence.toLowerCase();
      if (!lowerSentence.includes(lowerCompany)) return;

      SIGNAL_PATTERNS.forEach(({ type, patterns, weight }) => {
        patterns.forEach((pattern) => {
          if (lowerSentence.includes(pattern)) {
            score += weight;
            hits.push({ type, pattern, quote: sentence.trim() });
          }
        });
      });
    });

    if (hits.length > 0) {
      let sentiment = "NEUTRAL";
      if (score >= 10) sentiment = "STRONG_BUY";
      else if (score >= 5) sentiment = "BUY";
      else if (score > 0) sentiment = "POSITIVE";
      else if (score <= -9) sentiment = "AVOID";
      else if (score < 0) sentiment = "NEGATIVE";

      results.push({ company, score, sentiment, hits });
    }
  });

  return results.sort((a, b) => b.score - a.score);
}

// ─── Claude AI analysis ──────────────────────────────────────────────────────
async function analyzeWithClaude(title, date, text, detectedSignals) {
  if (!ANTHROPIC_API_KEY) return "Add ANTHROPIC_API_KEY to .env to enable AI summaries.";

  const companyList = detectedSignals.map(s => `${s.company} (${s.sentiment}, score ${s.score})`).join(", ");
  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      system: `You are a financial analyst specializing in political speech analysis for trading signals.
Analyze Trump speech transcripts and identify market-moving language.
Be concise, specific, and clinical. Output plain text bullet points only — no markdown headers.`,
      messages: [{
        role: "user",
        content: `Speech: "${title}" (${date})

Excerpt: "${text.slice(0, 2000)}"

Pre-detected companies: ${companyList || "none"}

Give 3-5 bullet points. Note any explicit buy/sell language, sentiment toward specific companies, and your overall market signal assessment (bullish/bearish/neutral).`
      }]
    });
    return msg.content[0].text;
  } catch (e) {
    return `AI analysis unavailable: ${e.message}`;
  }
}

// ─── Scrapers ─────────────────────────────────────────────────────────────────

// Source 1: Rev.com Trump transcript listing
async function scrapeRevCom() {
  const found = [];
  try {
    const res = await axios.get("https://www.rev.com/blog/transcript-category/donald-trump-transcripts", {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TrumpTracker/1.0)" },
      timeout: 15000,
    });
    const $ = cheerio.load(res.data);

    // Rev.com lists posts — grab title, date, and link
    $("article, .post, .transcript-item, h2 a, h3 a").each((i, el) => {
      const link = $(el).attr("href") || $(el).find("a").attr("href");
      const title = $(el).text().trim() || $(el).find("a").text().trim();
      if (link && title && link.includes("rev.com") && title.length > 10) {
        found.push({ title, url: link, source: "Rev.com" });
      }
    });

    // Also grab plain links containing 'trump'
    $("a").each((i, el) => {
      const href = $(el).attr("href") || "";
      const text = $(el).text().trim();
      if (href.includes("rev.com") && href.toLowerCase().includes("trump") && text.length > 15) {
        found.push({ title: text, url: href, source: "Rev.com" });
      }
    });
  } catch (e) {
    store.errors.push({ time: new Date().toISOString(), source: "Rev.com", error: e.message });
  }
  return found;
}

// Source 2: Senate Democrats Factbase mirror
async function scrapeSenateTranscripts() {
  const found = [];
  try {
    const res = await axios.get("https://www.democrats.senate.gov/newsroom/trump-transcripts", {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TrumpTracker/1.0)" },
      timeout: 15000,
    });
    const $ = cheerio.load(res.data);

    $("a").each((i, el) => {
      const href = $(el).attr("href") || "";
      const text = $(el).text().trim();
      if (text.length > 20 && (href.includes("transcript") || text.toLowerCase().includes("trump"))) {
        const url = href.startsWith("http") ? href : `https://www.democrats.senate.gov${href}`;
        found.push({ title: text, url, source: "Factbase/Senate" });
      }
    });
  } catch (e) {
    store.errors.push({ time: new Date().toISOString(), source: "Senate/Factbase", error: e.message });
  }
  return found;
}

// Fetch and parse full transcript text from a URL
async function fetchTranscriptText(url) {
  try {
    const res = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TrumpTracker/1.0)" },
      timeout: 20000,
    });
    const $ = cheerio.load(res.data);

    // Remove nav, footer, ads
    $("nav, footer, header, script, style, .nav, .footer, .header, .advertisement, .sidebar").remove();

    // Try common transcript content containers
    const selectors = [
      ".transcript-content", ".entry-content", ".post-content",
      "article", ".article-body", "main", ".content"
    ];
    for (const sel of selectors) {
      const text = $(sel).text().replace(/\s+/g, " ").trim();
      if (text.length > 500) return text;
    }

    return $("body").text().replace(/\s+/g, " ").trim();
  } catch (e) {
    return null;
  }
}

// Source 3: Truth Social (Mastodon-compatible public API)
let trumpTruthAccountId = null;

async function getTrumpTruthAccountId() {
  if (trumpTruthAccountId) return trumpTruthAccountId;
  try {
    const res = await axios.get("https://truthsocial.com/api/v1/accounts/lookup?acct=realDonaldTrump", {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TrumpTracker/1.0)" },
      timeout: 10000,
    });
    trumpTruthAccountId = res.data?.id;
    return trumpTruthAccountId;
  } catch (e) {
    store.errors.push({ time: new Date().toISOString(), source: "TruthSocial", error: e.message });
    return null;
  }
}

async function scrapeTruthSocial() {
  const found = [];
  try {
    const accountId = await getTrumpTruthAccountId();
    if (!accountId) return found;

    const res = await axios.get(`https://truthsocial.com/api/v1/accounts/${accountId}/statuses?limit=20&exclude_replies=true`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TrumpTracker/1.0)" },
      timeout: 10000,
    });

    for (const post of res.data || []) {
      if (store.seenTruthIds.has(post.id)) continue;
      store.seenTruthIds.add(post.id);

      // Strip HTML tags from content
      const text = (post.content || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (!text || text.length < 10) continue;

      const signals = detectSignals(text);
      const date = post.created_at ? post.created_at.split("T")[0] : new Date().toISOString().split("T")[0];

      let aiSummary = null;
      if (signals.length > 0) {
        aiSummary = await analyzeWithClaude("Truth Social Post", date, text, signals);
        for (const sig of signals) {
          store.signals.unshift({
            id: `sig_truth_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            appearanceId: `truth_${post.id}`,
            appearanceTitle: text.slice(0, 80),
            date,
            ...sig,
          });
          await recordMention(sig.company, date, text.slice(0, 80));
        }
      }

      found.push({
        id: `truth_${post.id}`,
        truthId: post.id,
        text,
        date,
        createdAt: post.created_at,
        url: post.url || `https://truthsocial.com/@realDonaldTrump/${post.id}`,
        reblogsCount: post.reblogs_count || 0,
        favouritesCount: post.favourites_count || 0,
        repliesCount: post.replies_count || 0,
        signals,
        aiSummary,
        hasSignals: signals.length > 0,
      });
    }

    if (found.length > 0) {
      store.truthPosts.unshift(...found);
      store.truthPosts = store.truthPosts.slice(0, 200); // keep latest 200
      console.log(`  📣 Truth Social: ${found.length} new posts`);
    }
  } catch (e) {
    store.errors.push({ time: new Date().toISOString(), source: "TruthSocial", error: e.message });
  }
  return found;
}

// ─── Main poll cycle ─────────────────────────────────────────────────────────
async function pollForNewTranscripts() {
  console.log(`[${new Date().toISOString()}] Polling for new Trump transcripts...`);
  store.lastPoll = new Date().toISOString();
  store.pollCount++;

  const [revItems, senateItems] = await Promise.all([
    scrapeRevCom(),
    scrapeSenateTranscripts(),
    scrapeTruthSocial(),
  ]);

  const allItems = [...revItems, ...senateItems];
  const newItems = allItems.filter(item => item.url && !store.seenUrls.has(item.url));

  console.log(`Found ${allItems.length} total, ${newItems.length} new.`);

  for (const item of newItems.slice(0, 5)) { // process max 5 per poll cycle
    store.seenUrls.add(item.url);

    console.log(`  Processing: ${item.title}`);
    const text = await fetchTranscriptText(item.url);

    if (!text || text.length < 200) {
      console.log(`  Skipped (no usable text): ${item.url}`);
      continue;
    }

    const signals = detectSignals(text);
    const date = new Date().toISOString().split("T")[0]; // approximate; improve with DOM parsing

    // Only run expensive Claude analysis if signals found
    let aiSummary = null;
    if (signals.length > 0) {
      aiSummary = await analyzeWithClaude(item.title, date, text, signals);
    }

    const appearance = {
      id: `app_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title: item.title,
      url: item.url,
      source: item.source,
      date,
      scannedAt: new Date().toISOString(),
      textLength: text.length,
      signals,
      aiSummary,
      hasSignals: signals.length > 0,
      topSignal: signals[0] || null,
    };

    store.appearances.unshift(appearance);

    // Add to global signals feed + record first-mention stock prices
    for (const sig of signals) {
      store.signals.unshift({
        id: `sig_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        appearanceId: appearance.id,
        appearanceTitle: item.title,
        date,
        ...sig,
      });
      await recordMention(sig.company, date, item.title);
    }

    console.log(`  ✓ Processed "${item.title}" — ${signals.length} signals`);
  }
}

// ─── Seed with historical data for demo purposes ─────────────────────────────
async function seedDemoData() {
  const demos = [
    {
      id: "demo_1",
      title: "Trump Rally in Michigan — Buy Tesla, Nvidia Incredible",
      url: "https://www.rev.com/blog/transcripts/example-michigan-rally",
      source: "Rev.com",
      date: "2025-11-14",
      scannedAt: new Date(Date.now() - 86400000 * 2).toISOString(),
      textLength: 12400,
      signals: [
        { company: "Tesla", score: 17, sentiment: "STRONG_BUY", hits: [{ type: "STRONG_BUY", pattern: "you should buy", quote: "You should buy Tesla. Elon is doing an incredible job." }] },
        { company: "Nvidia", score: 11, sentiment: "STRONG_BUY", hits: [{ type: "POSITIVE", pattern: "incredible company", quote: "Nvidia is an incredible company. The chips are unbelievable." }] },
        { company: "Ford", score: -6, sentiment: "NEGATIVE", hits: [{ type: "NEGATIVE", pattern: "moved jobs", quote: "Ford moved jobs to Mexico. Very disappointing." }] },
      ],
      aiSummary: "• Tesla flagged as explicit buy — CEO praised directly by name\n• Nvidia described as 'incredible' — semiconductor demand narrative consistent\n• Ford singled out negatively over offshoring — potential headwind\n• Overall tone: bullish on tech and domestic manufacturing\n• Signal strength: HIGH — two STRONG_BUY ratings in one speech",
      hasSignals: true,
    },
    {
      id: "demo_2",
      title: "White House Press Conference — Trade, Boeing, Goldman",
      url: "https://www.rev.com/blog/transcripts/example-press-conference",
      source: "Rev.com",
      date: "2025-12-03",
      scannedAt: new Date(Date.now() - 86400000).toISOString(),
      textLength: 8700,
      signals: [
        { company: "Boeing", score: 8, sentiment: "BUY", hits: [{ type: "POSITIVE", pattern: "doing a great job", quote: "Boeing is doing a great job, they're coming back strong." }] },
        { company: "Goldman Sachs", score: 5, sentiment: "POSITIVE", hits: [{ type: "POSITIVE", pattern: "great company", quote: "Goldman Sachs, great company, great people." }] },
        { company: "Target", score: -6, sentiment: "NEGATIVE", hits: [{ type: "NEGATIVE", pattern: "disaster", quote: "Target has been a disaster, frankly. A total disaster." }] },
      ],
      aiSummary: "• Boeing mentioned positively amid defense contract cycle — worth monitoring\n• Goldman Sachs praised generically — limited actionability\n• Target explicitly criticized — possible consumer boycott narrative risk\n• Signal strength: MODERATE",
      hasSignals: true,
    },
  ];

  // Historical prices at time of demo speeches (hardcoded — candle API requires paid plan)
  const historicalPrices = {
    "Tesla":        { date: "2025-11-14", price: 328.50 },
    "Nvidia":       { date: "2025-11-14", price: 147.20 },
    "Ford":         { date: "2025-11-14", price: 10.89 },
    "Boeing":       { date: "2025-12-03", price: 157.40 },
    "Goldman Sachs":{ date: "2025-12-03", price: 594.00 },
    "Target":       { date: "2025-12-03", price: 129.50 },
  };

  for (const d of demos) {
    store.appearances.push(d);
    store.seenUrls.add(d.url);
    for (const sig of d.signals) {
      store.signals.push({
        id: `sig_demo_${Math.random().toString(36).slice(2, 9)}`,
        appearanceId: d.id,
        appearanceTitle: d.title,
        date: d.date,
        ...sig,
      });
      // Seed historical price directly instead of calling API
      const hist = historicalPrices[sig.company];
      if (hist && !mentionPriceStore[sig.company]) {
        mentionPriceStore[sig.company] = {
          ticker: getTicker(sig.company),
          company: sig.company,
          firstMentionDate: hist.date,
          firstMentionSpeech: d.title,
          firstMentionPrice: hist.price,
        };
      }
    }
  }
}

// ─── REST API routes ──────────────────────────────────────────────────────────

// GET /api/status — health + poll status
app.get("/api/status", (req, res) => {
  res.json({
    status: "running",
    lastPoll: store.lastPoll,
    pollCount: store.pollCount,
    appearancesTracked: store.appearances.length,
    signalsDetected: store.signals.length,
    recentErrors: store.errors.slice(-5),
    nextPoll: `Every ${POLL_INTERVAL_MINUTES} minutes`,
  });
});

// GET /api/appearances — all tracked appearances, newest first
app.get("/api/appearances", (req, res) => {
  const { limit = 50, signalsOnly } = req.query;
  let data = store.appearances;
  if (signalsOnly === "true") data = data.filter(a => a.hasSignals);
  res.json(data.slice(0, Number(limit)));
});

// GET /api/signals — all detected market signals
app.get("/api/signals", (req, res) => {
  const { limit = 100, sentiment, company } = req.query;
  let data = store.signals;
  if (sentiment) data = data.filter(s => s.sentiment === sentiment.toUpperCase());
  if (company) data = data.filter(s => s.company.toLowerCase().includes(company.toLowerCase()));
  res.json(data.slice(0, Number(limit)));
});

// GET /api/companies — aggregated signal count by company
app.get("/api/companies", (req, res) => {
  const map = {};
  store.signals.forEach(sig => {
    if (!map[sig.company]) map[sig.company] = { company: sig.company, totalScore: 0, signalCount: 0, latestSentiment: sig.sentiment, latestDate: sig.date, appearances: [] };
    map[sig.company].totalScore += sig.score;
    map[sig.company].signalCount++;
    if (!map[sig.company].appearances.includes(sig.appearanceTitle)) {
      map[sig.company].appearances.push(sig.appearanceTitle);
    }
  });
  const sorted = Object.values(map).sort((a, b) => b.totalScore - a.totalScore);
  res.json(sorted);
});

// POST /api/poll — manually trigger a poll cycle
app.post("/api/poll", async (req, res) => {
  res.json({ message: "Poll started" });
  await pollForNewTranscripts();
});

// POST /api/scan — manually submit transcript text for scanning
app.post("/api/scan", async (req, res) => {
  const { title, date, text, url } = req.body;
  if (!text || text.length < 50) return res.status(400).json({ error: "Text too short" });

  // AI authenticity gate — reject submissions that aren't genuine Trump content
  if (ANTHROPIC_API_KEY) {
    try {
      const check = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 100,
        messages: [{
          role: "user",
          content: `Is the following text a genuine Donald Trump speech, statement, press conference, or Truth Social post? Reply with exactly one word: AUTHENTIC or INAUTHENTIC, then a dash, then one sentence explaining why.\n\nText: "${text.slice(0, 1000)}"`,
        }],
      });
      const verdict = check.content[0].text.trim();
      if (verdict.toUpperCase().startsWith("INAUTHENTIC")) {
        const reason = verdict.split("-").slice(1).join("-").trim() || "Content does not appear to be genuine Trump speech or posts.";
        return res.status(422).json({ error: `Blocked: ${reason}` });
      }
    } catch (e) {
      // If AI check fails, allow through rather than blocking all submissions
      console.warn("Authenticity check failed, allowing through:", e.message);
    }
  }

  const signals = detectSignals(text);
  const aiSummary = signals.length > 0 ? await analyzeWithClaude(title || "Manual Submission", date || new Date().toISOString().split("T")[0], text, signals) : null;

  const appearance = {
    id: `manual_${Date.now()}`,
    title: title || "Manual Submission",
    url: url || null,
    source: "Manual",
    date: date || new Date().toISOString().split("T")[0],
    scannedAt: new Date().toISOString(),
    textLength: text.length,
    signals,
    aiSummary,
    hasSignals: signals.length > 0,
    topSignal: signals[0] || null,
  };

  store.appearances.unshift(appearance);
  signals.forEach(sig => {
    store.signals.unshift({ id: `sig_m_${Date.now()}`, appearanceId: appearance.id, appearanceTitle: appearance.title, date: appearance.date, ...sig });
  });

  res.json(appearance);
});

// DELETE /api/appearances/:id — remove a specific appearance and its signals
app.delete("/api/appearances/:id", (req, res) => {
  const { id } = req.params;
  const before = store.appearances.length;
  store.appearances = store.appearances.filter(a => a.id !== id);
  store.signals = store.signals.filter(s => s.appearanceId !== id);
  if (store.appearances.length < before) {
    res.json({ deleted: true });
  } else {
    res.status(404).json({ error: "Appearance not found" });
  }
});

// DELETE /api/appearances/manual/all — remove all manual entries
app.delete("/api/appearances/manual/all", (req, res) => {
  const manualIds = store.appearances.filter(a => a.id.startsWith("manual_")).map(a => a.id);
  store.appearances = store.appearances.filter(a => !a.id.startsWith("manual_"));
  store.signals = store.signals.filter(s => !manualIds.includes(s.appearanceId));
  res.json({ deleted: manualIds.length });
});


// GET /api/truthsocial — Trump's Truth Social posts (cached)
app.get('/api/truthsocial', (req, res) => {
  const { limit = 50 } = req.query;
  res.json(store.truthPosts.slice(0, Number(limit)));
});

// GET /api/truthsocial/tagged — signal posts from database
app.get('/api/truthsocial/tagged', async (req, res) => {
  const posts = await loadSignalPosts();
  res.json(posts);
});

// GET /api/truthsocial/proxy — fetch Trump's posts from trump.fm API
app.get('/api/truthsocial/proxy', async (req, res) => {
  let posts = [];

  try {
    const r = await axios.get("https://trump.fm/api/posts?platform=truth&limit=40", {
      headers: { "User-Agent": "TrumpSignalTracker/1.0" },
      timeout: 10000,
    });

    const raw = r.data?.data || r.data?.posts || (Array.isArray(r.data) ? r.data : []);
    for (const p of raw) {
      const text = (p.content || "").trim();
      if (!text || text.length < 5) continue;

      const id = p.id || `trump_${p.platformId}`;
      const date = p.createdAt ? p.createdAt.split("T")[0] : new Date().toISOString().split("T")[0];
      const url = p.platformId
        ? `https://truthsocial.com/@realDonaldTrump/${p.platformId}`
        : `https://trump.fm/post/${id}`;
      const signals = detectSignals(text);

      posts.push({
        id,
        text,
        date,
        createdAt: p.createdAt || null,
        url,
        reblogsCount: p.externalMetrics?.reposts || 0,
        favouritesCount: p.externalMetrics?.likes || 0,
        repliesCount: p.externalMetrics?.replies || 0,
        signals,
        hasSignals: signals.length > 0,
        topSignal: signals[0] || null,
      });
    }
    console.log(`[trump.fm] Fetched ${posts.length} posts`);
  } catch (e) {
    console.error(`[trump.fm] ${e.message}`);
  }

  if (posts.length === 0) {
    const cached = store.truthPosts.filter(p => p.hasSignals);
    if (cached.length > 0) return res.json({ cached: true, posts: cached });
    return res.json({ error: "Could not load posts from trump.fm. Try again shortly." });
  }

  for (const post of posts) {
    if (!store.seenTruthIds.has(post.id)) {
      store.seenTruthIds.add(post.id);
      store.truthPosts.unshift(post);
      for (const sig of post.signals) {
        await recordMention(sig.company, post.date, post.text.slice(0, 80));
      }
      if (post.hasSignals) await saveSignalPost(post);
    }
  }
  store.truthPosts = store.truthPosts.slice(0, 200);

  res.json(posts);
});

// POST /api/backfill — paginate trump.fm history back to Jan 1 2025, save signal posts
app.post('/api/backfill', async (req, res) => {
  res.json({ message: "Backfill started — check /api/backfill/status for progress" });

  const CUTOFF = new Date("2025-01-01T00:00:00Z");
  let cursor = null;
  let page = 0;
  let totalScanned = 0;
  let totalSignals = 0;
  let done = false;

  store.backfill = { running: true, page: 0, scanned: 0, signals: 0, done: false, startedAt: new Date().toISOString() };

  while (!done) {
    try {
      const url = `https://trump.fm/api/posts?platform=truth&limit=100${cursor ? `&cursor=${cursor}` : ""}`;
      const r = await axios.get(url, { headers: { "User-Agent": "TrumpSignalTracker/1.0" }, timeout: 15000 });
      const raw = r.data?.data || r.data?.posts || (Array.isArray(r.data) ? r.data : []);
      const meta = r.data?.meta;

      if (!raw || raw.length === 0) break;

      page++;
      let hitsOlderThanCutoff = 0;

      for (const p of raw) {
        const postDate = new Date(p.createdAt || 0);
        if (postDate < CUTOFF) { hitsOlderThanCutoff++; continue; }

        const text = (p.content || "").trim();
        if (!text) continue;

        totalScanned++;
        const id = p.id || `trump_${p.platformId}`;

        if (store.seenTruthIds.has(id)) continue;

        const date = p.createdAt.split("T")[0];
        const postUrl = p.platformId ? `https://truthsocial.com/@realDonaldTrump/${p.platformId}` : `https://trump.fm/post/${id}`;
        const signals = detectSignals(text);

        const post = {
          id, text, date, createdAt: p.createdAt,
          url: postUrl,
          reblogsCount: p.externalMetrics?.reposts || 0,
          favouritesCount: p.externalMetrics?.likes || 0,
          repliesCount: p.externalMetrics?.replies || 0,
          signals, hasSignals: signals.length > 0, topSignal: signals[0] || null,
        };

        store.seenTruthIds.add(id);
        store.truthPosts.push(post);

        if (signals.length > 0) {
          totalSignals++;
          await saveSignalPost(post);
          for (const sig of signals) {
            await recordMention(sig.company, date, text.slice(0, 80));
          }
        }
      }

      // Stop if all posts on this page were older than cutoff, or no next cursor
      if (hitsOlderThanCutoff === raw.length) { done = true; break; }

      cursor = meta?.nextCursor || meta?.cursor || null;
      if (!cursor) { done = true; break; }

      store.backfill = { running: true, page, scanned: totalScanned, signals: totalSignals, done: false, startedAt: store.backfill.startedAt };

      // Small delay to be respectful to the API
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.error(`[Backfill] page ${page} error: ${e.message}`);
      break;
    }
  }

  store.truthPosts = store.truthPosts.slice(0, 1000);
  store.backfill = { running: false, page, scanned: totalScanned, signals: totalSignals, done: true, startedAt: store.backfill.startedAt, finishedAt: new Date().toISOString() };
  console.log(`[Backfill] Done — scanned ${totalScanned} posts, found ${totalSignals} with signals`);
});

// GET /api/backfill/status
app.get('/api/backfill/status', (req, res) => {
  res.json(store.backfill || { running: false, done: false });
});

// GET /api/debug/trumpfm — test trump.fm connectivity
app.get('/api/debug/trumpfm', async (req, res) => {
  try {
    const r = await axios.get("https://trump.fm/api/posts?platform=truth&limit=3", {
      headers: { "User-Agent": "TrumpSignalTracker/1.0" },
      timeout: 10000,
    });
    res.json({ status: r.status, dataType: typeof r.data, isArray: Array.isArray(r.data), keys: r.data && typeof r.data === 'object' ? Object.keys(r.data) : null, sample: JSON.stringify(r.data).slice(0, 500) });
  } catch(e) {
    res.json({ error: e.message, status: e.response?.status, data: e.response?.data });
  }
});

// GET /api/debug/truthsocial — test Truth Social connectivity
app.get('/api/debug/truthsocial', async (req, res) => {
  try {
    const lookup = await axios.get('https://truthsocial.com/api/v1/accounts/lookup?acct=realDonaldTrump', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TrumpTracker/1.0)' },
      timeout: 10000,
    });
    const id = lookup.data?.id;
    if (!id) return res.json({ error: 'No account ID returned', data: lookup.data });
    const posts = await axios.get(`https://truthsocial.com/api/v1/accounts/${id}/statuses?limit=3`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TrumpTracker/1.0)' },
      timeout: 10000,
    });
    res.json({ accountId: id, postCount: posts.data?.length, firstPost: posts.data?.[0]?.content?.slice(0, 200) });
  } catch(e) {
    res.json({ error: e.message, status: e.response?.status, data: e.response?.data });
  }
});

// DELETE /api/debug/mention-prices — clear stale mention prices so backfill can re-fetch correct historical ones
app.delete('/api/debug/mention-prices', async (req, res) => {
  try {
    const { Pool } = require('pg');
    if (!process.env.DATABASE_URL) return res.json({ error: 'DATABASE_URL not set' });
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await pool.query('DELETE FROM mention_prices');
    await pool.end();
    // Also clear in-memory store
    Object.keys(mentionPriceStore).forEach(k => delete mentionPriceStore[k]);
    res.json({ cleared: true });
  } catch (e) {
    res.json({ error: e.message });
  }
});

// GET /api/debug/db — inspect database contents
app.get('/api/debug/db', async (req, res) => {
  try {
    const { Pool } = require('pg');
    if (!process.env.DATABASE_URL) return res.json({ error: 'DATABASE_URL not set' });
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    const count = await pool.query('SELECT COUNT(*) FROM signal_posts');
    const sample = await pool.query('SELECT id, date, has_signals, length(text) as text_len FROM signal_posts LIMIT 10');
    const tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
    await pool.end();
    res.json({ tableCount: count.rows[0], sample: sample.rows, tables: tables.rows });
  } catch (e) {
    res.json({ error: e.message, stack: e.stack?.slice(0, 500) });
  }
});

// GET /api/debug/finnhub — test Finnhub connectivity
app.get('/api/debug/finnhub', async (req, res) => {
  const axios = require('axios');
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return res.json({ error: 'FINNHUB_API_KEY not set', env: Object.keys(process.env).filter(k => k.includes('FINN')) });
  try {
    const quoteRes = await axios.get(`https://finnhub.io/api/v1/quote?symbol=AAPL&token=${key}`, { timeout: 8000 });
    const now = Math.floor(Date.now() / 1000);
    const candleRes = await axios.get(`https://finnhub.io/api/v1/stock/candle?symbol=AAPL&resolution=D&from=${now - 86400 * 5}&to=${now}&token=${key}`, { timeout: 8000 });
    res.json({ keyPresent: true, keyPrefix: key.slice(0,6)+'...', quote: quoteRes.data, candle: candleRes.data });
  } catch(e) {
    res.json({ error: e.message, status: e.response?.status, data: e.response?.data });
  }
});

// GET /api/digest — daily digest: all mentioned companies with stock price comparison
app.get('/api/digest', async (req, res) => {
  try {
    const digest = await buildDailyDigest();
    res.json({ generatedAt: new Date().toISOString(), entries: digest });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
async function start() {
  await initDb();
  await restoreMentionPrices();

  // Restore saved Truth Social signal posts
  const savedPosts = await loadSignalPosts();
  for (const post of savedPosts) {
    if (!store.seenTruthIds.has(post.id)) {
      store.seenTruthIds.add(post.id);
      store.truthPosts.push(post);
    }
  }
  if (savedPosts.length > 0) console.log(`[DB] Restored ${savedPosts.length} Truth Social signal posts.`);

  await seedDemoData();

  cron.schedule(`*/${POLL_INTERVAL_MINUTES} * * * *`, pollForNewTranscripts);
  pollForNewTranscripts();

  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════╗
║   TRUMP SPEECH SIGNAL TRACKER — Server       ║
║   http://localhost:${PORT}                      ║
║   Polling every ${POLL_INTERVAL_MINUTES} minutes                   ║
╚══════════════════════════════════════════════╝
    `);
  });
}

start();
