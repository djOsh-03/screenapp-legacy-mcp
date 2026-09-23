import { describe, expect, it, vi } from "vitest";

import type { CredentialManager } from "../src/auth/manager.js";
import type { AppConfig } from "../src/config.js";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  callTool: vi.fn().mockResolvedValue({
    content: [{ type: "text", text: "ok" }],
  }),
  listTools: vi.fn().mockResolvedValue({
    tools: [{ name: "get_profile" }, { name: "list_teams" }],
  }),
  close: vi.fn().mockResolvedValue(undefined),
  transport: vi.fn(),
}));

vi.mock("@modelcontextprotocol/client", () => ({
  Client: class {
    connect = mocks.connect;
    callTool = mocks.callTool;
    listTools = mocks.listTools;
    close = mocks.close;
  },
  // SDK transports are constructor-only from the caller's perspective.
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  SSEClientTransport: class {
    constructor(...args: unknown[]) {
      mocks.transport(...args);
    }
  },
}));

const { ScreenAppUpstreamClient } = await import(
  "../src/screenapp/upstream-client.js"
);

describe("legacy upstream client", () => {
  it("connects once, forwards tools, and lists upstream capabilities", async () => {
    const config = {
      mcpUrl: new URL("https://api.screenapp.io/v2/mcp/sse"),
    } as AppConfig;
    const credentials = {
      asMcpAuthProvider: vi.fn().mockReturnValue({
        token: vi.fn().mockResolvedValue("access-value"),
      }),
    } as unknown as CredentialManager;
    const client = new ScreenAppUpstreamClient(
      config,
      credentials,
      vi.fn<typeof fetch>(),
    );

    await Promise.all([
      client.callTool("get_profile"),
      client.callTool("list_teams"),
    ]);
    expect(await client.listToolNames()).toEqual(["get_profile", "list_teams"]);
    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(mocks.callTool).toHaveBeenCalledWith({
      name: "get_profile",
      arguments: {},
    });
    expect(mocks.transport).toHaveBeenCalledOnce();

    await client.close();
    expect(mocks.close).toHaveBeenCalled();
  });
});
