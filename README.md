RunTempo 🏃🎵
AI-assisted running mix builder that syncs your music to your stride.
Turn your local music into cadence-matched workout mixes — privacy-first, fully inspectable, deterministically rendered.
⚡ The Problem
Runners perform best when music tempo matches their cadence. But building a cadence-aligned playlist today is manual, imprecise, and requires uploading your entire music library to some cloud service.
🎯 What It Does
Single-track mode
Load a local audio file or import an authorized track from YouTube
Detect a song's BPM instantly
Set your target cadence → auto time-stretch + beat-align
30-sec preview → export WAV
Multi-track mode
Upload multiple tracks → GPT ranks candidates and maps songs to workout segments
Browser converts the plan into exact timestamps, tempo adjustments, and beat alignment
Inspect every decision: candidate scores, BPM interpretations, stretch ratios, timestamps — before rendering
Local files never leave your device. YouTube links are fetched by the backend, then all analysis and rendering happens in the browser.
🧠 Key Insight: AI for taste, math for precision
We deliberately don't let AI touch timing or rendering. AI proposes; the deterministic Web Audio engine executes and verifies. Result: explainable + reproducible, never opaque.
🏆 What Makes It Stand Out
RunTempo
Not just a playlist
An executable, inspectable audio plan
Privacy
Local-first — raw files stay on-device
Transparency
Every AI score & selection is visible
Reliability
Deterministic rendering, not AI-generated audio
🛠️ How We Built It
Browser-based audio pipeline on the Web Audio API (decode, preview, mix, time-stretch, WAV export).
GPT (via API) handles the creative layer — ranking tracks and proposing segment mixes, returning structured JSON. The browser turns that proposal into a deterministic plan and renders everything locally.
🧗 Hardest Problems Solved
Beat drift: technically-close tempo math can still sound wrong — we tuned for perceived sync, not just numbers
AI creativity vs. verifiable output: made AI recommendations inspectable, kept audio math deterministic
Privacy under constraint: full decode → render → export, all in-browser
🚀 What's Next
Sharper beat detection & smoother transitions
More workout types & cadence profiles
Energy-progression control across a session
Personalized mixes from goals + past-run feedback — always keeping users in control of their music and data

## YouTube import runtime

The production Docker images install `yt-dlp` and `ffmpeg` automatically. For local development, run `npm run setup:youtube` once; the backend automatically finds the project-local environment. You can also set `YT_DLP_PATH` to an explicit `yt-dlp` executable path.
