/**
 * db.js — PostgreSQL connection and table setup
 * Gracefully no-ops if DATABASE_URL is not set.
 */

const { Pool } = require("pg");

let pool = null;

function getPool() {
  if (!pool && process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}

async function initDb() {
  const db = getPool();
  if (!db) { console.log("[DB] No DATABASE_URL — running without persistence."); return; }

  await db.query(`
    CREATE TABLE IF NOT EXISTS signal_posts (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      date TEXT NOT NULL,
      created_at TEXT,
      url TEXT,
      reblogs_count INTEGER DEFAULT 0,
      favourites_count INTEGER DEFAULT 0,
      replies_count INTEGER DEFAULT 0,
      signals JSONB NOT NULL DEFAULT '[]',
      has_signals BOOLEAN DEFAULT false,
      top_signal JSONB,
      stored_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS mention_prices (
      company TEXT PRIMARY KEY,
      ticker TEXT NOT NULL,
      first_mention_date TEXT NOT NULL,
      first_mention_speech TEXT,
      first_mention_price NUMERIC,
      stored_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  console.log("[DB] Tables ready.");
}

async function saveSignalPost(post) {
  const db = getPool();
  if (!db) return;
  try {
    await db.query(`
      INSERT INTO signal_posts (id, text, date, created_at, url, reblogs_count, favourites_count, replies_count, signals, has_signals, top_signal)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (id) DO NOTHING
    `, [post.id, post.text, post.date, post.createdAt || null, post.url || null,
        post.reblogsCount || 0, post.favouritesCount || 0, post.repliesCount || 0,
        JSON.stringify(post.signals), post.hasSignals, post.topSignal ? JSON.stringify(post.topSignal) : null]);
  } catch (e) {
    console.error("[DB] saveSignalPost error:", e.message);
  }
}

async function loadSignalPosts() {
  const db = getPool();
  if (!db) return [];
  try {
    const { rows } = await db.query("SELECT * FROM signal_posts ORDER BY date DESC LIMIT 500");
    return rows.map(r => ({
      id: r.id, text: r.text, date: r.date, createdAt: r.created_at,
      url: r.url, reblogsCount: r.reblogs_count, favouritesCount: r.favourites_count,
      repliesCount: r.replies_count, signals: r.signals, hasSignals: r.has_signals,
      topSignal: r.top_signal,
    }));
  } catch (e) {
    console.error("[DB] loadSignalPosts error:", e.message);
    return [];
  }
}

async function saveMentionPrice(record) {
  const db = getPool();
  if (!db) return;
  try {
    await db.query(`
      INSERT INTO mention_prices (company, ticker, first_mention_date, first_mention_speech, first_mention_price)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (company) DO UPDATE SET
        first_mention_price = COALESCE(EXCLUDED.first_mention_price, mention_prices.first_mention_price)
    `, [record.company, record.ticker, record.firstMentionDate, record.firstMentionSpeech || null, record.firstMentionPrice || null]);
  } catch (e) {
    console.error("[DB] saveMentionPrice error:", e.message);
  }
}

async function loadMentionPrices() {
  const db = getPool();
  if (!db) return [];
  try {
    const { rows } = await db.query("SELECT * FROM mention_prices");
    return rows.map(r => ({
      company: r.company, ticker: r.ticker,
      firstMentionDate: r.first_mention_date, firstMentionSpeech: r.first_mention_speech,
      firstMentionPrice: r.first_mention_price ? Number(r.first_mention_price) : null,
    }));
  } catch (e) {
    console.error("[DB] loadMentionPrices error:", e.message);
    return [];
  }
}

module.exports = { initDb, saveSignalPost, loadSignalPosts, saveMentionPrice, loadMentionPrices };
