/**
 * MIDAS — Live audio capture
 * Pipes the live stream's audio through ffmpeg, segmenting it into
 * 45-second mono 16 kHz WAV chunks (Whisper's preferred input format).
 * Each completed chunk is handed to the transcriber.
 *
 * yt-dlp -f bestaudio -o -  ──▶  ffmpeg segmenter  ──▶  chunk_0000.wav, chunk_0001.wav, ...
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const CHUNK_SECONDS = 45;

function startCapture(stream, { onChunk, onEnded }) {
  const dir = path.join(__dirname, "..", "tmp", stream.id.replace(/[^a-zA-Z0-9_-]/g, "_"));
  fs.mkdirSync(dir, { recursive: true });

  const ytdlp = spawn("yt-dlp", [
    "-q", "--no-warnings",
    "-f", "bestaudio/best",
    "-o", "-",
    stream.url,
  ]);

  const ffmpeg = spawn("ffmpeg", [
    "-loglevel", "error",
    "-i", "pipe:0",
    "-ac", "1",
    "-ar", "16000",
    "-f", "segment",
    "-segment_time", String(CHUNK_SECONDS),
    "-reset_timestamps", "1",
    path.join(dir, "chunk_%05d.wav"),
  ]);

  ytdlp.stdout.pipe(ffmpeg.stdin);
  ytdlp.stderr.on("data", (d) => console.error(`[capture:yt-dlp] ${d}`.trim()));
  ffmpeg.stderr.on("data", (d) => console.error(`[capture:ffmpeg] ${d}`.trim()));

  // A chunk is complete once the NEXT chunk file appears (ffmpeg writes
  // sequentially), or when the stream ends (flush whatever remains).
  let handled = new Set();
  const poller = setInterval(() => {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".wav")).sort();
    // All files except the newest are complete.
    for (const f of files.slice(0, -1)) {
      if (!handled.has(f)) {
        handled.add(f);
        onChunk(path.join(dir, f), stream);
      }
    }
  }, 5000);

  function cleanup() {
    clearInterval(poller);
    // Flush the final chunk.
    try {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".wav")).sort();
      for (const f of files) {
        if (!handled.has(f)) {
          handled.add(f);
          onChunk(path.join(dir, f), stream);
        }
      }
    } catch (_) {}
    console.log(`[capture] stream ended: ${stream.title}`);
    onEnded();
  }

  ffmpeg.on("close", cleanup);
  ytdlp.on("error", (err) => console.error(`[capture] yt-dlp error: ${err.message}`));
  ffmpeg.on("error", (err) => console.error(`[capture] ffmpeg error: ${err.message}`));

  return {
    stop: () => {
      ytdlp.kill("SIGTERM");
      ffmpeg.stdin.end();
    },
    dir,
  };
}

module.exports = { startCapture, CHUNK_SECONDS };
