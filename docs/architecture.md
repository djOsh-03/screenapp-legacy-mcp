# Architecture

## Design goals

The bridge is designed around five constraints:

1. Keep OAuth credentials on the user's machine.
2. Give MCP clients a current, simple stdio interface even though the upstream service
   still uses the older HTTP+SSE transport.
3. Preserve legacy session behavior without forwarding cookies anywhere else.
4. Add the smallest missing compatibility feature: retrieval of summaries already stored
   by ScreenApp.
5. Make paid or quota-consuming AI generation impossible through this server.

## Components

### Local MCP server

`src/server.ts` uses the current `@modelcontextprotocol/server` package and exposes nine
tools over stdio. Each registration has a strict Zod input schema and read-only MCP
annotations. stdout is reserved for MCP JSON-RPC; CLI and diagnostic messages use the
appropriate command mode or stderr.

### Legacy upstream client

`src/screenapp/upstream-client.ts` uses the current MCP client package's legacy
`SSEClientTransport`. This deprecated transport is isolated to one file. The rest of the
application does not depend on SSE details.

During the initial SSE request, ScreenApp returns an `mcp-session` cookie. The MCP client
then POSTs JSON-RPC messages to an endpoint announced by the SSE stream. The wrapper in
`session-fetch.ts` captures the cookie and replays it only when the destination origin
matches the configured ScreenApp origin. It never creates a general-purpose cookie jar.

### OAuth and credential management

`src/auth/oauth.ts` performs OAuth authorization-code flow with PKCE:

1. Discover ScreenApp's OAuth metadata.
2. Register a client for a loopback redirect URI.
3. Generate a random state and PKCE verifier/challenge.
4. Open the ScreenApp authorization page.
5. Receive the code on `127.0.0.1`.
6. Exchange it using `client_secret_post`.
7. Store the token bundle.

The callback listener binds only to IPv4 loopback and uses an operating-system-assigned
port. State is verified before the code is accepted. Discovery is rejected unless the
issuer, authorization, registration, and token endpoints share the configured issuer
origin.

On macOS, credentials default to Keychain. Other platforms use plaintext JSON. The file
write is atomic and requests mode `0600` on POSIX systems; users must ensure any existing
or custom parent directory is private. Windows relies on filesystem ACLs rather than
POSIX modes. Refresh tokens are used before expiry or once after an upstream 401.

### Stored-summary reader

The summary client performs one bearer-authenticated GET for the requested UUID. It
extracts ScreenApp's stored CHAPTERS JSON, normalizes chapter values, and falls back to
the recording description. Malformed stored JSON becomes a warning rather than guessed
content.

This route is separated from the MCP proxy because the legacy MCP server removes the
`postProcess` object from its `get_recording` result.

## Trust boundaries

```text
Untrusted MCP arguments
  └─ Zod validation
       ├─ fixed allow-list of upstream read tools
       └─ encoded UUID path segment

Local secret store
  └─ access token / refresh token / OAuth client credentials
       ├─ Authorization header to configured API origin
       └─ never returned in MCP results or diagnostic output

ScreenApp responses
  └─ treated as untrusted JSON
       ├─ protocol SDK validation for MCP
       └─ explicit schemas and safe parsing for summaries
```

The bridge does not accept an arbitrary upstream tool name, execute a configured shell
command to obtain tokens, or expose an HTTP listener beyond the short-lived loopback OAuth
callback.

## Why a local bridge instead of a hosted service?

A hosted version would become a multi-tenant OAuth application holding other people's
ScreenApp refresh tokens. It would need a privacy policy, encrypted server-side secret
storage, tenant isolation, abuse controls, incident response, and a stable public uptime
commitment. None of that is necessary for a desktop compatibility tool. Local stdio is
the narrower and safer design.

## Why not forward every upstream tool dynamically?

The old endpoint advertises AI question-answering tools alongside retrieval tools. A
dynamic mirror could unexpectedly consume credits or return generated interpretations in
an evidence-gathering workflow. The bridge registers an explicit allow-list and gives
each tool a human-readable schema. This also makes upstream changes visible during
testing instead of silently expanding the server's powers.

## Compatibility strategy

The project depends on current MCP v2 server/client packages. Only the upstream transport
is legacy. When ScreenApp retires the SSE endpoint, the upstream adapter can be replaced
without changing the local tool contract or client configuration.
