# GPT planner and Google Cloud Run

RunTempo uses an Express backend to ask the configured OpenAI model to rank tracks for each running segment. The browser still analyzes audio locally and builds the final `ExecutableMixPlan` deterministically.

## Data flow

- Audio files stay in the browser.
- The frontend sends extracted track metadata, BPM candidates, running segments, top candidate scores, and planner rules to the backend.
- The backend sends a minimized prompt containing segment and candidate metadata only.
- The model returns ranked track selections, BPM interpretation choices, metronome preferences, and reasons.
- The frontend calculates stretch ratios, source timestamps, mix timestamps, block durations, and transitions.

## Environment variables

Backend:

- `OPENAI_API_KEY`: required for GPT-assisted planning.
- `OPENAI_MODEL`: optional; defaults to `gpt-5.6-terra`.
- `OPENAI_BASE_URL`: optional complete Responses API endpoint.
- `PORT`: optional; defaults to `8080`. Cloud Run supplies this value.
- `ALLOWED_ORIGINS`: comma-separated frontend origins used only for a split deployment.
- `STATIC_ASSETS_DIR`: directory containing the compiled frontend. The root image sets this to `/app/public`.

Frontend build:

- `VITE_PLANNER_API_BASE_URL`: backend origin. Leave it unset when the frontend and backend share one Cloud Run service.

Never put `OPENAI_API_KEY` in frontend environment variables or frontend code.

## Local container

Build the combined production image from the repository root:

```bash
docker build -t run-tempo .
docker run --rm --env-file backend/.env -p 8080:8080 run-tempo
```

Open `http://localhost:8080` and verify `http://localhost:8080/health` after the container starts.

## Cloud Run deployment

### Single service

This is the recommended setup. The root Dockerfile builds the Vite frontend and Express backend into one image. Express serves the compiled frontend and same-origin `/api` routes, so CORS and `VITE_PLANNER_API_BASE_URL` do not need production configuration.

To enable GPT-assisted planning, create a Secret Manager secret containing the OpenAI API key, grant the Cloud Run runtime service account access to it, then deploy from the repository root:

```bash
gcloud run deploy run-tempo \
  --source . \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --set-env-vars OPENAI_MODEL=gpt-5.6-terra \
  --set-secrets OPENAI_API_KEY=<secret-name>:latest
```

Adjust the project, region, service name, model, and secret name as needed. The application listens on Cloud Run's `PORT` and exposes `/health` for verification.

An OpenAI key is optional. To deploy the local-analysis and deterministic-planning experience without GPT-assisted planning, omit `--set-secrets` and `--set-env-vars`:

```bash
gcloud run deploy run-tempo \
  --source . \
  --region asia-northeast1 \
  --no-invoker-iam-check
```

`--no-invoker-iam-check` makes the service publicly accessible without login. Use it only when anonymous visitors should be able to use the site. Without `OPENAI_API_KEY`, the app reports GPT as unavailable and falls back to its local deterministic planner; local audio analysis, mixing, and export remain available.

### Performance baseline

Cloud Run scales to zero by default, which can make the first request after an idle period slower. Keep one instance warm for a public, interactive site:

```bash
gcloud run services update run-tempo \
  --region asia-northeast1 \
  --min-instances 1
```

This incurs a baseline Cloud Run charge. The backend serves fingerprinted Vite files with one-year immutable caching and compresses responses over 1 KB. Audio model files are cached for seven days so repeat visitors do not redownload them on every visit.

### Split frontend and backend

Use a split deployment only when the frontend is hosted separately. Deploy the backend from its directory:

```bash
gcloud run deploy run-tempo-planner \
  --source backend \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --set-env-vars OPENAI_MODEL=gpt-5.6-terra,ALLOWED_ORIGINS=<frontend-origin> \
  --set-secrets OPENAI_API_KEY=<secret-name>:latest
```

Build the frontend with the resulting backend origin:

```bash
VITE_PLANNER_API_BASE_URL=<cloud-run-service-url> npm run build
```

When building the root image for a split deployment, pass the backend URL as a build argument:

```bash
docker build \
  --build-arg VITE_PLANNER_API_BASE_URL=<cloud-run-service-url> \
  -t run-tempo .
```

If the production UI reports `same-origin /api/openai/mix-plan` and requests reach a frontend-only service, rebuild the frontend with `VITE_PLANNER_API_BASE_URL` set to the backend origin.

## Validation boundary

The backend validates incoming planner requests with Zod. Model output is also validated and repaired deterministically where possible:

- Missing segment plans are filled from top candidates.
- Unknown track IDs are removed.
- Selections are limited to `rules.maxTracksPerSegment`.
- Mismatched BPM interpretations are corrected to the candidate score interpretation.
- Selections outside the frontend's precomputed candidate pool are removed.
- Invalid JSON or unrecoverable output returns HTTP `502`.

The model does not calculate stretch ratios, exact block durations, source timestamps, or mix timestamps.
