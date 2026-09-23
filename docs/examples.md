# Examples and scenarios

These examples describe prompts for an MCP-capable assistant. Tool names are shown so you
can verify what the assistant actually called.

## Inventory an old team library

Prompt:

> Use the ScreenApp legacy connection. Call `list_teams`, identify the team named
> “Operations”, then page through `list_recordings` in batches of 20. Return a table with
> recording UUID, title, owner, creation date, and duration. Do not call AI question-answering
> tools.

Why it works: team discovery prevents searching the last-active team by accident, and
pagination avoids interpreting the first page as the complete library.

## Create one Markdown reference page per recording

Prompt:

> For each recording in this team, call `get_recording`, retrieve every page from
> `get_transcript`, and call `get_summary` with `format: "markdown"`. Create one local
> Markdown file named from the recording title. Include Title, Source, Author, Duration,
> Transcription, and Summary. If a stored summary is unavailable, write that fact; do not
> generate a replacement.

Important implementation details:

- Sanitize `/`, `:`, and other platform-invalid filename characters.
- Detect duplicate titles before writing files.
- Continue transcripts until `hasMore` is false.
- Keep the ScreenApp UUID or source URL in the file for traceability.
- Treat a missing summary as a source-data condition, not an invitation to invent one.

## Find firsthand evidence across interviews

Prompt:

> Search the “Research” team for the exact phrase “handover risk” using
> `search_recordings`. For each match, retrieve the surrounding transcript. Report the
> recording title, speaker, timestamp, and exact source passage. Separate source evidence
> from your interpretation.

This uses transcript search rather than the omitted `assistant_search` tool. It is useful
for evidence-bound research where a generated conversational answer would hide source
boundaries.

## Confirm the right account before a bulk export

Prompt:

> Before reading any recordings, call `get_profile` and `list_teams`. Show me the account
> identity and team names and stop for confirmation.

This is a good operational gate when the same person has multiple ScreenApp accounts or
when the current and legacy endpoints show different workspaces.

## Poll a newly processed recording carefully

Prompt:

> Read metadata, transcript availability, and stored-summary availability for this UUID.
> If either source is still unavailable, report which processing stage appears incomplete
> and stop. Do not ask ScreenApp AI to generate missing content.

The MCP protocol call itself is synchronous; repeated polling should be paced by the
human or an explicitly authorized scheduler. This repository does not start background
polling jobs.

## Check quota before a large read

Prompt:

> Call `get_usage_stats` and explain the current counters. Do not perform writes or call
> AI-generation tools.

The bridge's tool is read-only. It does not reserve credits or enable recurring work.
