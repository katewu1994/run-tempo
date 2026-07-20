# GPT-5.6 Terra Planner Backend

Run Tempo can use a small Express backend to ask GPT-5.6 Terra to rank tracks for each running segment. The browser still analyzes audio locally and builds the final `ExecutableMixPlan` deterministically.

## Data Flow

- Audio files stay in the browser.
- The frontend sends extracted track metadata, BPM candidates, running segments, top candidate scores, and planner rules to the backend.
- The backend sends a minimized prompt to GPT-5.6 Terra with segment data and candidate metadata only.
- GPT-5.6 Terra returns ranked track selections, BPM interpretation choices, metronome preferences, and reasons.
- The frontend calculates stretch ratio, source timestamps, mix timestamps, block durations, and transitions.

## Backend Local Development

Create `backend/.env` for local development:

```bash
OPENAI_API_KEY=your_local_key
OPENAI_MODEL=gpt-5.6-terra
PORT=8080
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
```

In non-production mode, loopback frontend origins such as `localhost`,
`127.0.0.1`, and `[::1]` are accepted on any port. This keeps Vite fallback
ports like `5174` from failing CORS during local development.

Run the backend:

```bash
cd backend
npm install
npm run dev
```

Health check:

```bash
curl http://localhost:8080/health
```

Planner endpoint:

```text
POST http://localhost:8080/api/openai/mix-plan
```

## Frontend Local Development

Run the frontend against the backend:

```bash
VITE_PLANNER_API_BASE_URL=http://localhost:8080 npm run dev
```

In development, the frontend uses `http://localhost:8080` by default when `VITE_PLANNER_API_BASE_URL` is not set, matching the backend started by `npm run dev`. In production, leave the variable unset only when the frontend and backend share the same origin for `/api/openai/mix-plan`.

## Environment Variables

Backend:

- `OPENAI_API_KEY`: required when `/api/openai/mix-plan` calls GPT-5.6 Terra.
- `OPENAI_MODEL`: optional, defaults to `gpt-5.6-terra`.
- `PORT`: optional, defaults to `8080`.
- `ALLOWED_ORIGINS`: comma-separated frontend origins for CORS.

Frontend:

- `VITE_PLANNER_API_BASE_URL`: backend origin, for example `https://run-tempo-planner-xxxxx.a.run.app`.

Do not put `OPENAI_API_KEY` in frontend environment variables.

## Cloud Run Deployment

### Single-Service Deployment

Deploying from the repository root builds one Cloud Run service that serves both
the Vite frontend and the Express GPT-5.6 Terra planner backend. This is the simplest
production setup because the frontend can keep using the same-origin endpoint
`/api/openai/mix-plan`.

Create a Secret Manager secret for the OpenAI API key, then deploy from the
repository root:

```bash
gcloud run deploy run-tempo \
  --source . \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --set-env-vars OPENAI_MODEL=gpt-5.6-terra \
  --set-secrets OPENAI_API_KEY=<secret-name>:latest
```

The root `Dockerfile` sets `STATIC_ASSETS_DIR=/app/public`, so the backend serves
the compiled frontend and the planner API from the same origin. In this mode,
`VITE_PLANNER_API_BASE_URL` can remain unset.

### Split Frontend and Backend Deployment

Create a Secret Manager secret for the OpenAI API key, then deploy from the repository root:

```bash
gcloud run deploy run-tempo-planner \
  --source backend \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --set-env-vars OPENAI_MODEL=gpt-5.6-terra,ALLOWED_ORIGINS=<frontend-url> \
  --set-secrets OPENAI_API_KEY=<secret-name>:latest
```

Adjust the region, service name, and frontend URL for your project. After
deployment, set the frontend build environment before building the frontend:

```bash
VITE_PLANNER_API_BASE_URL=<cloud-run-service-url> npm run build
```

If the frontend is built in Docker, pass the backend URL as a build argument:

```bash
docker build \
  --build-arg VITE_PLANNER_API_BASE_URL=<cloud-run-service-url> \
  -t run-tempo .
```

If the production UI still shows `same-origin /api/openai/mix-plan` and the
planner request returns `405`, the frontend was built without
`VITE_PLANNER_API_BASE_URL` and is sending the POST request to a static frontend
service instead of the planner backend.

## Validation

The backend validates incoming planner requests with zod. GPT-5.6 Terra output is also validated and repaired deterministically where possible:

- missing segment plans are filled from top candidates
- unknown track IDs are removed
- selections are limited to `rules.maxTracksPerSegment`
- mismatched BPM interpretations are corrected to the candidate score interpretation
- over-stretch selections are replaced by within-budget candidates when the segment has any candidate inside `maxStretchPercent`
- invalid JSON or unrecoverable output returns `502`

GPT-5.6 Terra must not calculate stretch ratio, exact block durations, source timestamps, or mix timestamps.
