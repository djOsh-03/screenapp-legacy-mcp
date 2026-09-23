import type { AuthProvider } from "@modelcontextprotocol/client";

import type { AppConfig } from "../config.js";
import {
  CREDENTIALS_SCHEMA_VERSION,
  HTTP_REQUEST_TIMEOUT_MS,
  TOKEN_EXPIRY_SKEW_MS,
} from "../constants.js";
import { ScreenAppBridgeError } from "../errors.js";
import { FileCredentialStore, MacOsKeychainCredentialStore } from "./stores.js";
import type { CredentialStore, StoredCredentials } from "./types.js";
import { oauthTokenResponseSchema } from "./types.js";

export function createCredentialStore(config: AppConfig): CredentialStore {
  return config.credentialStore === "keychain"
    ? new MacOsKeychainCredentialStore(
        config.keychainService,
        config.keychainAccount,
      )
    : new FileCredentialStore(config.credentialsFile);
}

export class CredentialManager {
  private cached: StoredCredentials | undefined;
  private refreshPromise: Promise<StoredCredentials> | undefined;

  constructor(
    private readonly config: AppConfig,
    readonly store: CredentialStore,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async getCredentials(): Promise<StoredCredentials> {
    if (this.config.accessToken) {
      return {
        schemaVersion: CREDENTIALS_SCHEMA_VERSION,
        accessToken: this.config.accessToken,
      };
    }

    this.cached ??= await this.store.read();
    if (!this.cached) {
      throw new ScreenAppBridgeError(
        `No ScreenApp credentials were found in ${this.store.description}. Run "screenapp-legacy-mcp auth login" first.`,
        "MISSING_CREDENTIALS",
      );
    }

    if (
      this.cached.expiresAt &&
      this.cached.expiresAt <= Date.now() + TOKEN_EXPIRY_SKEW_MS
    ) {
      this.cached = await this.refreshOnce(this.cached);
    }
    return this.cached;
  }

  async getAccessToken(): Promise<string> {
    return (await this.getCredentials()).accessToken;
  }

  async forceRefresh(): Promise<void> {
    const current = this.cached ?? (await this.store.read());
    if (!current) {
      throw new ScreenAppBridgeError(
        "No saved ScreenApp credentials are available to refresh.",
        "MISSING_CREDENTIALS",
      );
    }
    this.cached = await this.refreshOnce(current);
  }

  asMcpAuthProvider(): AuthProvider {
    return {
      token: () => this.getAccessToken(),
      onUnauthorized: async () => this.forceRefresh(),
    };
  }

  private async refreshOnce(
    current: StoredCredentials,
  ): Promise<StoredCredentials> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.refresh(current);
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = undefined;
    }
  }

  private async refresh(current: StoredCredentials): Promise<StoredCredentials> {
    if (!current.refreshToken || !current.oauth) {
      throw new ScreenAppBridgeError(
        "The ScreenApp access token has expired and no refresh token is available. Run " +
          '"screenapp-legacy-mcp auth login" again.',
        "TOKEN_EXPIRED",
      );
    }

    const form = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: current.refreshToken,
      client_id: current.oauth.clientId,
      resource: current.oauth.resource,
    });
    if (current.oauth.clientSecret) {
      form.set("client_secret", current.oauth.clientSecret);
    }

    const response = await this.fetchImplementation(current.oauth.tokenEndpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(HTTP_REQUEST_TIMEOUT_MS),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
    });
    const payload = oauthTokenResponseSchema.safeParse(
      await response.json().catch(() => undefined),
    );
    if (!response.ok || !payload.success) {
      throw new ScreenAppBridgeError(
        `ScreenApp rejected the token refresh with HTTP ${String(response.status)}. Run "auth login" again.`,
        "TOKEN_REFRESH_FAILED",
      );
    }

    const refreshed: StoredCredentials = {
      ...current,
      accessToken: payload.data.access_token,
      refreshToken: payload.data.refresh_token ?? current.refreshToken,
      tokenType: payload.data.token_type ?? current.tokenType,
      scope: payload.data.scope ?? current.scope,
      ...(typeof payload.data.expires_in === "number"
        ? { expiresAt: Date.now() + payload.data.expires_in * 1000 }
        : {}),
    };
    await this.store.write(refreshed);
    return refreshed;
  }
}
