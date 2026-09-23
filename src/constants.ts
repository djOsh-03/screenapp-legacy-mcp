export const PACKAGE_NAME = "screenapp-legacy-mcp";
export const PACKAGE_VERSION = "0.1.0";

export const DEFAULT_API_BASE_URL = "https://api.screenapp.io/v2";
export const DEFAULT_MCP_URL = "https://api.screenapp.io/v2/mcp/sse";
export const DEFAULT_OAUTH_ISSUER = "https://api.screenapp.io";
export const DEFAULT_OAUTH_RESOURCE = DEFAULT_MCP_URL;

export const DEFAULT_SCOPES = [
  "self:fs:read",
  "self:fs:file:read",
  "self:profile:read",
  "self:team-space:read",
  "self:billing:read",
] as const;

export const DEFAULT_KEYCHAIN_SERVICE =
  "io.github.djosh-03.screenapp-legacy-mcp";
export const DEFAULT_KEYCHAIN_ACCOUNT = "default";
export const CREDENTIALS_SCHEMA_VERSION = 1;

export const TOKEN_EXPIRY_SKEW_MS = 60_000;
export const OAUTH_CALLBACK_TIMEOUT_MS = 5 * 60_000;
export const HTTP_REQUEST_TIMEOUT_MS = 30_000;
