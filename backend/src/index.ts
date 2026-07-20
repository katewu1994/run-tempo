if (process.env.NODE_ENV !== "production") {
  await import("dotenv/config");
}

import cors, { type CorsOptions } from "cors";
import express from "express";
import { join, resolve } from "node:path";
import { ZodError } from "zod";
import {
  createOpenAISelectionPlan,
  OpenAIConfigurationError,
  getOpenAIModel,
} from "./openaiClient.js";
import {
  formatZodError,
  parsePlannerInput,
  PlannerOutputValidationError,
} from "./validate.js";

const PORT = Number(process.env.PORT ?? 8080);
const SERVICE_NAME = "run-tempo-planner";

const app = express();

app.use(cors(getCorsOptionsDelegate()));
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    model: getOpenAIModel(),
    service: SERVICE_NAME,
  });
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
      callback(null, { origin: true });
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

  app.use(express.static(staticAssetsDir));
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found." });
  });
  app.get("*", (_req, res) => {
    res.sendFile(indexHtmlPath);
  });
}
