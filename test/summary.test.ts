import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config.js";
import {
  ScreenAppSummaryClient,
  parseStoredSummary,
  summaryAsMarkdown,
} from "../src/screenapp/summary.js";
import type { CredentialManager } from "../src/auth/manager.js";

const fileId = "11111111-2222-4333-8444-555555555555";

describe("stored ScreenApp summaries", () => {
  it("parses chapter summaries from the field omitted by legacy MCP", () => {
    const summary = parseStoredSummary(fileId, {
      data: {
        file: { name: "Quarterly planning", description: "Fallback" },
        postProcess: {
          systemPromptResponses: {
            CHAPTERS: {
              responseText: JSON.stringify({
                chapters: [
                  {
                    title: "Opening context",
                    start: "00:00",
                    end: "01:15",
                    notes: "The team frames the decision.",
                  },
                ],
              }),
            },
          },
        },
      },
    });

    expect(summary).toMatchObject({
      fileId,
      title: "Quarterly planning",
      available: true,
      source: "postProcess.systemPromptResponses.CHAPTERS",
      warnings: [],
    });
    expect(summary.chapters).toEqual([
      {
        title: "Opening context",
        start: "00:00",
        end: "01:15",
        paragraph: "The team frames the decision.",
      },
    ]);
    expect(summaryAsMarkdown(summary)).toBe(
      "### Opening context (00:00)\n\nThe team frames the decision.",
    );
  });

  it("falls back to the recording description", () => {
    const summary = parseStoredSummary(fileId, {
      data: { file: { name: "Example", description: "Stored description." } },
    });
    expect(summary.available).toBe(true);
    expect(summary.source).toBe("file.description");
    expect(summaryAsMarkdown(summary)).toBe("Stored description.");
  });

  it("reports malformed stored chapters without throwing", () => {
    const summary = parseStoredSummary(fileId, {
      data: {
        postProcess: {
          systemPromptResponses: { CHAPTERS: { responseText: "not-json" } },
        },
      },
    });
    expect(summary.available).toBe(false);
    expect(summary.warnings).toEqual([
      "The stored CHAPTERS response was not valid JSON.",
    ]);
  });

  it("uses bearer authentication without exposing the token in the URL", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: { file: { name: "Example" } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const config = {
      apiBaseUrl: new URL("https://api.screenapp.io/v2"),
    } as AppConfig;
    const credentials = {
      getAccessToken: vi.fn().mockResolvedValue("unit-test-token"),
    } as unknown as CredentialManager;

    const client = new ScreenAppSummaryClient(config, credentials, fetchMock);
    await client.getSummary(fileId);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const requestedUrl =
      url instanceof Request ? url.url : url?.toString();
    expect(requestedUrl).toBe(`https://api.screenapp.io/v2/files/${fileId}`);
    expect(init?.headers).toMatchObject({
      authorization: "Bearer unit-test-token",
    });
    expect(init?.redirect).toBe("error");
    expect(requestedUrl).not.toContain("unit-test-token");
  });
});
