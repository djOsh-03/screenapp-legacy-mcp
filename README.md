# ScreenApp Legacy MCP Bridge

A small, local, read-only Model Context Protocol (MCP) server for people whose
ScreenApp recordings live in a legacy, UUID-based workspace.

It solves three problems that can occur together:

1. Codex completes the browser authorization step but the token exchange fails.
2. ScreenApp's current MCP endpoint connects to a different or empty account while
   the recordings remain visible in the older ScreenApp dashboard.
3. The legacy MCP endpoint can read recordings and transcripts, but does not expose
   summaries that ScreenApp has already generated and stored.

The bridge runs on your computer. Codex or Claude talks to it over `stdio`; the
bridge talks to ScreenApp's legacy endpoint using your OAuth token. No credential is
put in the MCP client configuration, and no ScreenApp AI-generation tool is exposed.

> [!IMPORTANT]
> This is an independent compatibility project. It is not an official ScreenApp or
> OpenAI product. ScreenApp's current supported MCP endpoint is
> `https://screenapp.io/app/api/mcp`. Try that first for current workspaces.

## What this fixes

The failure is not one single bug. It is a compatibility gap between two generations
of ScreenApp and one OAuth client behavior.

| Layer | What goes wrong | What this bridge does |
|---|---|---|
| Account/workspace | The current MCP endpoint authenticates successfully but sees an empty library or a different account generation. | Connects specifically to the legacy UUID endpoint at `https://api.screenapp.io/v2/mcp/sse`. |
| OAuth | The legacy authorization server advertises `client_secret_post`, while affected Codex builds send the client secret using HTTP Basic authentication. ScreenApp then reports missing parameters after the browser says authorization succeeded. | Performs the local OAuth flow itself and sends `client_id` and `client_secret` in the token request body, as required by `client_secret_post`. |
| Transport | The older HTTP+SSE MCP transport establishes a session cookie that must be repeated on later POST requests. | Captures the `mcp-session` cookie and sends it only to the same ScreenApp origin. |
| Summaries | Legacy MCP's `get_recording` response omits `postProcess`, even when the dashboard shows a stored summary. | Adds `get_summary`, which reads the already-stored summary from the legacy file response. |
| Cost/safety | The legacy server also advertises tools that ask an AI model questions. | Exposes only read-only retrieval and search tools. AI-generation tools are deliberately omitted. |

The relevant Codex behavior is tracked in
[openai/codex#40928](https://github.com/openai/codex/issues/40928). ScreenApp documents
the [current MCP endpoint](https://screenapp.io/help/mcp-server-setup-guide). The legacy
URL and response behavior in this project are compatibility observations and may change;
they are not presented as ScreenApp's current public contract.

## Architecture at a glance

```text
Codex / Claude Desktop
        │ local stdio; no token in client config
        ▼
ScreenApp Legacy MCP Bridge
        ├── OAuth login + Keychain or owner-readable file credential store
        ├── legacy SSE client + mcp-session cookie preservation
        └── stored-summary compatibility reader
                │ HTTPS + Bearer token
                ▼
        api.screenapp.io/v2
```

This local boundary is intentional. It avoids hosting other people's OAuth tokens,
keeps the bridge easy to audit, and works with desktop MCP clients that can start a
local command.

## Quick start

You need Node.js 20 or newer, Git, and a ScreenApp account that can see the legacy
recordings in the browser.

```bash
git clone https://github.com/djOsh-03/screenapp-legacy-mcp.git
cd screenapp-legacy-mcp
npm install
npm run build
node dist/cli.js auth login
node dist/cli.js doctor
```

The login command registers a dedicated OAuth client, opens ScreenApp in your browser,
and waits on a loopback-only callback. On macOS, the resulting credentials are stored
in Keychain. The `doctor` command confirms the token, legacy SSE session, profile, team
access, and upstream tools without printing profile or recording content.

To verify summary access too, use the UUID shown in a legacy recording URL:

```bash
node dist/cli.js doctor --recording-id 11111111-2222-4333-8444-555555555555
```

The example UUID is deliberately fake. Do not paste private recording IDs into issue
reports.

### Linux and Windows

The same clone, install, build, login, and doctor sequence works on Linux and Windows.
In PowerShell, use `node .\dist\cli.js auth login`. Linux requires `xdg-open` to open the
consent page; if browser launch fails on any platform, rerun with `--no-open` and open the
printed URL manually.

PowerShell equivalents for the path and Codex steps are:

```powershell
(Get-Command node).Source
(Get-Location).Path
codex mcp add screenapp_legacy -- "C:\absolute\path\to\node.exe" "C:\absolute\path\to\screenapp-legacy-mcp\dist\cli.js"
```

For file storage, set `$env:SCREENAPP_CREDENTIAL_STORE = "file"` before `auth login`.
Pass the same non-secret setting to Codex with
`codex mcp add --env SCREENAPP_CREDENTIAL_STORE=file ...`.

macOS is the only platform with an integrated secret store in this release. Linux and
Windows default to a plaintext credentials file under the user's configuration directory.
Use a single-user machine, protect the account and filesystem, and revoke the OAuth token
when the machine is shared or retired.

## Add it to Codex

Find the absolute paths on your machine:

```bash
command -v node
pwd
```

The supported CLI path is:

```bash
codex mcp add screenapp_legacy -- \
  /absolute/path/to/node \
  /absolute/path/to/screenapp-legacy-mcp/dist/cli.js
```

The equivalent manual entry in `~/.codex/config.toml` is:

```toml
[mcp_servers.screenapp_legacy]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/screenapp-legacy-mcp/dist/cli.js"]
```

Restart Codex after changing its MCP configuration. There is no `url`, bearer token,
client ID, or client secret in this block: Codex launches a local stdio server, and the
bridge owns the upstream OAuth compatibility work.

Codex Desktop may not inherit environment variables from your interactive shell. If you
use non-secret overrides such as a file-store location, add them explicitly with
`codex mcp add --env KEY=VALUE ...`. Never place `SCREENAPP_ACCESS_TOKEN` in Codex config;
authenticate to the selected store before launching Codex.

Useful first prompts are:

- “Use `get_profile` and tell me which ScreenApp account is connected.”
- “List my ScreenApp teams, then list five recordings in the relevant team.”
- “Get the stored summary for recording UUID `…`. Do not generate a new summary.”
- “Retrieve the complete transcript, following `nextOffset` until `hasMore` is false.”

See [Codex setup](docs/codex.md) for validation and removal steps.

## Add it to Claude Desktop

Build the project, complete `auth login`, then add a local server to Claude Desktop's
configuration:

```json
{
  "mcpServers": {
    "screenapp-legacy": {
      "command": "/absolute/path/to/node",
      "args": [
        "/absolute/path/to/screenapp-legacy-mcp/dist/cli.js"
      ]
    }
  }
}
```

Save this as `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS or
`%APPDATA%\Claude\claude_desktop_config.json` on Windows, then restart Claude Desktop.
This bridge is mainly needed when the official remote connector cannot see an older UUID
library; current ScreenApp accounts should use the official connector.

## Tools

All tools are annotated read-only, non-destructive, and idempotent.

| Tool | Purpose |
|---|---|
| `get_profile` | Confirm the authenticated ScreenApp identity. |
| `list_teams` | List accessible ScreenApp teams. |
| `get_team` | Read one team's details. |
| `list_recordings` | Page through recordings in the active or selected team. |
| `get_recording` | Read recording metadata, URLs, author, and duration information. |
| `get_transcript` | Read existing transcript text or structured segments, with pagination. |
| `search_recordings` | Search existing transcript content. |
| `get_summary` | Read chapters or description already stored by ScreenApp. |
| `get_usage_stats` | Read usage and billing counters without consuming credits. |

The upstream `assistant_search`, `ask_recording`, and `ask_multiple_recordings` tools are
not exposed. This prevents an apparently read-only archival workflow from silently
turning into paid or quota-consuming AI generation.

## How `get_summary` behaves

For a UUID recording, the bridge reads the legacy file payload and checks:

```text
data.postProcess.systemPromptResponses.CHAPTERS.responseText
```

That value is itself JSON containing chapter titles, timestamps, and notes. If chapters
are absent, the bridge falls back to `data.file.description`. It can return structured
JSON or readable Markdown:

```json
{
  "fileId": "11111111-2222-4333-8444-555555555555",
  "title": "Planning session",
  "available": true,
  "source": "postProcess.systemPromptResponses.CHAPTERS",
  "chapters": [
    {
      "title": "Delivery risks",
      "start": "12:40",
      "end": "18:05",
      "paragraph": "The group compares schedule, supplier, and acceptance risks."
    }
  ],
  "description": "",
  "warnings": []
}
```

It never asks ScreenApp to create a summary. If processing is still underway, the tool
returns `available: false`; retry after ScreenApp's dashboard shows that processing has
finished.

> [!WARNING]
> The file-detail route and `postProcess` shape are an observed legacy web-app interface,
> not a documented public ScreenApp API contract. ScreenApp may change them. The parser
> is defensive, reports malformed stored data as warnings, and never fabricates summary
> text.

## Real-world scenarios

### Archive a meeting library into Markdown

An organisation wants one Markdown file per historical recording, including title,
source, author, duration, transcript, and ScreenApp's existing summary. An MCP client can
page through `list_recordings`, call metadata/transcript/summary for each UUID, and write
the files locally. `get_transcript` pagination prevents long meetings from being
truncated; `get_summary` reuses stored work rather than spending AI credits.

### Diagnose the “connected but empty” account

OAuth can succeed against the current ScreenApp endpoint while returning a new or empty
workspace. Call `get_profile`, then `list_teams`, before assuming data was deleted. If the
browser dashboard uses UUID recording URLs and the current endpoint sees no recordings,
the legacy bridge may be the correct connection boundary.

### Search historical interviews without generating an answer

Use `search_recordings` for exact transcript evidence, then retrieve the relevant
transcript segments. Because assistant-search and question-answering tools are absent,
the model cannot accidentally substitute a fresh generated answer for source evidence.

### Wait for a newly uploaded video

A new upload may exist before transcription and post-processing finish. Metadata can be
available while the transcript or summary is not. Treat that as eventual consistency:
wait until the ScreenApp UI reports completion, then retry the read-only tool.

More worked prompts and automation patterns are in [Examples](docs/examples.md).

## Credential options

The default is macOS Keychain on macOS and a plaintext, owner-readable file elsewhere.
On POSIX systems the file is created with mode `0600`; Windows relies on the user's
filesystem access controls. Prefer Keychain or an equivalent OS secret manager where
available.

| Variable | Meaning |
|---|---|
| `SCREENAPP_CREDENTIAL_STORE` | `keychain` or `file`. |
| `SCREENAPP_KEYCHAIN_SERVICE` | Override the Keychain service name. |
| `SCREENAPP_KEYCHAIN_ACCOUNT` | Override the Keychain account label. |
| `SCREENAPP_CREDENTIALS_FILE` | Override the file-store path. |
| `SCREENAPP_ACCESS_TOKEN` | Use a short-lived token directly; takes precedence over saved credentials. |
| `SCREENAPP_MCP_URL` | Override the legacy MCP URL for testing. |
| `SCREENAPP_API_BASE_URL` | Override the legacy REST base URL for testing. |
| `SCREENAPP_OAUTH_ISSUER` | Override OAuth discovery for testing. |
| `SCREENAPP_OAUTH_RESOURCE` | Override the OAuth resource when testing a different MCP URL. |

The application reads the process environment directly and does not load `.env` files.
Do not put real values in `.env` files committed to Git. The included `.gitignore` blocks
common credential files, but secret hygiene remains your responsibility.

## Development and verification

```bash
npm install
npm run check
node dist/cli.js doctor
```

`npm run check` performs strict type checking, linting, tests with coverage thresholds,
and a production build. The test suite covers OAuth request placement, refresh behavior,
credential permissions, same-origin cookie forwarding, summary parsing, and MCP tool
registration. Live tests are opt-in because they require a private ScreenApp account:

```bash
SCREENAPP_TEST_RECORDING_ID="your-private-uuid" npm run test:live
```

The live smoke test starts the built server over stdio, lists its MCP tools, and calls
`get_summary`. It prints only counts and availability, not the UUID or recording content.

## Limits

- This project targets legacy UUID-based ScreenApp workspaces. It does not replace the
  official current ScreenApp connector.
- The legacy HTTP+SSE transport is deprecated in MCP, but remains necessary for the old
  ScreenApp endpoint. The public-facing local server uses current stdio MCP APIs.
- Stored-summary access depends on an observed legacy response field that may change.
- The bridge is deliberately read-only. It cannot upload, edit, delete, share, or create
  ScreenApp content.
- It does not expose ScreenApp tools that generate AI answers.

For deeper detail, read [Architecture](docs/architecture.md),
[OAuth compatibility](docs/oauth.md), and
[Troubleshooting](docs/troubleshooting.md).

## License

MIT. See [LICENSE](LICENSE).
