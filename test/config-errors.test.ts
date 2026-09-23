import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { createCredentialStore } from "../src/auth/manager.js";
import { FileCredentialStore } from "../src/auth/stores.js";
import { ScreenAppBridgeError, toSafeErrorMessage } from "../src/errors.js";

describe("configuration and safe errors", () => {
  it("loads explicit portable file-store settings", () => {
    const config = loadConfig({
      SCREENAPP_CREDENTIAL_STORE: "file",
      SCREENAPP_CREDENTIALS_FILE: "/tmp/screenapp-test-credentials.json",
      SCREENAPP_ACCESS_TOKEN: "  access-value  ",
    });
    expect(config.credentialStore).toBe("file");
    expect(config.credentialsFile).toBe("/tmp/screenapp-test-credentials.json");
    expect(config.accessToken).toBe("access-value");
    expect(config.mcpUrl.toString()).toBe(
      "https://api.screenapp.io/v2/mcp/sse",
    );
    expect(createCredentialStore(config)).toBeInstanceOf(FileCredentialStore);
  });

  it("rejects insecure non-loopback endpoint overrides", () => {
    expect(() =>
      loadConfig({ SCREENAPP_MCP_URL: "http://example.com/mcp" }),
    ).toThrow(ScreenAppBridgeError);
    expect(() =>
      loadConfig({ SCREENAPP_MCP_URL: "file://127.0.0.1/mcp" }),
    ).toThrow(ScreenAppBridgeError);
  });

  it("returns safe human-readable error messages", () => {
    expect(
      toSafeErrorMessage(new ScreenAppBridgeError("Safe message", "TEST")),
    ).toBe("Safe message");
    expect(toSafeErrorMessage("unknown failure")).toBe(
      "An unexpected error occurred.",
    );
  });
});
