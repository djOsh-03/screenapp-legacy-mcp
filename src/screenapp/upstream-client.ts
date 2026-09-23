import {
  Client,
  SSEClientTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";

import type { AppConfig } from "../config.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../constants.js";
import { ScreenAppBridgeError } from "../errors.js";
import type { CredentialManager } from "../auth/manager.js";
import { createSessionFetch, type FetchImplementation } from "./session-fetch.js";

export const READ_ONLY_UPSTREAM_TOOLS = [
  "list_recordings",
  "get_recording",
  "get_transcript",
  "search_recordings",
  "get_profile",
  "list_teams",
  "get_team",
  "get_usage_stats",
] as const;

export type ReadOnlyUpstreamTool = (typeof READ_ONLY_UPSTREAM_TOOLS)[number];

export class ScreenAppUpstreamClient {
  private client: Client | undefined;
  private connectionPromise: Promise<void> | undefined;

  constructor(
    private readonly config: AppConfig,
    private readonly credentials: CredentialManager,
    private readonly fetchImplementation: FetchImplementation = fetch,
  ) {}

  async connect(): Promise<void> {
    if (this.client) return;
    if (this.connectionPromise) return this.connectionPromise;
    this.connectionPromise = this.openConnection();
    try {
      await this.connectionPromise;
    } finally {
      this.connectionPromise = undefined;
    }
  }

  private async openConnection(): Promise<void> {
    const client = new Client({
      name: `${PACKAGE_NAME}-upstream`,
      version: PACKAGE_VERSION,
    });
    // The UUID-based ScreenApp endpoint only supports the deprecated HTTP+SSE
    // transport. This bridge is intentionally the compatibility boundary.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const transport = new SSEClientTransport(this.config.mcpUrl, {
      authProvider: this.credentials.asMcpAuthProvider(),
      fetch: createSessionFetch(
        this.config.mcpUrl.origin,
        this.fetchImplementation,
      ),
    });
    try {
      await client.connect(transport);
      this.client = client;
    } catch (error) {
      await client.close().catch(() => undefined);
      throw new ScreenAppBridgeError(
        "Could not connect to ScreenApp's legacy MCP endpoint. Check your credentials and network connection.",
        "UPSTREAM_CONNECT_FAILED",
        { cause: error },
      );
    }
  }

  async callTool(
    name: ReadOnlyUpstreamTool,
    args: Record<string, unknown> = {},
  ): Promise<CallToolResult> {
    await this.connect();
    const client = this.client;
    if (!client) throw new Error("ScreenApp client did not initialize.");
    return client.callTool({ name, arguments: args });
  }

  async listToolNames(): Promise<string[]> {
    await this.connect();
    const client = this.client;
    if (!client) throw new Error("ScreenApp client did not initialize.");
    return (await client.listTools()).tools.map((tool) => tool.name);
  }

  async close(): Promise<void> {
    await this.connectionPromise?.catch(() => undefined);
    await this.client?.close();
    this.client = undefined;
  }
}
