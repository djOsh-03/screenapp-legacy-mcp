import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

import { PACKAGE_NAME, PACKAGE_VERSION } from "./constants.js";
import { toSafeErrorMessage } from "./errors.js";
import type {
  ReadOnlyUpstreamTool,
  ScreenAppUpstreamClient,
} from "./screenapp/upstream-client.js";
import type {
  ScreenAppSummaryClient,
} from "./screenapp/summary.js";
import {
  storedSummarySchema,
  summaryAsMarkdown,
} from "./screenapp/summary.js";

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const fileId = z.string().min(1).describe("ScreenApp recording/file UUID");
const teamId = z.string().min(1).describe("ScreenApp team ID");

export interface ServerDependencies {
  upstream: ScreenAppUpstreamClient;
  summaries: ScreenAppSummaryClient;
}

function toolError(error: unknown) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: toSafeErrorMessage(error) }],
  };
}

async function forward(
  upstream: ScreenAppUpstreamClient,
  name: ReadOnlyUpstreamTool,
  args: Record<string, unknown>,
) {
  try {
    return await upstream.callTool(name, args);
  } catch (error) {
    return toolError(error);
  }
}

export function createScreenAppServer({
  upstream,
  summaries,
}: ServerDependencies): McpServer {
  const server = new McpServer(
    { name: PACKAGE_NAME, version: PACKAGE_VERSION },
    {
      instructions:
        "Read-only compatibility access to UUID-based ScreenApp workspaces. " +
        "Use list_teams before team-scoped searches. get_summary reads an existing " +
        "stored ScreenApp summary and never generates a new AI answer. AI-generation " +
        "tools are intentionally not exposed.",
    },
  );

  server.registerTool(
    "list_recordings",
    {
      title: "List ScreenApp recordings",
      description:
        "List recordings from the last active ScreenApp team or a specified team.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).optional().describe("Maximum results"),
        offset: z.number().int().min(0).optional().describe("Pagination offset"),
        teamId: teamId.optional(),
      }),
      annotations: readOnlyAnnotations,
    },
    (args) => forward(upstream, "list_recordings", args),
  );

  server.registerTool(
    "get_recording",
    {
      title: "Get ScreenApp recording",
      description:
        "Get metadata for one legacy ScreenApp recording. Use get_transcript for transcript text and get_summary for its stored summary.",
      inputSchema: z.object({ fileId }),
      annotations: readOnlyAnnotations,
    },
    (args) => forward(upstream, "get_recording", args),
  );

  server.registerTool(
    "get_transcript",
    {
      title: "Get ScreenApp transcript",
      description:
        "Read an existing transcript. Long transcripts are paginated; continue with nextOffset while hasMore is true.",
      inputSchema: z.object({
        fileId,
        format: z.enum(["text", "plain", "segments"]).optional(),
        offset: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(100_000).optional(),
      }),
      annotations: readOnlyAnnotations,
    },
    (args) => forward(upstream, "get_transcript", args),
  );

  server.registerTool(
    "search_recordings",
    {
      title: "Search ScreenApp transcripts",
      description:
        "Search existing transcript text without asking ScreenApp to generate an AI answer.",
      inputSchema: z.object({
        query: z.string().min(1),
        teamId,
        ownerIds: z.array(z.string().min(1)).optional(),
        parentIds: z.array(z.string().min(1)).optional(),
        createdAfter: z.string().min(1).optional().describe("ISO 8601 date/time"),
        createdBefore: z.string().min(1).optional().describe("ISO 8601 date/time"),
      }),
      annotations: readOnlyAnnotations,
    },
    (args) => forward(upstream, "search_recordings", args),
  );

  server.registerTool(
    "get_profile",
    {
      title: "Get ScreenApp profile",
      description:
        "Read the profile for the authenticated ScreenApp account. Useful for confirming which account OAuth selected.",
      inputSchema: z.object({}),
      annotations: readOnlyAnnotations,
    },
    () => forward(upstream, "get_profile", {}),
  );

  server.registerTool(
    "list_teams",
    {
      title: "List ScreenApp teams",
      description:
        "List teams available to the authenticated ScreenApp account.",
      inputSchema: z.object({}),
      annotations: readOnlyAnnotations,
    },
    () => forward(upstream, "list_teams", {}),
  );

  server.registerTool(
    "get_team",
    {
      title: "Get ScreenApp team",
      description: "Read details for one ScreenApp team.",
      inputSchema: z.object({ teamId }),
      annotations: readOnlyAnnotations,
    },
    (args) => forward(upstream, "get_team", args),
  );

  server.registerTool(
    "get_usage_stats",
    {
      title: "Get ScreenApp usage",
      description:
        "Read ScreenApp usage and billing counters. This does not consume credits.",
      inputSchema: z.object({}),
      annotations: readOnlyAnnotations,
    },
    () => forward(upstream, "get_usage_stats", {}),
  );

  server.registerTool(
    "get_summary",
    {
      title: "Get stored ScreenApp summary",
      description:
        "Read the summary ScreenApp already stored for a UUID recording. This is read-only and does not generate an answer or consume Ask AI credits.",
      inputSchema: z.object({
        fileId,
        format: z.enum(["json", "markdown"]).default("json"),
      }),
      outputSchema: storedSummarySchema,
      annotations: readOnlyAnnotations,
    },
    async ({ fileId: requestedFileId, format }) => {
      try {
        const summary = await summaries.getSummary(requestedFileId);
        const text =
          format === "markdown"
            ? summaryAsMarkdown(summary) ||
              "No stored summary is available for this recording."
            : JSON.stringify(summary, null, 2);
        return {
          content: [{ type: "text", text }],
          structuredContent: summary,
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  return server;
}

export async function runStdioServer(dependencies: ServerDependencies): Promise<void> {
  const server = createScreenAppServer(dependencies);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const close = async () => {
    await server.close();
    await dependencies.upstream.close();
  };
  process.once("SIGINT", () => void close().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void close().finally(() => process.exit(0)));
}
