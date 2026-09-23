import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";

import {
  DEFAULT_API_BASE_URL,
  DEFAULT_KEYCHAIN_ACCOUNT,
  DEFAULT_KEYCHAIN_SERVICE,
  DEFAULT_MCP_URL,
  DEFAULT_OAUTH_ISSUER,
  DEFAULT_OAUTH_RESOURCE,
} from "./constants.js";
import { ScreenAppBridgeError } from "./errors.js";

export type CredentialStoreKind = "file" | "keychain";

export interface AppConfig {
  apiBaseUrl: URL;
  mcpUrl: URL;
  oauthIssuer: URL;
  oauthResource: string;
  credentialStore: CredentialStoreKind;
  credentialsFile: string;
  keychainService: string;
  keychainAccount: string;
  accessToken?: string;
}

function parseUrl(value: string, name: string): URL {
  try {
    const url = new URL(value);
    const isSecure = url.protocol === "https:";
    const isLoopbackHttp =
      url.protocol === "http:" && url.hostname === "127.0.0.1";
    if (!isSecure && !isLoopbackHttp) {
      throw new Error("Only HTTPS or loopback URLs are accepted.");
    }
    return url;
  } catch (error) {
    throw new ScreenAppBridgeError(
      `${name} is not a valid secure URL.`,
      "INVALID_CONFIGURATION",
      { cause: error },
    );
  }
}

export function defaultCredentialsFile(env: NodeJS.ProcessEnv = process.env): string {
  const configHome = env.XDG_CONFIG_HOME
    ? resolve(env.XDG_CONFIG_HOME)
    : join(homedir(), ".config");
  return join(configHome, "screenapp-legacy-mcp", "credentials.json");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const requestedStore = env.SCREENAPP_CREDENTIAL_STORE;
  const credentialStore: CredentialStoreKind =
    requestedStore === "file" || requestedStore === "keychain"
      ? requestedStore
      : platform() === "darwin"
        ? "keychain"
        : "file";

  const accessToken = env.SCREENAPP_ACCESS_TOKEN?.trim();
  return {
    apiBaseUrl: parseUrl(
      env.SCREENAPP_API_BASE_URL ?? DEFAULT_API_BASE_URL,
      "SCREENAPP_API_BASE_URL",
    ),
    mcpUrl: parseUrl(env.SCREENAPP_MCP_URL ?? DEFAULT_MCP_URL, "SCREENAPP_MCP_URL"),
    oauthIssuer: parseUrl(
      env.SCREENAPP_OAUTH_ISSUER ?? DEFAULT_OAUTH_ISSUER,
      "SCREENAPP_OAUTH_ISSUER",
    ),
    oauthResource: env.SCREENAPP_OAUTH_RESOURCE ?? DEFAULT_OAUTH_RESOURCE,
    credentialStore,
    credentialsFile: resolve(
      env.SCREENAPP_CREDENTIALS_FILE ?? defaultCredentialsFile(env),
    ),
    keychainService:
      env.SCREENAPP_KEYCHAIN_SERVICE ?? DEFAULT_KEYCHAIN_SERVICE,
    keychainAccount:
      env.SCREENAPP_KEYCHAIN_ACCOUNT ?? DEFAULT_KEYCHAIN_ACCOUNT,
    ...(accessToken ? { accessToken } : {}),
  };
}
