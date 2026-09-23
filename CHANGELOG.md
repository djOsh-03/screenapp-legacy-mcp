# Changelog

All notable changes to this project are documented here.

## [0.1.1] - 2026-09-23

### Fixed

- Made the credentials-path test portable across Windows, macOS, and Linux so the full
  public CI matrix passes.

## [0.1.0] - 2026-09-23

### Added

- Local read-only MCP bridge for legacy UUID-based ScreenApp workspaces.
- OAuth authorization-code login with PKCE and correct `client_secret_post` exchange.
- macOS Keychain and portable owner-only file credential stores with token refresh.
- Legacy HTTP+SSE session-cookie preservation.
- Stored-summary retrieval with structured JSON and Markdown output.
- Explicit retrieval/search tool allow-list that omits AI-generation tools.
- Doctor command, strict validation, automated tests, CI, and human-friendly guides.
