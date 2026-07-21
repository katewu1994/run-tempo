import assert from "node:assert/strict";
import test from "node:test";
import {
  checkOpenAIConnection,
  extractStructuredOutput,
  getOpenAIModelStatusUrl,
} from "../src/openaiClient.js";
import { PlannerOutputValidationError } from "../src/validate.js";

test("extracts structured JSON from the Responses API output shape", () => {
  const parsed = extractStructuredOutput({
    id: "resp_test",
    object: "response",
    output: [
      {
        type: "reasoning",
        id: "rs_test",
      },
      {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: '{"mixTitle":"Morning run",',
          },
          {
            type: "output_text",
            text: '"segmentPlans":[]}',
          },
        ],
      },
    ],
  });

  assert.deepEqual(parsed, {
    mixTitle: "Morning run",
    segmentPlans: [],
  });
});

test("keeps top-level output_text compatibility", () => {
  assert.deepEqual(
    extractStructuredOutput({
      output_text: '{"mixTitle":"Tempo run","segmentPlans":[]}',
    }),
    {
      mixTitle: "Tempo run",
      segmentPlans: [],
    },
  );
});

test("rejects response objects without Responses API output text", () => {
  assert.throws(
    () => extractStructuredOutput({ candidates: [] }),
    (error: unknown) =>
      error instanceof PlannerOutputValidationError &&
      error.message === "OpenAI response did not contain JSON text.",
  );
});

test("builds the model status URL from the configured Responses endpoint", () => {
  const previousBaseUrl = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_BASE_URL = "https://example.test/openai/v1/responses?ignored=1";

  try {
    assert.equal(
      getOpenAIModelStatusUrl("gpt-test/model"),
      "https://example.test/openai/v1/models/gpt-test%2Fmodel",
    );
  } finally {
    restoreEnvironmentVariable("OPENAI_BASE_URL", previousBaseUrl);
  }
});

test("reports connected only when the configured model is accessible", async () => {
  const previousApiKey = process.env.OPENAI_API_KEY;
  const previousModel = process.env.OPENAI_MODEL;
  const previousBaseUrl = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_API_KEY = "test-key";
  process.env.OPENAI_MODEL = "gpt-test";
  delete process.env.OPENAI_BASE_URL;

  try {
    const result = await checkOpenAIConnection((async (input, init) => {
      assert.equal(input, "https://api.openai.com/v1/models/gpt-test");
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        "Bearer test-key",
      );
      return new Response(null, { status: 200 });
    }) as typeof fetch);

    assert.deepEqual(result, { status: "connected", model: "gpt-test" });
  } finally {
    restoreEnvironmentVariable("OPENAI_API_KEY", previousApiKey);
    restoreEnvironmentVariable("OPENAI_MODEL", previousModel);
    restoreEnvironmentVariable("OPENAI_BASE_URL", previousBaseUrl);
  }
});

test("reports unavailable without exposing a missing API key", async () => {
  const previousApiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  try {
    const result = await checkOpenAIConnection();
    assert.equal(result.status, "unavailable");
  } finally {
    restoreEnvironmentVariable("OPENAI_API_KEY", previousApiKey);
  }
});

function restoreEnvironmentVariable(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
