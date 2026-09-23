# OAuth compatibility: what failed and why this works

## The confusing symptom

The browser can display a successful ScreenApp authorization page while Codex still
reports an OAuth callback or token-exchange failure. Those messages describe two
different steps:

1. The user authorized the client and ScreenApp returned an authorization code.
2. The client attempted to exchange that short-lived code for tokens.

Step 1 can succeed while step 2 fails. A successful dashboard or consent page is therefore
not proof that the MCP client holds a usable access token.

## The client authentication mismatch

ScreenApp's legacy dynamic client registration can return:

```json
{
  "token_endpoint_auth_method": "client_secret_post"
}
```

That method requires the token request to contain the client credentials as form fields:

```text
grant_type=authorization_code
code=...
redirect_uri=...
code_verifier=...
client_id=...
client_secret=...
resource=https://api.screenapp.io/v2/mcp/sse
```

Affected Codex builds instead use HTTP Basic authentication and omit `client_id` and
`client_secret` from the form body. ScreenApp rejects that request as missing required
parameters. The open issue was reproduced on ChatGPT Desktop `26.820.60940` with bundled
Codex `0.150.0-alpha.8`; other versions may behave differently. This status was last
verified on 23 September 2026. The behavior is independently described in
[openai/codex#40928](https://github.com/openai/codex/issues/40928).

The bridge performs the exchange itself and deliberately uses form-body client
authentication. Codex connects locally over stdio and never attempts the upstream OAuth
exchange.

## Security properties of the login flow

- Authorization code with PKCE protects the code from being useful without the verifier.
- A random state value protects the loopback callback from cross-site request forgery.
- The callback binds to `127.0.0.1`, not all network interfaces.
- OAuth issuer, authorization, registration, and token endpoints must share the
  configured issuer origin.
- Client credentials and tokens are not printed.
- The token request uses HTTPS.
- Stored tokens refresh automatically when possible.

## Workspace generation still matters

Fixing OAuth does not make two ScreenApp account generations share data. The current
remote MCP endpoint and the legacy endpoint may authenticate the same email address yet
see different libraries or ID formats. A useful diagnosis is:

1. Confirm which account the browser dashboard shows.
2. Inspect a recording URL or API result. Legacy recordings use UUID identifiers.
3. Call `get_profile` and `list_teams` through the MCP connection.
4. Compare team membership and recording counts, not just the displayed email address.

The term “legacy subscription” in this repository means a workspace whose data is served
by the older UUID API/MCP generation. It does not claim that every customer on a historic
billing plan has the same backend layout.

## Existing tokens

For unattended or temporary testing, `SCREENAPP_ACCESS_TOKEN` overrides saved
credentials. Prefer `auth login` for normal use because it can retain a refresh token.
Avoid putting bearer tokens in shell history, checked-in environment files, MCP config,
screenshots, or issue reports.

If a credential was ever pasted into a public place, revoke or rotate it. Deleting it
from a later Git commit does not remove it from repository history.
