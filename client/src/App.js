import { useState, useEffect, useCallback } from "react";

const API = process.env.REACT_APP_API_URL || "http://localhost:3001";

// Douro Azul palette
const C = {
  bg:        "#06111f",   // deepest navy — page background
  surface:   "#0b1c33",   // card / header surface
  raised:    "#0f2444",   // slightly elevated surface
  hover:     "#142d55",   // hover state
  border:    "#1e3a6e",   // subtle border
  borderLt:  "#2d5289",   // visible border
  gold:      "#c9a227",   // primary gold accent
  goldLt:    "#e0bc4a",   // lighter gold for hover
  text:      "#edf2fb",   // primary text (cream-white)
  textSub:   "#8aaac8",   // secondary text (steel blue)
  textMute:  "#4a6a8a",   // muted text
  textFaint: "#2a4060",   // barely visible
};

const SENTIMENT_CFG = {
  STRONG_BUY: { label: "STRONG BUY", color: "#00e87a", bg: "#00e87a12", icon: "🚀" },
  BUY:        { label: "BUY",         color: "#4ade80", bg: "#4ade8010", icon: "📈" },
  POSITIVE:   { label: "POSITIVE",    color: "#f0c040", bg: "#f0c04010", icon: "✨" },
  NEUTRAL:    { label: "NEUTRAL",     color: "#5a7a9a", bg: "#5a7a9a10", icon: "➖" },
  NEGATIVE:   { label: "NEGATIVE",    color: "#f87171", bg: "#f8717110", icon: "⚠️" },
  AVOID:      { label: "AVOID",       color: "#ef4444", bg: "#ef444412", icon: "🚫" },
};

function useFetch(url, interval = 30000) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetch_ = useCallback(async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    fetch_();
    const t = setInterval(fetch_, interval);
    return () => clearInterval(t);
  }, [fetch_, interval]);

  return { data, loading, error, refetch: fetch_ };
}

function Badge({ sentiment }) {
  const cfg = SENTIMENT_CFG[sentiment] || SENTIMENT_CFG.NEUTRAL;
  return (
    <span style={{
      background: cfg.bg, border: `1px solid ${cfg.color}44`,
      color: cfg.color, borderRadius: 4, padding: "2px 8px",
      fontSize: 11, fontFamily: "monospace", fontWeight: 700, letterSpacing: 1,
      whiteSpace: "nowrap",
    }}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

function AppearanceCard({ appearance }) {
  const [open, setOpen] = useState(false);
  const top = appearance.topSignal;
  const cfg = top ? (SENTIMENT_CFG[top.sentiment] || SENTIMENT_CFG.NEUTRAL) : null;

  return (
    <div style={{
      background: C.surface, border: `1px solid ${cfg ? cfg.color + "33" : C.border}`,
      borderLeft: `3px solid ${cfg ? cfg.color : C.gold}`,
      borderRadius: 10, padding: "14px 18px", marginBottom: 10, cursor: "pointer",
    }} onClick={() => setOpen(!open)}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 17, color: C.text, letterSpacing: 0.5, marginBottom: 4 }}>
            {appearance.title}
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 11, color: C.textMute, fontFamily: "monospace" }}>{appearance.date}</span>
            <span style={{ fontSize: 11, color: C.textFaint, fontFamily: "monospace" }}>{appearance.source}</span>
            <span style={{ fontSize: 11, color: C.textMute, fontFamily: "monospace" }}>
              {(appearance.textLength / 1000).toFixed(1)}k chars scanned
            </span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {appearance.signals.slice(0, 3).map((s, i) => <Badge key={i} sentiment={s.sentiment} />)}
          {appearance.signals.length > 3 && (
            <span style={{ fontSize: 11, color: C.textMute }}>+{appearance.signals.length - 3}</span>
          )}
          <span style={{ color: C.textMute, fontSize: 12 }}>{open ? "▲" : "▼"}</span>
        </div>
      </div>

      {open && (
        <div style={{ marginTop: 14, borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
          {appearance.aiSummary && (
            <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.gold}`, borderRadius: 8, padding: 14, marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: C.gold, letterSpacing: 2, fontFamily: "monospace", marginBottom: 8 }}>✦ AI ANALYSIS</div>
              <div style={{ fontSize: 12, color: C.textSub, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{appearance.aiSummary}</div>
            </div>
          )}
          {appearance.signals.map((sig, i) => {
            const scfg = SENTIMENT_CFG[sig.sentiment] || SENTIMENT_CFG.NEUTRAL;
            return (
              <div key={i} style={{ marginBottom: 10, background: scfg.bg, border: `1px solid ${scfg.color}22`, borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, color: scfg.color, letterSpacing: 1 }}>{sig.company}</span>
                    <Badge sentiment={sig.sentiment} />
                  </div>
                  <span style={{ color: scfg.color, fontFamily: "monospace", fontSize: 13, fontWeight: 700 }}>
                    {sig.score > 0 ? "+" : ""}{sig.score}
                  </span>
                </div>
                {sig.hits.map((hit, j) => (
                  <div key={j} style={{ fontSize: 12, color: C.textMute, fontStyle: "italic", marginTop: 4 }}>"{hit.quote}"</div>
                ))}
              </div>
            );
          })}
          {appearance.url && (
            <a href={appearance.url} target="_blank" rel="noreferrer"
              style={{ fontSize: 11, color: C.textFaint, fontFamily: "monospace", textDecoration: "none" }}
              onClick={e => e.stopPropagation()}>
              🔗 View original transcript →
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function TruthPostCard({ post }) {
  const [open, setOpen] = useState(false);
  const hasSignals = post.signals && post.signals.length > 0;
  const topSig = post.signals?.[0];
  const cfg = topSig ? (SENTIMENT_CFG[topSig.sentiment] || SENTIMENT_CFG.NEUTRAL) : null;

  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${cfg ? cfg.color + "33" : C.border}`,
      borderLeft: `3px solid ${cfg ? cfg.color : C.borderLt}`,
      borderRadius: 10, padding: "14px 18px", marginBottom: 10, cursor: hasSignals ? "pointer" : "default",
    }} onClick={() => hasSignals && setOpen(!open)}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: `linear-gradient(135deg,${C.gold},#8a6e10)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>🇺🇸</div>
            <div>
              <div style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>Donald J. Trump</div>
              <div style={{ fontSize: 10, color: C.textMute, fontFamily: "monospace" }}>
                @realDonaldTrump · {post.date}
                {post.createdAt && <> · {new Date(post.createdAt).toLocaleTimeString()}</>}
              </div>
            </div>
          </div>
          <div style={{ fontSize: 14, color: C.text, lineHeight: 1.7, marginBottom: 8 }}>{post.text}</div>
          <div style={{ display: "flex", gap: 16, fontSize: 11, color: C.textMute, fontFamily: "monospace" }}>
            <span>🔁 {post.reblogsCount.toLocaleString()}</span>
            <span>❤️ {post.favouritesCount.toLocaleString()}</span>
            <span>💬 {post.repliesCount.toLocaleString()}</span>
            <a href={post.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
              style={{ color: C.textFaint, textDecoration: "none", marginLeft: "auto" }}>
              View on Truth Social →
            </a>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
          {post.signals.slice(0, 3).map((s, i) => <Badge key={i} sentiment={s.sentiment} />)}
          {hasSignals && <span style={{ color: C.textMute, fontSize: 12 }}>{open ? "▲" : "▼"}</span>}
        </div>
      </div>

      {open && hasSignals && (
        <div style={{ marginTop: 14, borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
          {post.aiSummary && (
            <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.gold}`, borderRadius: 8, padding: 14, marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: C.gold, letterSpacing: 2, fontFamily: "monospace", marginBottom: 8 }}>✦ AI ANALYSIS</div>
              <div style={{ fontSize: 12, color: C.textSub, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{post.aiSummary}</div>
            </div>
          )}
          {post.signals.map((sig, i) => {
            const scfg = SENTIMENT_CFG[sig.sentiment] || SENTIMENT_CFG.NEUTRAL;
            return (
              <div key={i} style={{ marginBottom: 10, background: scfg.bg, border: `1px solid ${scfg.color}22`, borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 16, color: scfg.color, letterSpacing: 1 }}>{sig.company}</span>
                    <Badge sentiment={sig.sentiment} />
                  </div>
                  <span style={{ color: scfg.color, fontFamily: "monospace", fontSize: 13, fontWeight: 700 }}>
                    {sig.score > 0 ? "+" : ""}{sig.score}
                  </span>
                </div>
                {sig.hits.map((hit, j) => (
                  <div key={j} style={{ fontSize: 12, color: C.textMute, fontStyle: "italic", marginTop: 4 }}>"{hit.quote}"</div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DigestRow({ entry, rank }) {
  const isUp = entry.direction === "up";
  const noData = entry.pctChange === null;

  const pctColor = noData ? C.textMute : isUp ? "#00e87a" : "#ef4444";
  const pctBg = noData ? "transparent" : isUp ? "#00e87a12" : "#ef444412";
  const arrow = noData ? "–" : isUp ? "▲" : "▼";

  const rowBg = rank % 2 === 0 ? C.surface : C.raised;

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "36px 140px 80px 120px 120px 130px 1fr",
      alignItems: "center",
      gap: 0,
      padding: "13px 20px",
      borderBottom: `1px solid ${C.border}`,
      background: rowBg,
      transition: "background 0.15s",
    }}
      onMouseEnter={e => e.currentTarget.style.background = C.hover}
      onMouseLeave={e => e.currentTarget.style.background = rowBg}
    >
      <div style={{ fontSize: 12, color: C.textFaint, fontFamily: "monospace", textAlign: "center" }}>{rank}</div>
      <div>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 17, color: C.text, letterSpacing: 1 }}>{entry.company}</div>
        <div style={{ fontSize: 10, color: C.textMute, fontFamily: "monospace" }}>{entry.ticker}</div>
      </div>
      <div style={{ fontSize: 11, color: C.textSub, fontFamily: "monospace" }}>{entry.firstMentionDate}</div>
      <div style={{ fontFamily: "monospace", fontSize: 14 }}>
        {entry.firstMentionPrice !== null
          ? <span style={{ color: C.textSub }}>${entry.firstMentionPrice.toFixed(2)}</span>
          : <span style={{ color: C.textFaint }}>N/A</span>
        }
      </div>
      <div style={{ fontFamily: "monospace", fontSize: 14 }}>
        {entry.currentPrice !== null
          ? <span style={{ color: C.text }}>${entry.currentPrice.toFixed(2)}</span>
          : <span style={{ color: C.textFaint }}>N/A</span>
        }
      </div>
      <div>
        <span style={{
          background: pctBg, color: pctColor,
          border: `1px solid ${pctColor}33`, borderRadius: 6,
          padding: "3px 10px", fontFamily: "monospace", fontSize: 14, fontWeight: 700,
        }}>
          {noData ? "–" : `${arrow} ${Math.abs(entry.pctChange).toFixed(2)}%`}
        </span>
      </div>
      <div style={{ fontSize: 11, color: C.textMute, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingLeft: 12 }}>
        {entry.firstMentionSpeech}
      </div>
    </div>
  );
}

function Tab({ id, label, active, onClick, disabled }) {
  return (
    <button onClick={() => !disabled && onClick(id)} style={{
      padding: "8px 18px", borderRadius: 7, fontSize: 13, border: "none",
      fontFamily: "system-ui, sans-serif", fontWeight: 500,
      background: active ? C.gold : "transparent",
      color: disabled ? C.textFaint : active ? "#06111f" : C.textSub,
      cursor: disabled ? "not-allowed" : "pointer", transition: "all 0.15s",
    }}>{label}</button>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState("live");
  const [manualText, setManualText] = useState("");
  const [manualTitle, setManualTitle] = useState("");
  const [manualDate, setManualDate] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [triggering, setTriggering] = useState(false);
  const [digestLoading, setDigestLoading] = useState(false);
  const [digestData, setDigestData] = useState(null);

  const { data: status, refetch: refetchStatus } = useFetch(`${API}/api/status`, 15000);
  const { data: appearances, loading: appLoading, refetch: refetchApps } = useFetch(`${API}/api/appearances?limit=50`, 20000);
  const { data: signals } = useFetch(`${API}/api/signals?limit=100`, 20000);
  const { data: companies } = useFetch(`${API}/api/companies`, 30000);
  const [truthPosts, setTruthPosts] = useState([]);
  const [truthLoading, setTruthLoading] = useState(true);
  const [truthError, setTruthError] = useState(null);

  const buySignals = (signals || []).filter(s => s.sentiment === "STRONG_BUY" || s.sentiment === "BUY");
  const avoidSignals = (signals || []).filter(s => s.sentiment === "AVOID" || s.sentiment === "NEGATIVE");

  async function loadDigest() {
    setDigestLoading(true);
    try {
      const res = await fetch(`${API}/api/digest`);
      const data = await res.json();
      setDigestData(data);
    } catch (e) {
      setDigestData({ error: e.message });
    } finally {
      setDigestLoading(false);
    }
  }

  useEffect(() => {
    if (activeTab === "digest") loadDigest();
  }, [activeTab]);

  const fetchTruthPosts = useCallback(async () => {
    setTruthLoading(true);
    setTruthError(null);
    // Route through backend proxy to avoid Truth Social IP/CORS blocks
    try {
      const res = await fetch(`${API}/api/truthsocial/proxy`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const posts = await res.json();
      if (posts.error) throw new Error(posts.error);
      setTruthPosts(posts);
    } catch (e) {
      setTruthError(e.message);
    } finally {
      setTruthLoading(false);
    }
  }, [API]);

  useEffect(() => {
    if (activeTab === "truth") {
      fetchTruthPosts();
      const t = setInterval(fetchTruthPosts, 60000);
      return () => clearInterval(t);
    }
  }, [activeTab, fetchTruthPosts]);

  async function triggerPoll() {
    setTriggering(true);
    try {
      await fetch(`${API}/api/poll`, { method: "POST" });
      setTimeout(() => { refetchStatus(); refetchApps(); setTriggering(false); }, 3000);
    } catch { setTriggering(false); }
  }

  async function submitManualScan() {
    if (!manualText.trim() || scanning) return;
    setScanning(true);
    setScanResult(null);
    try {
      const res = await fetch(`${API}/api/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: manualTitle, date: manualDate, text: manualText }),
      });
      const data = await res.json();
      setScanResult(data);
      refetchApps();
    } catch (e) {
      setScanResult({ error: e.message });
    } finally {
      setScanning(false);
    }
  }

  const serverOnline = !!status;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: ${C.bg}; color: ${C.text}; font-family: system-ui, sans-serif; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: ${C.bg}; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 2px; }
        textarea, input { color-scheme: dark; }
        textarea::placeholder, input::placeholder { color: ${C.textMute}; }
        @keyframes pulse { 0%,100%{opacity:1}50%{opacity:.3} }
        @keyframes fadein { from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)} }
        .fadein { animation: fadein .3s ease both; }
      `}</style>

      <div style={{ minHeight: "100vh", background: C.bg }}>
        {/* ── Header ── */}
        <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "18px 32px" }}>
          <div style={{ maxWidth: 1300, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 42, height: 42, borderRadius: 8, background: `linear-gradient(135deg,${C.gold},#8a6e10)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, boxShadow: `0 0 16px ${C.gold}44` }}>🎙️</div>
              <div>
                <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 26, letterSpacing: 3, color: C.text, lineHeight: 1 }}>TRUMP SIGNAL TRACKER</div>
                <div style={{ fontSize: 10, color: C.textMute, letterSpacing: 2, fontFamily: "monospace", marginTop: 3 }}>LIVE TRANSCRIPT MONITOR · AUTO-POLLING · AI ANALYSIS · STOCK TRACKER</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
              {status && (
                <>
                  <Stat label="APPEARANCES" value={status.appearancesTracked} color={C.gold} />
                  <Stat label="BUY SIGNALS" value={buySignals.length} color="#00e87a" />
                  <Stat label="AVOID" value={avoidSignals.length} color="#ef4444" />
                  <Stat label="POLLS RUN" value={status.pollCount} color={C.textSub} />
                </>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: serverOnline ? "#00e87a" : "#ef4444", animation: "pulse 2s infinite" }} />
                <span style={{ fontSize: 11, color: serverOnline ? "#00e87a" : "#ef4444", fontFamily: "monospace" }}>
                  {serverOnline ? "SERVER ONLINE" : "SERVER OFFLINE"}
                </span>
              </div>
              <button onClick={triggerPoll} disabled={triggering} style={{
                padding: "7px 16px", borderRadius: 6,
                border: `1px solid ${triggering ? C.border : C.gold}`,
                background: triggering ? C.raised : "transparent",
                color: triggering ? C.textMute : C.gold,
                fontSize: 12, cursor: triggering ? "not-allowed" : "pointer", fontFamily: "monospace",
                transition: "all 0.15s",
              }}>
                {triggering ? "⏳ Polling..." : "⚡ Poll Now"}
              </button>
            </div>
          </div>
        </div>

        <div style={{ maxWidth: 1300, margin: "0 auto", padding: "24px 32px" }}>
          {!serverOnline && !appLoading && (
            <div style={{ background: "#1a0810", border: "1px solid #ef444433", borderRadius: 10, padding: "16px 20px", marginBottom: 20 }}>
              <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 18, color: "#ef4444", letterSpacing: 1, marginBottom: 6 }}>⚠ SERVER NOT RUNNING</div>
              <div style={{ fontSize: 13, color: C.textSub, lineHeight: 1.7 }}>
                Start the backend:<br/>
                <code style={{ fontFamily: "monospace", color: C.gold }}>cd server && npm install && cp .env.example .env && node index.js</code>
              </div>
            </div>
          )}

          {/* ── Tabs ── */}
          <div style={{ display: "flex", gap: 4, marginBottom: 24, background: C.surface, borderRadius: 10, padding: 4, border: `1px solid ${C.border}`, width: "fit-content" }}>
            {[
              { id: "live",      label: "📡 Live Feed" },
              { id: "truth",     label: "📣 Truth Social" },
              { id: "digest",    label: "📈 Daily Digest" },
              { id: "signals",   label: "📊 Signal Board" },
              { id: "companies", label: "🏢 Companies" },
              { id: "manual",    label: "📝 Manual Scan" },
            ].map(t => <Tab key={t.id} {...t} active={activeTab === t.id} onClick={setActiveTab} />)}
          </div>

          {/* ── LIVE FEED ── */}
          {activeTab === "live" && (
            <div className="fadein">
              <div style={{ fontSize: 11, color: C.textMute, fontFamily: "monospace", letterSpacing: 1, marginBottom: 16 }}>
                {(appearances || []).length} APPEARANCES TRACKED · AUTO-REFRESHES EVERY 20s
                {status?.lastPoll && <> · LAST POLL: {new Date(status.lastPoll).toLocaleTimeString()}</>}
              </div>
              {appLoading && <div style={{ color: C.textMute, fontFamily: "monospace", fontSize: 13 }}>Loading appearances...</div>}
              {(appearances || []).map(a => <AppearanceCard key={a.id} appearance={a} />)}
              {!appLoading && (appearances || []).length === 0 && (
                <div style={{ color: C.textMute, textAlign: "center", padding: "60px 0" }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>📡</div>
                  <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 20, letterSpacing: 2 }}>WAITING FOR TRANSCRIPTS</div>
                </div>
              )}
            </div>
          )}

          {/* ── TRUTH SOCIAL ── */}
          {activeTab === "truth" && (
            <div className="fadein">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: C.textMute, fontFamily: "monospace", letterSpacing: 1 }}>
                  {truthPosts.length} POSTS FETCHED · AUTO-REFRESHES EVERY 60s · @realDonaldTrump
                </div>
                <button onClick={fetchTruthPosts} disabled={truthLoading} style={{
                  padding: "6px 14px", borderRadius: 6, border: `1px solid ${C.gold}`,
                  background: "transparent", color: truthLoading ? C.textMute : C.gold,
                  fontSize: 12, cursor: truthLoading ? "not-allowed" : "pointer", fontFamily: "monospace",
                }}>
                  {truthLoading ? "⏳ Loading..." : "🔄 Refresh"}
                </button>
              </div>
              {truthLoading && <div style={{ color: C.textMute, fontFamily: "monospace", fontSize: 13 }}>Fetching Truth Social posts...</div>}
              {truthError && (
                <div style={{ background: "#1a0810", border: "1px solid #ef444433", borderRadius: 10, padding: "16px 20px", marginBottom: 20 }}>
                  <div style={{ fontSize: 13, color: "#ef4444", fontFamily: "monospace" }}>⚠ Could not load Truth Social: {truthError}</div>
                  <div style={{ fontSize: 12, color: C.textMute, marginTop: 6 }}>Truth Social may be blocking this request. Try refreshing.</div>
                </div>
              )}
              {truthPosts.length === 0 && !truthLoading && !truthError && (
                <div style={{ color: C.textMute, textAlign: "center", padding: "60px 0" }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>📣</div>
                  <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 20, letterSpacing: 2 }}>NO POSTS YET</div>
                </div>
              )}
              {truthPosts.map(post => <TruthPostCard key={post.id} post={post} />)}
            </div>
          )}

          {/* ── DAILY DIGEST ── */}
          {activeTab === "digest" && (
            <div className="fadein">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <div>
                  <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 22, letterSpacing: 2, color: C.text }}>DAILY STOCK DIGEST</div>
                  <div style={{ fontSize: 11, color: C.textMute, fontFamily: "monospace", marginTop: 4 }}>
                    Companies Trump has mentioned · First-mention price vs current price · Yahoo Finance data
                    {digestData?.generatedAt && <> · Updated {new Date(digestData.generatedAt).toLocaleTimeString()}</>}
                  </div>
                </div>
                <button onClick={loadDigest} disabled={digestLoading} style={{
                  padding: "8px 18px", borderRadius: 7, border: `1px solid ${C.gold}`,
                  background: "transparent", color: digestLoading ? C.textMute : C.gold,
                  fontSize: 12, cursor: digestLoading ? "not-allowed" : "pointer", fontFamily: "monospace",
                }}>
                  {digestLoading ? "⏳ Refreshing..." : "🔄 Refresh Prices"}
                </button>
              </div>

              {digestLoading && (
                <div style={{ color: C.textMute, fontFamily: "monospace", fontSize: 13, padding: "40px 0", textAlign: "center" }}>
                  Fetching live prices from Yahoo Finance...
                </div>
              )}

              {digestData?.error && (
                <div style={{ color: "#ef4444", fontFamily: "monospace", fontSize: 13 }}>Error: {digestData.error}</div>
              )}

              {digestData?.entries && digestData.entries.length === 0 && (
                <div style={{ color: C.textMute, textAlign: "center", padding: "60px 0" }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>📈</div>
                  <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 18, letterSpacing: 2 }}>NO COMPANY MENTIONS YET</div>
                  <div style={{ fontSize: 12, marginTop: 6 }}>Prices will appear here once Trump mentions companies in scanned speeches</div>
                </div>
              )}

              {digestData?.entries && digestData.entries.length > 0 && (
                <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
                  <div style={{
                    display: "grid", gridTemplateColumns: "36px 140px 80px 120px 120px 130px 1fr",
                    gap: 0, padding: "10px 20px", background: C.bg, borderBottom: `1px solid ${C.border}`,
                  }}>
                    {["#", "COMPANY", "FIRST SEEN", "PRICE THEN", "PRICE NOW", "CHANGE", "SPEECH"].map((h, i) => (
                      <div key={i} style={{ fontSize: 10, color: C.textMute, fontFamily: "monospace", letterSpacing: 1.5, paddingLeft: i === 6 ? 12 : 0 }}>{h}</div>
                    ))}
                  </div>
                  {digestData.entries.map((entry, i) => (
                    <DigestRow key={entry.company} entry={entry} rank={i + 1} />
                  ))}
                  <div style={{ padding: "12px 20px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 20, alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ color: "#00e87a", fontSize: 12, fontFamily: "monospace" }}>▲ GREEN</span>
                      <span style={{ fontSize: 11, color: C.textMute }}>= stock up since Trump first mentioned it</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ color: "#ef4444", fontSize: 12, fontFamily: "monospace" }}>▼ RED</span>
                      <span style={{ fontSize: 11, color: C.textMute }}>= stock down since first mention</span>
                    </div>
                    <div style={{ fontSize: 11, color: C.textFaint, marginLeft: "auto" }}>
                      Prices delayed 15–20 min · Not financial advice
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── SIGNAL BOARD ── */}
          {activeTab === "signals" && (
            <div className="fadein">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 24 }}>
                <div>
                  <SectionHead color="#00e87a">🚀 BUY SIGNALS</SectionHead>
                  {buySignals.length === 0 && <Empty>No buy signals detected yet</Empty>}
                  {buySignals.map((s, i) => <SignalRow key={i} signal={s} />)}
                </div>
                <div>
                  <SectionHead color="#ef4444">🚫 AVOID SIGNALS</SectionHead>
                  {avoidSignals.length === 0 && <Empty>No avoid signals detected yet</Empty>}
                  {avoidSignals.map((s, i) => <SignalRow key={i} signal={s} />)}
                </div>
              </div>
              <div>
                <SectionHead color={C.gold}>✦ ALL SIGNALS</SectionHead>
                {(signals || []).length === 0 && <Empty>No signals detected yet</Empty>}
                {(signals || []).map((s, i) => <SignalRow key={i} signal={s} />)}
              </div>
            </div>
          )}

          {/* ── COMPANIES ── */}
          {activeTab === "companies" && (
            <div className="fadein">
              <SectionHead color={C.gold}>🏢 COMPANY LEADERBOARD — Cumulative Signal Score</SectionHead>
              {(companies || []).length === 0 && <Empty>No company data yet</Empty>}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 12, marginTop: 16 }}>
                {(companies || []).map((c, i) => {
                  const cfg = SENTIMENT_CFG[c.latestSentiment] || SENTIMENT_CFG.NEUTRAL;
                  return (
                    <div key={i} style={{ background: C.surface, border: `1px solid ${cfg.color}33`, borderLeft: `3px solid ${cfg.color}`, borderRadius: 10, padding: "14px 16px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <span style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 18, color: C.text, letterSpacing: 1 }}>{c.company}</span>
                        <span style={{ color: cfg.color, fontFamily: "monospace", fontSize: 16, fontWeight: 700 }}>{c.totalScore > 0 ? "+" : ""}{c.totalScore}</span>
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <Badge sentiment={c.latestSentiment} />
                        <span style={{ fontSize: 11, color: C.textMute, fontFamily: "monospace" }}>{c.signalCount} signal{c.signalCount !== 1 ? "s" : ""}</span>
                      </div>
                      <div style={{ fontSize: 11, color: C.textFaint, marginTop: 6, fontFamily: "monospace" }}>
                        {c.appearances.slice(0, 2).join(" · ")}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── MANUAL SCAN ── */}
          {activeTab === "manual" && (
            <div className="fadein" style={{ maxWidth: 800 }}>
              <div style={{ fontSize: 13, color: C.textSub, lineHeight: 1.7, marginBottom: 20 }}>
                Paste any Trump transcript directly. The server scans it, adds it to the tracker, and records the stock price at time of mention for the Daily Digest.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <Field label="TITLE" value={manualTitle} onChange={setManualTitle} placeholder="e.g. Rally in Phoenix" />
                <Field label="DATE" value={manualDate} onChange={setManualDate} type="date" />
              </div>
              <textarea
                value={manualText}
                onChange={e => setManualText(e.target.value)}
                placeholder="Paste transcript text here..."
                style={{ width: "100%", minHeight: 220, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, color: C.text, fontSize: 14, outline: "none", resize: "vertical", lineHeight: 1.7, marginBottom: 12 }}
              />
              <button onClick={submitManualScan} disabled={scanning || !manualText.trim()} style={{
                width: "100%", padding: 15, borderRadius: 10, border: "none",
                background: scanning || !manualText.trim() ? C.raised : `linear-gradient(135deg,${C.gold},#8a6e10,${C.gold})`,
                color: scanning || !manualText.trim() ? C.textMute : "#06111f",
                fontSize: 14, fontFamily: "'Bebas Neue',sans-serif", letterSpacing: 3,
                cursor: scanning || !manualText.trim() ? "not-allowed" : "pointer",
                boxShadow: scanning || !manualText.trim() ? "none" : `0 0 20px ${C.gold}44`,
              }}>
                {scanning ? "⚡ SCANNING..." : "🔍 SCAN FOR SIGNALS"}
              </button>
              {scanResult && !scanResult.error && (
                <div style={{ marginTop: 20 }}>
                  <AppearanceCard appearance={scanResult} />
                  {scanResult.hasSignals && (
                    <div style={{ marginTop: 10, fontSize: 12, color: C.gold, fontFamily: "monospace" }}>
                      ✦ Stock prices recorded — check the Daily Digest tab
                    </div>
                  )}
                </div>
              )}
              {scanResult?.error && (
                <div style={{ marginTop: 12, color: "#ef4444", fontSize: 13, fontFamily: "monospace" }}>Error: {scanResult.error}</div>
              )}
            </div>
          )}
        </div>

        <div style={{ borderTop: `1px solid ${C.border}`, padding: "14px 32px", marginTop: 20 }}>
          <div style={{ maxWidth: 1300, margin: "0 auto", display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: 10, color: C.textFaint, fontFamily: "monospace" }}>FOR INFORMATIONAL USE ONLY · NOT FINANCIAL ADVICE</span>
            <span style={{ fontSize: 10, color: C.textFaint, fontFamily: "monospace" }}>Created by Dominic Molinar</span>
          </div>
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 22, color }}>{value ?? "–"}</div>
      <div style={{ fontSize: 10, color: C.textMute, letterSpacing: 1, fontFamily: "monospace" }}>{label}</div>
    </div>
  );
}

function SectionHead({ color, children }) {
  return <div style={{ fontSize: 11, color, letterSpacing: 2, fontFamily: "monospace", marginBottom: 12 }}>{children}</div>;
}

function Empty({ children }) {
  return <div style={{ color: C.textFaint, fontSize: 13, fontFamily: "monospace", padding: "20px 0" }}>{children}</div>;
}

function SignalRow({ signal }) {
  const cfg = SENTIMENT_CFG[signal.sentiment] || SENTIMENT_CFG.NEUTRAL;
  return (
    <div style={{ background: C.surface, border: `1px solid ${cfg.color}22`, borderLeft: `3px solid ${cfg.color}`, borderRadius: 8, padding: "10px 14px", marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <span style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 17, color: C.text, letterSpacing: 1 }}>{signal.company}</span>
          <div style={{ fontSize: 10, color: C.textMute, fontFamily: "monospace", marginTop: 2 }}>{signal.date} · {signal.appearanceTitle}</div>
        </div>
        <span style={{ color: cfg.color, fontFamily: "monospace", fontSize: 14, fontWeight: 700 }}>{signal.score > 0 ? "+" : ""}{signal.score}</span>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <div>
      <label style={{ fontSize: 11, color: C.textSub, letterSpacing: 1, fontFamily: "monospace", display: "block", marginBottom: 6 }}>{label}</label>
      <input
        type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ width: "100%", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", color: C.text, fontSize: 14, outline: "none" }}
      />
    </div>
  );
}
