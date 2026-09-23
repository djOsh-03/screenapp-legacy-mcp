import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { describe, expect, it, vi } from "vitest";

import { createScreenAppServer } from "../src/server.js";
import type { ScreenAppSummaryClient } from "../src/screenapp/summary.js";
import type { ScreenAppUpstreamClient } from "../src/screenapp/upstream-client.js";

describe("MCP server surface", () => {
  it("exposes read-only legacy tools and the compatibility summary tool", async () => {
    const callToolMock = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "upstream result" }],
    });
    const upstream = {
      callTool: callToolMock,
      close: vi.fn(),
    } as unknown as ScreenAppUpstreamClient;
    const summaries = {
      getSummary: vi.fn().mockResolvedValue({
        fileId: "11111111-2222-4333-8444-555555555555",
        title: "Example",
        available: true,
        source: "file.description",
        chapters: [],
        description: "Stored summary.",
        warnings: [],
      }),
    } as unknown as ScreenAppSummaryClient;
    const server = createScreenAppServer({ upstream, summaries });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    try {
      const tools = (await client.listTools()).tools;
      expect(tools.map(({ name }) => name)).toEqual([
        "list_recordings",
        "get_recording",
        "get_transcript",
        "search_recordings",
        "get_profile",
        "list_teams",
        "get_team",
        "get_usage_stats",
        "get_summary",
      ]);
      expect(tools.find(({ name }) => name === "get_summary")?.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
      });

      const summary = await client.callTool({
        name: "get_summary",
        arguments: {
          fileId: "11111111-2222-4333-8444-555555555555",
          format: "markdown",
        },
      });
      expect(summary.content).toContainEqual({
        type: "text",
        text: "Stored summary.",
      });

      await client.callTool({
        name: "list_recordings",
        arguments: { teamId: "team-example", limit: 5 },
      });
      expect(callToolMock).toHaveBeenCalledWith("list_recordings", {
        teamId: "team-example",
        limit: 5,
      });

      const remainingCalls = [
        { name: "get_recording", arguments: { fileId: "file-example" } },
        {
          name: "get_transcript",
          arguments: { fileId: "file-example", format: "plain" },
        },
        {
          name: "search_recordings",
          arguments: { query: "decision", teamId: "team-example" },
        },
        { name: "get_profile", arguments: {} },
        { name: "list_teams", arguments: {} },
        { name: "get_team", arguments: { teamId: "team-example" } },
        { name: "get_usage_stats", arguments: {} },
      ];
      for (const request of remainingCalls) {
        const result = await client.callTool(request);
        expect(result.isError).not.toBe(true);
      }
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns a safe MCP error when stored-summary retrieval fails", async () => {
    const upstream = {
      callTool: vi.fn(),
      close: vi.fn(),
    } as unknown as ScreenAppUpstreamClient;
    const summaries = {
      getSummary: vi.fn().mockRejectedValue(new Error("summary unavailable")),
    } as unknown as ScreenAppSummaryClient;
    const server = createScreenAppServer({ upstream, summaries });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    try {
      const result = await client.callTool({
        name: "get_summary",
        arguments: { fileId: "file-example" },
      });
      expect(result.isError).toBe(true);
      expect(result.content).toContainEqual({
        type: "text",
        text: "summary unavailable",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
