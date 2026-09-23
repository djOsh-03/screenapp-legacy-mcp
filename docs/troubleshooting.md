# Troubleshooting

Start with:

```bash
npm run build
node dist/cli.js auth status
node dist/cli.js doctor
```

`doctor` intentionally reports checks rather than private profile or recording data.

## Browser says success, terminal says token exchange failed

Make sure you are running this project's `auth login`, not `codex mcp login` against the
legacy URL. The bridge exists specifically to perform the legacy `client_secret_post`
exchange correctly.

If the problem persists, test with a separate store instead of destroying the old one:

```bash
# macOS: create a separate Keychain item
SCREENAPP_KEYCHAIN_ACCOUNT=screenapp-retry node dist/cli.js auth login

# any platform: create a separate file
SCREENAPP_CREDENTIAL_STORE=file \
SCREENAPP_CREDENTIALS_FILE="$HOME/.config/screenapp-legacy-mcp/retry.credentials.json" \
node dist/cli.js auth login
```

Use the same variables for `doctor`. Each login dynamically registers an OAuth client;
revoke abandoned clients/tokens in ScreenApp when possible, then securely remove the old
local item. Do not post client secrets or callback URLs containing codes in an issue.

## The connection works but the library is empty

Call `get_profile` and `list_teams`. Verify:

- The authenticated account is the expected one.
- The recordings belong to a listed team.
- You passed that team's ID to `list_recordings` or `search_recordings`.
- The browser dashboard and MCP connection refer to the same ScreenApp generation.

An email match is not sufficient evidence when data has moved between account systems.

## `doctor` cannot establish the SSE session

Possible causes include an expired/revoked token, a network proxy that terminates SSE, or
a ScreenApp endpoint change. Try `auth login` again. If ordinary HTTPS works but SSE is
consistently interrupted, inspect VPN or corporate proxy behavior.

The bridge must receive and replay `mcp-session`. A generic HTTP client that discards the
cookie can open the stream but fail every later tool call.

## A recording has no transcript

The bridge only reads transcripts that ScreenApp already created. Check the recording in
the ScreenApp dashboard. If it is still uploading, transcribing, or post-processing, wait
for completion and retry.

For long transcripts, inspect `hasMore` and continue with `nextOffset`. A successful first
call is not proof that the final pages were retrieved.

## `get_summary` says no stored summary is available

Possible explanations:

- ScreenApp has not finished post-processing.
- The recording predates summary generation.
- The summary is stored in a different shape.
- ScreenApp changed the legacy file-detail response.

Open the recording in ScreenApp. If the dashboard does not show a summary, the bridge
will not invent one. If the dashboard does show one, run `doctor --recording-id <uuid>`
and open an issue containing only software versions and the safe diagnostic result.

## Codex reports that the local server exited

Run the exact configured command in Terminal. Common causes are:

- The `dist` directory does not exist because `npm run build` was not run.
- Codex uses a different Node binary or cannot find `node`.
- A relative project path was configured.
- The configured credentials store is unavailable to the desktop process.

Use absolute paths for both Node and `dist/cli.js`.

## Keychain is not available

Use the file store:

```bash
export SCREENAPP_CREDENTIAL_STORE=file
node dist/cli.js auth login
```

The default file is under `~/.config/screenapp-legacy-mcp/credentials.json`. It is
plaintext and is created with mode `0600` on POSIX systems; Windows relies on filesystem
ACLs. You can override it with `SCREENAPP_CREDENTIALS_FILE`.

## Reporting a bug safely

Include:

- operating system and Node version;
- package version or Git commit;
- the command category (`auth login`, `doctor`, or MCP startup);
- HTTP status and safe error code;
- whether the dashboard shows a UUID-based recording;
- whether current ScreenApp MCP works for a different library.

Never include access tokens, refresh tokens, OAuth client secrets, authorization codes,
full callback URLs, private recording IDs, transcript text, or the contents of the
credential store.
