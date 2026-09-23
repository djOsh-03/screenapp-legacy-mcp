import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config.js";
import { loginWithLegacyOAuth } from "../src/auth/oauth.js";

describe("legacy OAuth login", () => {
  it("uses PKCE and puts confidential client credentials in the token form body", async () => {
    const requests: { url: string; init?: RequestInit }[] = [];
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      requests.push({ url, ...(init ? { init } : {}) });
      if (url.endsWith("/.well-known/oauth-authorization-server")) {
        return Promise.resolve(Response.json({
          issuer: "https://api.screenapp.io",
          authorization_endpoint: "https://api.screenapp.io/oauth/authorize",
          token_endpoint: "https://api.screenapp.io/oauth/token",
          registration_endpoint: "https://api.screenapp.io/oauth/register",
        }));
      }
      if (url.endsWith("/oauth/register")) {
        return Promise.resolve(Response.json({
          client_id: "test-client",
          client_secret: "test-client-value",
          token_endpoint_auth_method: "client_secret_post",
        }));
      }
      if (url.endsWith("/oauth/token")) {
        return Promise.resolve(Response.json({
          access_token: "access-value",
          refresh_token: "refresh-value",
          token_type: "Bearer",
          expires_in: 3600,
        }));
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });
    const store = {
      description: "test store",
      read: vi.fn(),
      write: vi.fn(),
    };
    const config = {
      oauthIssuer: new URL("https://api.screenapp.io"),
      oauthResource: "https://api.screenapp.io/v2/mcp/sse",
    } as AppConfig;

    const credentials = await loginWithLegacyOAuth(
      config,
      store,
      {
        openBrowser: false,
        onAuthorizationUrl: (authorizationUrl) => {
          const redirect = new URL(
            authorizationUrl.searchParams.get("redirect_uri") ?? "",
          );
          redirect.searchParams.set("code", "authorization-code");
          redirect.searchParams.set(
            "state",
            authorizationUrl.searchParams.get("state") ?? "",
          );
          queueMicrotask(() => void fetch(redirect));
        },
      },
      fetchMock,
    );

    expect(credentials.accessToken).toBe("access-value");
    expect(store.write).toHaveBeenCalledOnce();
    const tokenRequest = requests.find(({ url }) => url.endsWith("/oauth/token"));
    const form = tokenRequest?.init?.body as URLSearchParams;
    expect(form.get("client_id")).toBe("test-client");
    expect(form.get("client_secret")).toBe("test-client-value");
    expect(form.get("code_verifier")).toBeTruthy();
    expect(new Headers(tokenRequest?.init?.headers).has("authorization")).toBe(false);
    expect(tokenRequest?.init?.redirect).toBe("error");
  });

  it("rejects discovery metadata that moves token exchange to another origin", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        issuer: "https://api.screenapp.io",
        authorization_endpoint: "https://api.screenapp.io/oauth/authorize",
        token_endpoint: "https://attacker.example/token",
        registration_endpoint: "https://api.screenapp.io/oauth/register",
      }),
    );
    const store = {
      description: "test store",
      read: vi.fn(),
      write: vi.fn(),
    };
    const config = {
      oauthIssuer: new URL("https://api.screenapp.io"),
      oauthResource: "https://api.screenapp.io/v2/mcp/sse",
    } as AppConfig;

    await expect(
      loginWithLegacyOAuth(
        config,
        store,
        { openBrowser: false },
        fetchMock,
      ),
    ).rejects.toMatchObject({ code: "OAUTH_DISCOVERY_FAILED" });
    expect(store.write).not.toHaveBeenCalled();
  });

  it("requires the discovered issuer identifier to match exactly", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        issuer: "https://api.screenapp.io/another-issuer",
        authorization_endpoint: "https://api.screenapp.io/oauth/authorize",
        token_endpoint: "https://api.screenapp.io/oauth/token",
        registration_endpoint: "https://api.screenapp.io/oauth/register",
      }),
    );
    const store = {
      description: "test store",
      read: vi.fn(),
      write: vi.fn(),
    };
    await expect(
      loginWithLegacyOAuth(
        {
          oauthIssuer: new URL("https://api.screenapp.io"),
          oauthResource: "https://api.screenapp.io/v2/mcp/sse",
        } as AppConfig,
        store,
        { openBrowser: false },
        fetchMock,
      ),
    ).rejects.toMatchObject({ code: "OAUTH_DISCOVERY_FAILED" });
  });
});
