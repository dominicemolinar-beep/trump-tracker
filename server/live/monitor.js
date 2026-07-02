/**
 * MIDAS — Live stream monitor
 * Every 2 minutes, checks configured channels for an active live stream
 * whose title matches the keyword filter (default: "trump"). When one is
 * found, hands the stream URL to the capture pipeline. When it ends,
 * capture shuts down automatically.
 *
 * Detection uses yt-dlp's metadata mode (no download) against each
 * channel's /live endpoint, so it works for YouTube channels and most
 * other sites yt-dlp supports. You can also force a stream manually via
 * POST /api/live/start { url } from the dashboard.
 */

const { execFile } = require("child_process");

const CHANNELS = [
  // YouTube /live endpoints resolve to the channel's current live stream, if any.
  "https://www.youtube.com/@WhiteHouse/live",
  "https://www.youtube.com/@FoxNews/live",
  "https://www.youtube.com/@NewsmaxTV/live",
  "https://www.youtube.com/@cspan/live",
  "https://www.youtube.com/@ForbesBreakingNews/live",
];

const KEYWORDS = (process.env.MIDAS_KEYWORDS || "trump")
  .split(",")
  .map((k) => k.trim().toLowerCase())
  .filter(Boolean);

function probe(url) {
  return new Promise((resolve) => {
    execFile(
      "yt-dlp",
      ["--no-warnings", "--print", "%(id)s\t%(title)s\t%(is_live)s", "--playlist-items", "1", url],
      { timeout: 30000 },
      (err, stdout) => {
        if (err || !stdout) return resolve(null);
        const [id, title, isLive] = stdout.trim().split("\t");
        resolve({ id, title, isLive: isLive === "True", url });
      }
    );
  });
}

function startMonitor({ onStreamLive }, intervalMs = 2 * 60 * 1000) {
  const active = new Set(); // stream IDs already being captured

  async function scan() {
    for (const channel of CHANNELS) {
      const info = await probe(channel);
      if (!info || !info.isLive || active.has(info.id)) continue;
      const titleLower = (info.title || "").toLowerCase();
      const match = KEYWORDS.some((k) => titleLower.includes(k));
      if (!match) continue;

      active.add(info.id);
      console.log(`[monitor] LIVE match: "${info.title}" (${info.id})`);
      onStreamLive({
        id: info.id,
        title: info.title,
        url: channel,
        onEnded: () => active.delete(info.id),
      });
    }
  }

  scan();
  const timer = setInterval(scan, intervalMs);
  return {
    stop: () => clearInterval(timer),
    // Manual start from the dashboard: bypasses keyword filter.
    forceStart: async (url) => {
      const info = await probe(url);
      const id = info?.id || `manual-${Date.now()}`;
      if (active.has(id)) return { started: false, reason: "already capturing" };
      active.add(id);
      onStreamLive({
        id,
        title: info?.title || url,
        url,
        onEnded: () => active.delete(id),
      });
      return { started: true, id, title: info?.title || url };
    },
  };
}

module.exports = { startMonitor, CHANNELS };
