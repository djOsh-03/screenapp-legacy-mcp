#!/usr/bin/env node

import { loadConfig } from "./config.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "./constants.js";
import { toSafeErrorMessage } from "./errors.js";
import {
  CredentialManager,
  createCredentialStore,
} from "./auth/manager.js";
import { loginWithLegacyOAuth } from "./auth/oauth.js";
import { runStdioServer } from "./server.js";
import { ScreenAppSummaryClient } from "./screenapp/summary.js";
import { ScreenAppUpstreamClient } from "./screenapp/upstream-client.js";

const help = `
${PACKAGE_NAME} ${PACKAGE_VERSION}

Usage:
  screenapp-legacy-mcp                 Start the local stdio MCP server
  screenapp-legacy-mcp auth login      Authorize a legacy ScreenApp workspace
  screenapp-legacy-mcp auth status     Check whether credentials are available
  screenapp-legacy-mcp doctor          Test OAuth, SSE, tools, and optional summaries

Options:
  --no-open                            Print the OAuth URL instead of opening it
  --recording-id <uuid>                Test stored-summary access in doctor
  --help                               Show this help
  --version                            Print the version

Credential settings are controlled with environment variables. See README.md.
`.trim();

function valueAfter(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function runDoctor(
  upstream: ScreenAppUpstreamClient,
  summaries: ScreenAppSummaryClient,
  recordingId?: string,
): Promise<void> {
  try {
    const names = await upstream.listToolNames();
    const required = ["get_profile", "list_teams", "get_recording", "get_transcript"];
    const missing = required.filter((name) => !names.includes(name));
    if (missing.length > 0) {
      throw new Error(`Legacy MCP is missing expected tools: ${missing.join(", ")}`);
    }
    const profile = await upstream.callTool("get_profile");
    if (profile.isError) throw new Error("ScreenApp rejected get_profile.");
    const teams = await upstream.callTool("list_teams");
    if (teams.isError) throw new Error("ScreenApp rejected list_teams.");

    process.stdout.write("PASS OAuth token accepted\n");
    process.stdout.write("PASS legacy SSE session established\n");
    process.stdout.write(`PASS ${String(names.length)} upstream tools discovered\n`);
    process.stdout.write("PASS profile and team access confirmed\n");

    if (recordingId) {
      const summary = await summaries.getSummary(recordingId);
      process.stdout.write(
        `PASS stored-summary endpoint reachable (available: ${String(summary.available)}, chapters: ${String(summary.chapters.length)})\n`,
      );
    } else {
      process.stdout.write(
        "SKIP stored-summary content check (pass --recording-id <uuid>)\n",
      );
    }
  } finally {
    await upstream.close();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args[0] === "help") {
    process.stdout.write(`${help}\n`);
    return;
  }
  if (args.includes("--version")) {
    process.stdout.write(`${PACKAGE_VERSION}\n`);
    return;
  }

  const config = loadConfig();
  const store = createCredentialStore(config);

  if (args[0] === "auth" && args[1] === "login") {
    const openBrowser = !args.includes("--no-open");
    process.stderr.write(
      `Starting ScreenApp legacy OAuth. Credentials will be saved in ${store.description}.\n`,
    );
    await loginWithLegacyOAuth(config, store, {
      openBrowser,
      onAuthorizationUrl: (url) => {
        process.stderr.write(
          openBrowser
            ? "Opening ScreenApp authorization in your browser…\n"
            : `Open this URL in your browser:\n${url.toString()}\n`,
        );
      },
    });
    process.stdout.write("ScreenApp authorization completed successfully.\n");
    return;
  }

  if (args[0] === "auth" && args[1] === "status") {
    if (config.accessToken) {
      process.stdout.write("Authenticated with SCREENAPP_ACCESS_TOKEN.\n");
      return;
    }
    const credentials = await store.read();
    if (!credentials) {
      process.stdout.write(`No credentials found in ${store.description}.\n`);
      process.exitCode = 1;
      return;
    }
    const expiry = credentials.expiresAt
      ? new Date(credentials.expiresAt).toISOString()
      : "not supplied";
    process.stdout.write(
      `Credentials found in ${store.description}. Expiry: ${expiry}. Refresh token: ${credentials.refreshToken ? "yes" : "no"}.\n`,
    );
    return;
  }

  const credentials = new CredentialManager(config, store);
  const upstream = new ScreenAppUpstreamClient(config, credentials);
  const summaries = new ScreenAppSummaryClient(config, credentials);

  if (args[0] === "doctor") {
    const recordingId = valueAfter(args, "--recording-id");
    if (args.includes("--recording-id") && !recordingId) {
      throw new Error("--recording-id requires a value.");
    }
    await runDoctor(upstream, summaries, recordingId);
    return;
  }

  if (args.length > 0) {
    throw new Error(`Unknown command: ${args.join(" ")}\n\n${help}`);
  }
  await runStdioServer({ upstream, summaries });
}

main().catch((error: unknown) => {
  process.stderr.write(`Error: ${toSafeErrorMessage(error)}\n`);
  process.exitCode = 1;
});
