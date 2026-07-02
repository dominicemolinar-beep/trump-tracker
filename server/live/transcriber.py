#!/usr/bin/env python3
"""
MIDAS — Transcription worker

Long-running process. Reads one WAV file path per line on stdin,
transcribes it with faster-whisper (local, free, no API key), and
prints one JSON object per line on stdout:

    {"path": "...", "text": "...", "seconds": 4.2}

Model notes:
  - "small" is the sweet spot on CPU: transcribes a 45s chunk in well
    under 45s on any modern machine, so the pipeline keeps up in real time.
  - Set MIDAS_WHISPER_MODEL=medium for better accuracy if you have the
    horsepower, or "base" on a weak machine.

Install:  pip install faster-whisper
"""

import json
import os
import sys
import time

from faster_whisper import WhisperModel

MODEL_NAME = os.environ.get("MIDAS_WHISPER_MODEL", "small")

def log(msg):
    print(f"[transcriber] {msg}", file=sys.stderr, flush=True)

log(f"loading model '{MODEL_NAME}' (first run downloads it)...")
model = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8")
log("model ready")

for line in sys.stdin:
    path = line.strip()
    if not path:
        continue
    started = time.time()
    try:
        segments, _info = model.transcribe(path, language="en", vad_filter=True)
        text = " ".join(seg.text.strip() for seg in segments).strip()
        out = {"path": path, "text": text, "seconds": round(time.time() - started, 1)}
    except Exception as exc:  # noqa: BLE001
        out = {"path": path, "text": "", "error": str(exc)}
    print(json.dumps(out), flush=True)
    # Chunk is transcribed; remove it to keep disk usage flat.
    try:
        os.remove(path)
    except OSError:
        pass
