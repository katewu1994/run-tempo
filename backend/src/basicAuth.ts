import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

const AUTH_REALM = "RunTempo judges";

export function createBasicAuthMiddleware(): RequestHandler {
  const username = process.env.BASIC_AUTH_USERNAME?.trim();
  const password = process.env.BASIC_AUTH_PASSWORD;

  if (!username && !password) {
    return (_req, _res, next) => next();
  }

  if (!username || !password) {
    console.error(
      "Basic authentication is only partially configured. Both BASIC_AUTH_USERNAME and BASIC_AUTH_PASSWORD are required.",
    );

    return (_req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.status(503).send("Authentication is not configured correctly.");
    };
  }

  return (req, res, next) => {
    if (isBasicAuthorizationValid(req.headers.authorization, username, password)) {
      next();
      return;
    }

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("WWW-Authenticate", `Basic realm="${AUTH_REALM}", charset="UTF-8"`);
    res.status(401).send("Authentication required.");
  };
}

export function isBasicAuthorizationValid(
  authorization: string | undefined,
  expectedUsername: string,
  expectedPassword: string,
): boolean {
  if (!authorization?.startsWith("Basic ")) {
    return false;
  }

  try {
    const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");

    if (separatorIndex < 0) {
      return false;
    }

    const username = decoded.slice(0, separatorIndex);
    const password = decoded.slice(separatorIndex + 1);

    return (
      constantTimeEqual(username, expectedUsername) &&
      constantTimeEqual(password, expectedPassword)
    );
  } catch {
    return false;
  }
}

function constantTimeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}
