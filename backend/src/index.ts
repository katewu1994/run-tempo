if (process.env.NODE_ENV !== "production") {
  await import("dotenv/config");
}

import cors, { type CorsOptions } from "cors";
import compression from "compression";
import express from "express";
import { join, relative, resolve } from "node:path";
import { ZodError } from "zod";
import {
  checkOpenAIConnection,
  createOpenAISelectionPlan,
  OpenAIConfigurationError,
  getOpenAIModel,
} from "./openaiClient.js";
import {
  formatZodError,
  parsePlannerInput,
  PlannerOutputValidationError,
} from "./validate.js";
import {
  CoverArtServiceError,
  fetchCoverArtImage,
  lookupCoverArt,
  parseCoverArtLookup,
} from "./coverArt.js";
import {
  importYoutubeAudio,
  parseYoutubeUrl,
  YoutubeImportServiceError,
} from "./youtubeImport.js";
import { createBasicAuthMiddleware } from "./basicAuth.js";

const PORT = Number(process.env.PORT ?? 8080);
const SERVICE_NAME = "run-tempo-planner";

const app = express();

app.use(createBasicAuthMiddleware());
app.use(cors(getCorsOptionsDelegate()));
app.use(compression({ threshold: 1024 }));
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    model: getOpenAIModel(),
    service: SERVICE_NAME,
  });
});

app.get("/api/openai/status", async (_req, res) => {
  const status = await checkOpenAIConnection();

  res.setHeader("Cache-Control", "no-store");
  res.json(status);
});

app.post("/api/youtube/import", async (req, res) => {
  try {
    const youtubeUrl = parseYoutubeUrl(req.body?.url);
    const importedAudio = await importYoutubeAudio(youtubeUrl);

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader(
      "X-Audio-Filename",
      encodeURIComponent(importedAudio.fileName),
    );
    res.sendFile(importedAudio.filePath, (sendError) => {
      void importedAudio.cleanup().catch((cleanupError) => {
        console.error("Unable to clean up YouTube import", cleanupError);
      });

      if (sendError && !res.headersSent) {
        res.status(500).json({ error: "Unable to send imported audio." });
      }
    });
  } catch (error) {
    const status = error instanceof YoutubeImportServiceError ? error.status : 500;
    const message =
      error instanceof YoutubeImportServiceError
        ? error.message
        : "Unable to import audio from YouTube.";

    console.error("YouTube import failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : String(error),
    });
    res.status(status).json({ error: message });
  }
});

app.post("/api/openai/mix-plan", async (req, res) => {
  try {
    const input = parsePlannerInput(req.body);
    const selectionPlan = await createOpenAISelectionPlan(input);
    res.json(selectionPlan);
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json({
        error: "Invalid planner request.",
        details: formatZodError(error),
      });
      return;
    }

    const status = 502;
    const safeMessage = getSafePlannerErrorMessage(error);

    console.error("OpenAI planner request failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : String(error),
    });

    res.status(status).json({
      error: safeMessage,
    });
  }
});

app.get("/api/cover-art/lookup", async (req, res) => {
  try {
    const input = parseCoverArtLookup(req.query);
    const candidates = await lookupCoverArt(input);
    res.json({ candidates });
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json({ error: "Artist and album are required." });
      return;
    }

    const status = error instanceof CoverArtServiceError ? error.status : 502;
    console.error("Cover art lookup failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : String(error),
    });
    res.status(status).json({ error: "Unable to look up cover art." });
  }
});

app.get("/api/cover-art/image/:releaseGroupId", async (req, res) => {
  try {
    const image = await fetchCoverArtImage(req.params.releaseGroupId);
    res.setHeader("Content-Type", image.contentType);
    res.setHeader("Cache-Control", "public, max-age=604800, immutable");
    res.send(Buffer.from(image.bytes));
  } catch (error) {
    const status = error instanceof CoverArtServiceError ? error.status : 502;
    console.error("Cover art image request failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : String(error),
    });
    res.status(status).json({ error: "Unable to load cover art." });
  }
});

configureStaticFrontend();

app.listen(PORT, () => {
  console.log(`${SERVICE_NAME} listening on port ${PORT}`);
});

function getCorsOptionsDelegate(): (
  req: express.Request,
  callback: (error: Error | null, options?: CorsOptions) => void,
) => void {
  const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
  const allowLocalDevelopmentOrigins = process.env.NODE_ENV !== "production";

  return (req, callback) => {
    const origin = req.headers.origin;

    if (
      !origin ||
      allowedOrigins.has("*") ||
      allowedOrigins.has(origin) ||
      isSameHostOrigin(origin, req) ||
      (allowLocalDevelopmentOrigins && isLoopbackOrigin(origin))
    ) {
      callback(null, {
        origin: true,
        exposedHeaders: ["X-Audio-Filename"],
      });
      return;
    }

    callback(new Error(`Origin ${origin} is not allowed by CORS.`));
  };
}

function isSameHostOrigin(origin: string, req: express.Request): boolean {
  try {
    const originUrl = new URL(origin);
    const requestHost =
      req.headers["x-forwarded-host"]?.toString() ?? req.headers.host;

    return Boolean(requestHost && originUrl.host === requestHost);
  } catch {
    return false;
  }
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);

    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

function parseAllowedOrigins(value: string | undefined): Set<string> {
  const origins =
    value?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? [];

  return new Set(
    origins.length > 0
      ? origins
      : ["http://localhost:5173", "http://localhost:3000"],
  );
}

function getSafePlannerErrorMessage(error: unknown): string {
  if (error instanceof OpenAIConfigurationError) {
    return error.message;
  }

  if (error instanceof PlannerOutputValidationError) {
    return error.message;
  }

  return "OpenAI planner request failed. Check backend logs for details.";
}

function configureStaticFrontend(): void {
  const configuredStaticAssetsDir = process.env.STATIC_ASSETS_DIR?.trim();

  if (!configuredStaticAssetsDir) {
    return;
  }

  const staticAssetsDir = resolve(configuredStaticAssetsDir);
  const indexHtmlPath = join(staticAssetsDir, "index.html");

  app.use(
    express.static(staticAssetsDir, {
      setHeaders: (res, filePath) => {
        const assetPath = relative(staticAssetsDir, filePath).replaceAll("\\", "/");

        if (assetPath === "index.html") {
          res.setHeader("Cache-Control", "no-cache");
        } else if (assetPath.startsWith("assets/")) {
          res.setHeader(
            "Cache-Control",
            "public, max-age=31536000, immutable",
          );
        } else if (assetPath.startsWith("models/")) {
          res.setHeader("Cache-Control", "public, max-age=604800");
        } else {
          res.setHeader("Cache-Control", "public, max-age=86400");
        }
      },
    }),
  );
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found." });
  });
  app.get("*", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(indexHtmlPath);
  });
}
