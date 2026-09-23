# Contributing

Thank you for improving the bridge. Small, auditable changes are preferred because this
project handles OAuth credentials and private recording metadata.

## Development setup

```bash
npm install
npm run check
```

Use Node.js 20 or newer. Add tests for behavior changes. Live ScreenApp testing must be
opt-in and must never commit account data, UUIDs, transcripts, response fixtures copied
from a real workspace, or credentials.

## Design rules

- Keep the MCP surface read-only.
- Do not expose upstream AI-generation tools by default.
- Never log tokens or OAuth authorization codes.
- Keep cookies and authorization headers restricted to the configured ScreenApp origin.
- Validate untrusted MCP inputs and ScreenApp responses.
- Prefer plain TypeScript and focused modules over framework layers.
- Document whether an endpoint is public, official, observed, or legacy.

## Pull requests

Explain the user-visible problem, the compatibility behavior changed, security impact,
tests run, and any live verification performed. Use fake IDs and redacted output in all
examples.
