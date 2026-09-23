# Security policy

## Supported versions

Security fixes are applied to the current `main` branch and tagged releases starting
with `v0.1.0`.

## Reporting a vulnerability

Please use GitHub's private security-advisory reporting flow for this repository. Do not
open a public issue containing exploit details or credentials.

Include the affected commit/version, reproduction steps using fake credentials, impact,
and any suggested remediation. Do not send real ScreenApp tokens, recording identifiers,
transcripts, or OAuth client secrets.

## Credential handling

- Tokens are local and are never intentionally logged or returned through MCP.
- macOS defaults to Keychain.
- The portable store is plaintext JSON. It requests mode `0600` on POSIX systems; users
  must protect any existing or custom parent directory. Windows relies on the current
  user's filesystem ACLs.
- `SCREENAPP_ACCESS_TOKEN` exists for ephemeral automation; environment variables may be
  visible to other processes with sufficient local privilege.
- OAuth tokens should be revoked when a machine is lost, shared, or decommissioned.

This software cannot protect a token from an attacker who already controls the user's
account or local process environment.

## Scope

The bridge is read-only by construction and omits AI-generation tools. Bugs that expose
credentials, cross origins with authorization headers/cookies, bypass OAuth state checks,
or allow unintended upstream tools are considered security issues.
