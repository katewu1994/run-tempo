<div align="center">
  <img src="./public/runtempo-mark.svg" width="88" height="88" alt="RunTempo logo" />
  <h1>RunTempo</h1>
  <p><strong>Run in rhythm.</strong> <strong>Move with purpose.</strong></p>
  <p>Turn the music you love into a cadence-matched running mix, with a precision click that keeps every stride on beat.</p>
  <p>Local-first audio analysis, AI-assisted track arrangement, and deterministic in-browser rendering.</p>
</div>

## Overview

RunTempo is a browser-based cadence studio for runners. It analyzes music, matches it to a target step rate, adds a synchronized click track, and exports a playable WAV file.

The application separates creative decisions from exact audio processing:

- GPT ranks tracks and proposes an arrangement from extracted metadata.
- Deterministic browser code calculates timing, tempo changes, beat alignment, transitions, and the final audio render.
- Local audio files remain on the device throughout analysis and rendering.

If the OpenAI API is unavailable, multi-track planning automatically falls back to a deterministic local planner.

## Features

### Single-track mode

- Load MP3, WAV, M4A, or AAC files from the device.
- Import authorized audio from supported YouTube links through the backend.
- Analyze tempo with Essentia and TempoCNN-based detection.
- Compare BPM interpretations and choose the click-to-beat relationship.
- Match a target running cadence with tempo adjustment and automatic beat alignment.
- Configure click style, accent interval, click volume, and overall output level.
- Preview a 30-second mix before export.
- Export WAV files with title, artist, album, RunTempo metadata, and optional artwork.
- Match cover art through MusicBrainz and Cover Art Archive, upload an image, or generate a local template.

### Multi-track mode

- Import an entire music folder, including supported files in subfolders.
- Analyze BPM, energy, musical key, mood, energy structure, and embedded click patterns locally.
- Recognize WAV files previously exported by RunTempo as cadence-locked source tracks.
- Build constant, progressive, interval, or custom running plans up to 60 minutes.
- Review cadence coverage before generating a mix.
- Ask GPT to rank tracks for each workout segment using metadata and precomputed candidate scores.
- Fall back to a deterministic local planner when GPT is unavailable.
- Compare balanced, energy-focused, and variety-focused plan variants.
- Reorder selected tracks before rendering.
- Render transitions, tempo changes, cadence clicks, metadata, and cover art into a final WAV file.

## How it works

1. The browser decodes and analyzes the selected audio.
2. RunTempo builds BPM interpretations and scores compatible tracks for each workout segment.
3. For multi-track plans, the backend sends only extracted metadata and candidate scores to the OpenAI Responses API. Audio data is never included.
4. The backend validates the structured response and removes invalid selections.
5. The browser converts the selection into an executable mix plan with exact source ranges, timing, stretch decisions, beat offsets, and crossfades.
6. Web Audio renders the final mix locally and the browser exports it as WAV.

## Tech stack

| Area | Technologies | Responsibility |
| --- | --- | --- |
| Frontend | React 18, TypeScript, Vite, CSS, Lucide React | Workflow, local files, previews, planning UI, and export |
| Audio engine | Web Audio API, Web Workers | Decoding, synchronization, preview, mixing, and WAV rendering |
| Audio intelligence | Essentia.js, TensorFlow.js, TempoCNN, MusiCNN | BPM, mood, energy, musical key, and click detection |
| Planning engine | TypeScript | Candidate scoring, coverage checks, plan variants, and executable timing |
| Backend | Node.js, Express, Zod | API orchestration, validation, CORS, and production static hosting |
| AI arrangement | OpenAI Responses API | Metadata-only track ranking and selection rationale |
| Media and artwork | yt-dlp, FFmpeg, MusicBrainz, Cover Art Archive | Authorized audio import, conversion, and cover lookup |
| Deployment | Vercel | Vite builds, preview deployments, and production frontend hosting |

## Getting started

### Prerequisites

- Node.js 20 or newer; Node.js 22 is recommended.
- npm.
- A modern desktop browser with Web Audio, Web Workers, and File System directory input support.
- An OpenAI API key for GPT-assisted arrangement.
- Python 3 and FFmpeg only if YouTube import is required locally.

### Install

```bash
npm install
npm --prefix backend install
```

### Configure GPT-assisted planning

Create `backend/.env`:

```dotenv
OPENAI_API_KEY=your_api_key
OPENAI_MODEL=gpt-5.6-terra
PORT=8080
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
```

The API key is optional for local development. Without it, the application reports GPT as unavailable and uses the local planner for multi-track arrangements.

Never expose `OPENAI_API_KEY` through a Vite environment variable or frontend code.

### Configure YouTube import

Install the project-local yt-dlp runtime:

```bash
npm run setup:youtube
```

FFmpeg must also be available on `PATH`. Only import audio that you own or are authorized to use.

### Start development servers

```bash
npm run dev
```

The default development URLs are:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8080`

The frontend automatically uses the local backend during Vite development.

## Configuration

### Backend environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | For GPT planning | None | Server-side OpenAI API key |
| `OPENAI_MODEL` | No | `gpt-5.6-terra` | Model used for track arrangement |
| `OPENAI_BASE_URL` | No | `https://api.openai.com/v1/responses` | Complete Responses API endpoint |
| `PORT` | No | `8080` | Express server port |
| `ALLOWED_ORIGINS` | No | Local development origins | Comma-separated CORS allowlist; `*` allows every origin |
| `STATIC_ASSETS_DIR` | No | Disabled | Directory served as the production frontend |
| `YT_DLP_PATH` | No | Auto-detected | Explicit path to the yt-dlp executable |
| `MUSICBRAINZ_USER_AGENT` | No | RunTempo default | User-Agent sent to MusicBrainz |

### Frontend build variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `VITE_PLANNER_API_BASE_URL` | No | `http://localhost:8080` in development; same origin in production | Backend origin used by planner requests |

## Available scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the frontend and backend together |
| `npm run dev:frontend` | Start Vite only |
| `npm run dev:backend` | Start the Express backend only |
| `npm run setup:youtube` | Install yt-dlp in `backend/.venv` |
| `npm run build` | Type-check and build the frontend |
| `npm run test:bpm` | Run BPM and cadence logic tests |
| `npm run test:export` | Run WAV export and metadata tests |
| `npm run test:multi` | Run multi-track planning and rendering tests |
| `npm run test:backend` | Run backend OpenAI response and connection tests |
| `npm run preview` | Preview the production frontend build |
| `npm --prefix backend run build` | Compile the backend |
| `npm --prefix backend start` | Start the compiled backend |

## API endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Service and configured model information |
| `GET` | `/api/openai/status` | Check whether the configured OpenAI model is accessible |
| `POST` | `/api/openai/mix-plan` | Generate and validate a metadata-only track selection plan |
| `POST` | `/api/youtube/import` | Import authorized YouTube audio as MP3 |
| `GET` | `/api/cover-art/lookup` | Search for release-group artwork candidates |
| `GET` | `/api/cover-art/image/:releaseGroupId` | Proxy a validated cover image |

## Privacy and data boundaries

- Local audio files are decoded, analyzed, previewed, mixed, and exported in the browser.
- GPT planning receives filenames, extracted audio features, candidate scores, workout segments, and planner rules. It does not receive audio samples or files.
- YouTube import sends the supplied URL to the backend; the backend returns a temporary MP3 and removes its working directory after transfer.
- Cover matching sends the entered artist and album to MusicBrainz. Selected images are fetched through the backend.
- Exported files are generated locally and are not uploaded by RunTempo.

## Testing

Run the complete verification suite:

```bash
npm run build
npm --prefix backend run build
npm run test:backend
npm run test:bpm
npm run test:export
npm run test:multi
```

The tests cover BPM interpretation, detector agreement, cadence relationships, click detection, locked-click safety, plan variants, repeat gaps, WAV chunks, embedded metadata, artwork, and OpenAI response parsing.

## Vercel deployment

Import the repository into Vercel as a Vite project with the repository root as the project root. Use the following build settings:

| Setting | Value |
| --- | --- |
| Framework preset | Vite |
| Install command | `npm install` |
| Build command | `npm run build` |
| Output directory | `dist` |

The frontend can analyze, plan, render, and export local audio in the browser. If the planner backend is unavailable, multi-track arrangement falls back to the deterministic local planner.

To enable GPT-assisted arrangement, YouTube import, and cover-art proxying in production, deploy the Express backend separately and set `VITE_PLANNER_API_BASE_URL` in the Vercel project to its public origin. Configure the backend's `ALLOWED_ORIGINS` with the Vercel production domain. Keep `OPENAI_API_KEY` on the backend only.

## Project structure

```text
.
├── backend/                 Express APIs and OpenAI integration
├── public/models/           Browser audio-analysis model assets
├── scripts/                 Test runners and build-time helpers
├── src/audio/               Analysis, synchronization, mixing, and WAV export
├── src/components/          React workflow and editor components
├── src/domain/              Running-plan and shared domain models
├── src/planning/            Candidate scoring and mix-plan construction
├── src/utils/               Download, formatting, and export utilities
├── tests/                   Frontend audio and planning tests
└── Dockerfile               Optional self-hosted production image
```

## Current limitations

- Audio export is WAV only.
- Simple tempo stretching may change pitch.
- Confirmed embedded-click tracks are limited to a 5% tempo adjustment.
- Raw tracks requiring more than 15% adjustment are allowed but marked as risky.
- Multi-track plans are capped at 60 minutes.
- Large audio libraries are limited by browser memory and decoding performance.
- YouTube availability depends on the source video, yt-dlp, FFmpeg, and the server environment.

## Additional documentation

- [`docs/technical-spec-v0.1.md`](./docs/technical-spec-v0.1.md) — initial technical specification
- [`docs/pitch-script.md`](./docs/pitch-script.md) — product pitch

## License

RunTempo's original source code is available under the [MIT License](./LICENSE).

The model assets under `public/models/` are not covered by the MIT License. They remain subject to their respective AGPL-3.0 and CC BY-NC-SA 4.0 terms. See [Third-Party Notices](./THIRD_PARTY_NOTICES.md) for details.
