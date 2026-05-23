# 🎙️ Trump Speech Signal Tracker

Automatically polls public transcript sources every 5 minutes, scans every Trump speech for market-moving language, and surfaces buy/avoid signals in a live dashboard.

---

## How It Works

```
Rev.com ──┐
           ├──▶ Scraper (every 5 min) ──▶ Signal Detector ──▶ Claude AI ──▶ REST API ──▶ Dashboard
Factbase ──┘
```

**Signal types detected:**
- 🚀 STRONG BUY — "you should buy X", "you have to buy X"
- 📈 BUY — "buy X", "great investment"
- ✨ POSITIVE — "incredible company", "doing a great job"
- ⚠️ NEGATIVE — "disaster", "not so great", "moved jobs"
- 🚫 AVOID — "disgrace", "failing", explicit negative

---

## Setup

### 1. Backend server

```bash
cd server
npm install
cp .env.example .env
# Edit .env and add your Anthropic API key
nano .env
node index.js
```

Server runs at **http://localhost:3001**

### 2. React frontend

```bash
cd client
npm install
npm start
```

Dashboard opens at **http://localhost:3000**

---

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/status` | Server health, poll count, last poll time |
| `GET /api/appearances` | All tracked speeches (newest first) |
| `GET /api/appearances?signalsOnly=true` | Only speeches with signals |
| `GET /api/signals` | All detected signals |
| `GET /api/signals?sentiment=BUY` | Filter by sentiment |
| `GET /api/signals?company=Tesla` | Filter by company |
| `GET /api/companies` | Companies ranked by cumulative score |
| `POST /api/poll` | Manually trigger a poll cycle |
| `POST /api/scan` | Submit transcript text for scanning |

---

## Data Sources

| Source | URL | Update frequency |
|---|---|---|
| Rev.com Trump Transcripts | rev.com/blog/transcript-category/donald-trump-transcripts | Within hours of any appearance |
| Senate Democrats/Factbase | democrats.senate.gov/newsroom/trump-transcripts | Periodically |

---

## Extending This

**Add more sources:**
Add a new scraper function in `server/index.js` following the same pattern as `scrapeRevCom()`. Good candidates:
- C-SPAN transcript search
- White House press pool reports
- Truth Social (via ScrapeCreators API — paid)

**Add real-time speech monitoring:**
Wire in AssemblyAI or Deepgram with a C-SPAN stream URL. Their WebSocket APIs can return partial transcripts in ~2 seconds — fast enough to trigger alerts mid-sentence.

**Add persistence:**
Replace the in-memory `store` object with SQLite (`better-sqlite3`) for data that survives restarts.

**Add email/Slack alerts:**
```js
// In processAppearance(), after signals are detected:
if (signals.some(s => s.sentiment === "STRONG_BUY")) {
  await sendSlackAlert(`🚀 STRONG BUY: ${signals[0].company} — "${signals[0].hits[0].quote}"`);
}
```

---

## Requirements
- Node.js 18+
- Anthropic API key (for AI summaries — optional, pattern detection works without it)
- No database required (in-memory by default)
