import { describe, expect, it, vi } from "vitest";

import { createSessionFetch } from "../src/screenapp/session-fetch.js";

describe("legacy SSE session cookies", () => {
  it("captures mcp-session and sends it only to the upstream origin", async () => {
    const baseFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("stream", {
          headers: { "set-cookie": "mcp-session=session-value; Path=/; HttpOnly" },
        }),
      )
      .mockResolvedValue(new Response("ok"));
    const sessionFetch = createSessionFetch(
      "https://api.screenapp.io",
      baseFetch,
    );

    await sessionFetch("https://api.screenapp.io/v2/mcp/sse");
    await sessionFetch("https://api.screenapp.io/v2/mcp/messages", {
      method: "POST",
    });
    await sessionFetch("https://example.com/no-cookie");

    const sameOriginHeaders = new Headers(baseFetch.mock.calls[1]?.[1]?.headers);
    const otherOriginHeaders = new Headers(baseFetch.mock.calls[2]?.[1]?.headers);
    expect(sameOriginHeaders.get("cookie")).toBe("mcp-session=session-value");
    expect(otherOriginHeaders.has("cookie")).toBe(false);
    expect(baseFetch.mock.calls[1]?.[1]?.redirect).toBe("error");
  });
});
