import assert from "node:assert/strict";
import test from "node:test";
import { isBasicAuthorizationValid } from "../src/basicAuth.js";

function basicHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

test("accepts the configured Basic Auth credentials", () => {
  assert.equal(
    isBasicAuthorizationValid(
      basicHeader("judge", "long:password"),
      "judge",
      "long:password",
    ),
    true,
  );
});

test("rejects missing or incorrect Basic Auth credentials", () => {
  assert.equal(isBasicAuthorizationValid(undefined, "judge", "secret"), false);
  assert.equal(
    isBasicAuthorizationValid(basicHeader("judge", "wrong"), "judge", "secret"),
    false,
  );
  assert.equal(
    isBasicAuthorizationValid(basicHeader("someone", "secret"), "judge", "secret"),
    false,
  );
});
