import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config.js";
import { CREDENTIALS_SCHEMA_VERSION } from "../src/constants.js";
import { CredentialManager } from "../src/auth/manager.js";
import { FileCredentialStore } from "../src/auth/stores.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("credential storage and refresh", () => {
  it("uses an explicit environment token without reading the store", async () => {
    const store = {
      description: "unused test store",
      read: vi.fn(),
      write: vi.fn(),
    };
    const manager = new CredentialManager(
      { accessToken: "environment-token" } as AppConfig,
      store,
    );
    expect(await manager.getAccessToken()).toBe("environment-token");
    expect(store.read).not.toHaveBeenCalled();
  });

  it("writes file credentials atomically with owner-only permissions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "screenapp-credentials-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "nested", "credentials.json");
    const store = new FileCredentialStore(path);
    await store.write({
      schemaVersion: CREDENTIALS_SCHEMA_VERSION,
      accessToken: "unit-test-token",
    });

    expect(await store.read()).toMatchObject({ accessToken: "unit-test-token" });
    if (platform() !== "win32") {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }
    expect(await readFile(path, "utf8")).not.toContain("undefined");
  });

  it("refreshes an expiring token using client_secret_post semantics", async () => {
    const store = {
      description: "test store",
      read: vi.fn().mockResolvedValue({
        schemaVersion: CREDENTIALS_SCHEMA_VERSION,
        accessToken: "expired-token",
        refreshToken: "refresh-value",
        expiresAt: Date.now() - 1,
        oauth: {
          tokenEndpoint: "https://api.screenapp.io/oauth/token",
          clientId: "test-client",
          clientSecret: "test-client-value",
          resource: "https://api.screenapp.io/v2/mcp/sse",
        },
      }),
      write: vi.fn(),
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        access_token: "fresh-token",
        refresh_token: "fresh-refresh",
        expires_in: 3600,
      }),
    );
    const manager = new CredentialManager(
      {} as AppConfig,
      store,
      fetchMock,
    );

    const refreshedTokens = await Promise.all([
      manager.getAccessToken(),
      manager.getAccessToken(),
    ]);
    expect(refreshedTokens).toEqual(["fresh-token", "fresh-token"]);
    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0]?.[1];
    const form = init?.body as URLSearchParams;
    expect(form.get("client_id")).toBe("test-client");
    expect(form.get("client_secret")).toBe("test-client-value");
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
    expect(init?.redirect).toBe("error");
    expect(store.write).toHaveBeenCalledOnce();
  });

  it("rejects malformed refresh responses without overwriting credentials", async () => {
    const store = {
      description: "test store",
      read: vi.fn().mockResolvedValue({
        schemaVersion: CREDENTIALS_SCHEMA_VERSION,
        accessToken: "expired-token",
        refreshToken: "refresh-value",
        expiresAt: Date.now() - 1,
        oauth: {
          tokenEndpoint: "https://api.screenapp.io/oauth/token",
          clientId: "test-client",
          clientSecret: "test-client-value",
          resource: "https://api.screenapp.io/v2/mcp/sse",
        },
      }),
      write: vi.fn(),
    };
    const manager = new CredentialManager(
      {} as AppConfig,
      store,
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({ access_token: "", expires_in: 0.0001 }),
      ),
    );

    await expect(manager.getAccessToken()).rejects.toMatchObject({
      code: "TOKEN_REFRESH_FAILED",
    });
    expect(store.write).not.toHaveBeenCalled();
  });
});
