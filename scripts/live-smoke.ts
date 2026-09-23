import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import * as z from "zod/v4";

const recordingId = process.env.SCREENAPP_TEST_RECORDING_ID?.trim();
if (!recordingId) {
  throw new Error(
    "Set SCREENAPP_TEST_RECORDING_ID to a private UUID recording before running the live smoke test.",
  );
}

const childEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  ),
);
const serverPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const client = new Client({ name: "screenapp-live-smoke", version: "0.1.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  env: childEnvironment,
  stderr: "pipe",
});

try {
  await client.connect(transport);
  const tools = (await client.listTools()).tools;
  if (!tools.some(({ name }) => name === "get_summary")) {
    throw new Error("The local MCP server did not advertise get_summary.");
  }

  const result = await client.callTool({
    name: "get_summary",
    arguments: { fileId: recordingId, format: "json" },
  });
  if (result.isError || !result.structuredContent) {
    throw new Error("The live get_summary MCP call failed.");
  }
  const summary = z
    .object({ available: z.boolean(), chapters: z.array(z.unknown()) })
    .parse(result.structuredContent);
  const available = summary.available;
  const chapterCount = summary.chapters.length;
  process.stdout.write(
    `PASS local stdio MCP advertised ${String(tools.length)} tools\n` +
      `PASS live get_summary returned structured content (available: ${String(available)}, chapters: ${String(chapterCount)})\n`,
  );
} finally {
  await client.close();
}
