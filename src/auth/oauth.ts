import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { platform } from "node:os";
import { promisify } from "node:util";

import * as z from "zod/v4";

import type { AppConfig } from "../config.js";
import {
  CREDENTIALS_SCHEMA_VERSION,
  DEFAULT_SCOPES,
  HTTP_REQUEST_TIMEOUT_MS,
  OAUTH_CALLBACK_TIMEOUT_MS,
  PACKAGE_NAME,
} from "../constants.js";
import { ScreenAppBridgeError } from "../errors.js";
import type { CredentialStore, StoredCredentials } from "./types.js";
import { oauthTokenResponseSchema } from "./types.js";

const execFileAsync = promisify(execFile);

const authorizationMetadataSchema = z.object({
  issuer: z.url(),
  authorization_endpoint: z.url(),
  token_endpoint: z.url(),
  registration_endpoint: z.url(),
});

const clientRegistrationSchema = z.object({
  client_id: z.string().min(1),
  client_secret: z.string().min(1).optional(),
  token_endpoint_auth_method: z.string().optional(),
});

export interface OAuthLoginOptions {
  openBrowser: boolean;
  timeoutMs?: number;
  onAuthorizationUrl?: (url: URL) => void;
}

function base64Url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

function createPkce(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(48));
  const challenge = createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return { verifier, challenge };
}

async function parseJson(response: Response, purpose: string): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new ScreenAppBridgeError(
      `ScreenApp returned a non-JSON response during ${purpose}.`,
      "OAUTH_INVALID_RESPONSE",
      { cause: error },
    );
  }
}

async function discoverMetadata(
  issuer: URL,
  fetchImplementation: typeof fetch,
): Promise<z.infer<typeof authorizationMetadataSchema>> {
  const url = new URL("/.well-known/oauth-authorization-server", issuer);
  const response = await fetchImplementation(url, {
    redirect: "error",
    signal: AbortSignal.timeout(HTTP_REQUEST_TIMEOUT_MS),
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new ScreenAppBridgeError(
      `ScreenApp OAuth discovery failed with HTTP ${String(response.status)}.`,
      "OAUTH_DISCOVERY_FAILED",
    );
  }
  const metadata = authorizationMetadataSchema.safeParse(
    await parseJson(response, "OAuth discovery"),
  );
  const normalizeIssuer = (value: string | URL) =>
    new URL(value).toString().replace(/\/$/, "");
  const issuerMatches =
    metadata.success &&
    normalizeIssuer(metadata.data.issuer) === normalizeIssuer(issuer);
  const endpointsMatchIssuer =
    metadata.success &&
    [
      metadata.data.authorization_endpoint,
      metadata.data.token_endpoint,
      metadata.data.registration_endpoint,
    ].every((value) => new URL(value).origin === issuer.origin);
  if (!metadata.success || !issuerMatches || !endpointsMatchIssuer) {
    throw new ScreenAppBridgeError(
      "ScreenApp OAuth discovery returned invalid or mismatched metadata.",
      "OAUTH_DISCOVERY_FAILED",
    );
  }
  return metadata.data;
}

async function registerClient(
  registrationEndpoint: string,
  redirectUri: string,
  fetchImplementation: typeof fetch,
): Promise<z.infer<typeof clientRegistrationSchema>> {
  const response = await fetchImplementation(registrationEndpoint, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(HTTP_REQUEST_TIMEOUT_MS),
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      client_name: "ScreenApp Legacy MCP Bridge",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
    }),
  });
  const parsed = clientRegistrationSchema.safeParse(
    await parseJson(response, "dynamic client registration"),
  );
  if (!response.ok || !parsed.success) {
    throw new ScreenAppBridgeError(
      `ScreenApp dynamic client registration failed with HTTP ${String(response.status)}.`,
      "OAUTH_REGISTRATION_FAILED",
    );
  }
  return parsed.data;
}

async function openBrowser(url: URL): Promise<void> {
  const command =
    platform() === "darwin"
      ? "open"
      : platform() === "win32"
        ? "explorer.exe"
        : "xdg-open";
  const args = [url.toString()];
  try {
    await execFileAsync(command, args);
  } catch (error) {
    throw new ScreenAppBridgeError(
      `Could not open a browser. Open this URL manually:\n${url.toString()}`,
      "BROWSER_OPEN_FAILED",
      { cause: error },
    );
  }
}

async function listenOnLoopback(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new ScreenAppBridgeError(
      "Could not determine the local OAuth callback port.",
      "OAUTH_CALLBACK_FAILED",
    );
  }
  return address.port;
}

function waitForAuthorizationCode(
  server: Server,
  expectedState: string,
  callbackPath: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(
        new ScreenAppBridgeError(
          "Timed out waiting for ScreenApp authorization.",
          "OAUTH_CALLBACK_TIMEOUT",
        ),
      );
    }, timeoutMs);

    server.on("request", (request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== callbackPath) {
        response.writeHead(404).end("Not found");
        return;
      }

      const error = url.searchParams.get("error");
      const state = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      const success = !error && state === expectedState && Boolean(code);
      response
        .writeHead(success ? 200 : 400, { "content-type": "text/html; charset=utf-8" })
        .end(
          success
            ? "<!doctype html><title>ScreenApp connected</title><h1>ScreenApp connected</h1><p>You can close this tab and return to your terminal.</p>"
            : "<!doctype html><title>Authorization failed</title><h1>Authorization failed</h1><p>Return to your terminal for details.</p>",
        );

      clearTimeout(timeout);
      if (state !== expectedState) {
        reject(
          new ScreenAppBridgeError(
            "The OAuth callback state did not match. Authorization was rejected for safety.",
            "OAUTH_STATE_MISMATCH",
          ),
        );
      } else if (error) {
        reject(
          new ScreenAppBridgeError(
            "ScreenApp authorization was denied or failed.",
            "OAUTH_AUTHORIZATION_FAILED",
          ),
        );
      } else if (!code) {
        reject(
          new ScreenAppBridgeError(
            "The OAuth callback did not include an authorization code.",
            "OAUTH_CODE_MISSING",
          ),
        );
      } else {
        resolve(code);
      }
    });
  });
}

export async function loginWithLegacyOAuth(
  config: AppConfig,
  store: CredentialStore,
  options: OAuthLoginOptions,
  fetchImplementation: typeof fetch = fetch,
): Promise<StoredCredentials> {
  const callbackPath = "/oauth/callback";
  const server = createServer();
  const port = await listenOnLoopback(server);
  const redirectUri = `http://127.0.0.1:${String(port)}${callbackPath}`;

  try {
    const metadata = await discoverMetadata(config.oauthIssuer, fetchImplementation);
    const client = await registerClient(
      metadata.registration_endpoint,
      redirectUri,
      fetchImplementation,
    );
    const state = base64Url(randomBytes(24));
    const { verifier, challenge } = createPkce();
    const authorizationUrl = new URL(metadata.authorization_endpoint);
    authorizationUrl.search = new URLSearchParams({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
      scope: DEFAULT_SCOPES.join(" "),
      resource: config.oauthResource,
    }).toString();

    options.onAuthorizationUrl?.(authorizationUrl);
    const codePromise = waitForAuthorizationCode(
      server,
      state,
      callbackPath,
      options.timeoutMs ?? OAUTH_CALLBACK_TIMEOUT_MS,
    );
    if (options.openBrowser) {
      try {
        await openBrowser(authorizationUrl);
      } catch (error) {
        void codePromise.catch(() => undefined);
        throw error;
      }
    }
    const code = await codePromise;

    // ScreenApp's legacy authorization server advertises client_secret_post.
    // Keeping client credentials in the form body is the compatibility fix.
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      client_id: client.client_id,
      resource: config.oauthResource,
    });
    if (client.client_secret) form.set("client_secret", client.client_secret);

    const tokenResponse = await fetchImplementation(metadata.token_endpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(HTTP_REQUEST_TIMEOUT_MS),
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form,
    });
    const token = oauthTokenResponseSchema.safeParse(
      await parseJson(tokenResponse, "token exchange"),
    );
    if (!tokenResponse.ok || !token.success) {
      throw new ScreenAppBridgeError(
        `ScreenApp token exchange failed with HTTP ${String(tokenResponse.status)}.`,
        "OAUTH_TOKEN_EXCHANGE_FAILED",
      );
    }

    const credentials: StoredCredentials = {
      schemaVersion: CREDENTIALS_SCHEMA_VERSION,
      accessToken: token.data.access_token,
      ...(token.data.refresh_token
        ? { refreshToken: token.data.refresh_token }
        : {}),
      ...(token.data.token_type ? { tokenType: token.data.token_type } : {}),
      ...(token.data.scope ? { scope: token.data.scope } : {}),
      ...(token.data.expires_in
        ? { expiresAt: Date.now() + token.data.expires_in * 1000 }
        : {}),
      oauth: {
        tokenEndpoint: metadata.token_endpoint,
        clientId: client.client_id,
        ...(client.client_secret ? { clientSecret: client.client_secret } : {}),
        ...(client.token_endpoint_auth_method
          ? { tokenEndpointAuthMethod: client.token_endpoint_auth_method }
          : {}),
        resource: config.oauthResource,
      },
    };
    await store.write(credentials);
    return credentials;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

export const oauthClientName = PACKAGE_NAME;
