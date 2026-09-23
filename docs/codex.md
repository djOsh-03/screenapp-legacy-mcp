# Codex setup and validation

## 1. Build and authenticate outside Codex

```bash
npm install
npm run build
node dist/cli.js auth login
node dist/cli.js doctor
```

Doing this first separates upstream ScreenApp authentication from MCP client startup. If
`doctor` fails, fix that before editing Codex configuration.

## 2. Use absolute paths

Ask the shell for the real Node and project paths:

```bash
command -v node
pwd
```

In PowerShell:

```powershell
(Get-Command node).Source
(Get-Location).Path
codex mcp add screenapp_legacy -- "C:\absolute\path\to\node.exe" "C:\absolute\project\path\dist\cli.js"
```

Register the local stdio command:

```bash
codex mcp add screenapp_legacy -- \
  /absolute/path/from-command-v-node \
  /absolute/project/path/dist/cli.js
```

This writes the equivalent entry to `~/.codex/config.toml`:

```toml
[mcp_servers.screenapp_legacy]
command = "/absolute/path/from-command-v-node"
args = ["/absolute/project/path/dist/cli.js"]
```

Absolute paths avoid differences between an interactive shell's PATH and the environment
used by a desktop application.

Do not configure `url`, `bearer_token_env_var`, OAuth client credentials, or HTTP headers
for this server. Those settings are for remote MCP servers. This bridge is a local stdio
process.

### Environment overrides

A desktop process may not inherit variables exported in a terminal. Pass non-secret
configuration explicitly when registering the server:

```bash
codex mcp add \
  --env SCREENAPP_CREDENTIAL_STORE=file \
  --env SCREENAPP_CREDENTIALS_FILE=/absolute/private/path/credentials.json \
  screenapp_legacy -- \
  /absolute/path/to/node \
  /absolute/project/path/dist/cli.js
```

Run `auth login` with the same variables first. Do not pass `SCREENAPP_ACCESS_TOKEN`
through `--env`; it would be stored in Codex configuration. The bridge does not load
`.env` files.

PowerShell uses `$env:SCREENAPP_CREDENTIAL_STORE = "file"` and
`$env:SCREENAPP_CREDENTIALS_FILE = "C:\private\screenapp.credentials.json"` for the login
command. The `codex mcp add --env KEY=VALUE` syntax is the same on Windows.

## 3. Restart and verify

After restarting Codex:

1. Confirm `screenapp_legacy` appears in the MCP server list.
2. Ask it to call `get_profile`.
3. Ask it to call `list_teams`.
4. List one recording and retrieve its metadata.
5. Call `get_summary` with a known UUID.

A browser OAuth prompt should not appear during normal tool calls. If it does, Codex is
probably still using a separate remote ScreenApp entry.

## 4. Avoid ambiguous duplicate connections

If you retain both connections, name them clearly:

- `screenapp_current` for `https://screenapp.io/app/api/mcp`
- `screenapp_legacy` for this local bridge

Tell the model which one to use. Otherwise it can call the current connector, receive an
empty library, and incorrectly conclude that no recordings exist.

## Removing the bridge

1. Run `codex mcp remove screenapp_legacy` (or remove that TOML block manually).
2. Restart Codex.
3. On macOS, remove the default credential with
   `security delete-generic-password -s io.github.djosh-03.screenapp-legacy-mcp -a default`.
   For file storage, delete the path reported by `auth status` only after verifying it is
   the intended credential file.
4. Revoke the OAuth client/token in ScreenApp's connected-app settings when available.

Removing the Git checkout alone does not revoke an OAuth token.
