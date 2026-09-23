import * as z from "zod/v4";

import type { CredentialManager } from "../auth/manager.js";
import type { AppConfig } from "../config.js";
import { HTTP_REQUEST_TIMEOUT_MS } from "../constants.js";
import { ScreenAppBridgeError } from "../errors.js";
import type { FetchImplementation } from "./session-fetch.js";

const rawChapterSchema = z.object({
  title: z.union([z.string(), z.number()]).optional(),
  start: z.union([z.string(), z.number()]).optional(),
  end: z.union([z.string(), z.number()]).optional(),
  notes: z.union([z.string(), z.number()]).optional(),
});

const chaptersResponseSchema = z.object({
  chapters: z.array(rawChapterSchema),
});

export const summaryChapterSchema = z.object({
  title: z.string(),
  start: z.string(),
  end: z.string(),
  paragraph: z.string(),
});

export const storedSummarySchema = z.object({
  fileId: z.string(),
  title: z.string(),
  available: z.boolean(),
  source: z
    .enum(["postProcess.systemPromptResponses.CHAPTERS", "file.description"])
    .nullable(),
  chapters: z.array(summaryChapterSchema),
  description: z.string(),
  warnings: z.array(z.string()),
});

export type StoredSummary = z.infer<typeof storedSummarySchema>;

function asString(value: string | number | undefined): string {
  return value === undefined ? "" : String(value).trim();
}

export function parseStoredSummary(fileId: string, payload: unknown): StoredSummary {
  const root =
    typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>)
      : {};
  const data =
    typeof root.data === "object" && root.data !== null
      ? (root.data as Record<string, unknown>)
      : {};
  const file =
    typeof data.file === "object" && data.file !== null
      ? (data.file as Record<string, unknown>)
      : {};
  const postProcess =
    typeof data.postProcess === "object" && data.postProcess !== null
      ? (data.postProcess as Record<string, unknown>)
      : {};
  const promptResponses =
    typeof postProcess.systemPromptResponses === "object" &&
    postProcess.systemPromptResponses !== null
      ? (postProcess.systemPromptResponses as Record<string, unknown>)
      : {};
  const chaptersRecord =
    typeof promptResponses.CHAPTERS === "object" &&
    promptResponses.CHAPTERS !== null
      ? (promptResponses.CHAPTERS as Record<string, unknown>)
      : {};

  const warnings: string[] = [];
  let rawChapters: z.infer<typeof rawChapterSchema>[] = [];
  if (typeof chaptersRecord.responseText === "string") {
    try {
      const parsed = chaptersResponseSchema.safeParse(
        JSON.parse(chaptersRecord.responseText),
      );
      if (parsed.success) rawChapters = parsed.data.chapters;
      else warnings.push("The stored CHAPTERS response had an unexpected shape.");
    } catch {
      warnings.push("The stored CHAPTERS response was not valid JSON.");
    }
  }

  const chapters = rawChapters
    .map((chapter) => ({
      title: asString(chapter.title) || "Summary",
      start: asString(chapter.start),
      end: asString(chapter.end),
      paragraph: asString(chapter.notes),
    }))
    .filter((chapter) => chapter.title !== "Summary" || chapter.paragraph);
  const description = typeof file.description === "string" ? file.description.trim() : "";

  return {
    fileId,
    title: typeof file.name === "string" ? file.name.trim() : "",
    available: chapters.length > 0 || description.length > 0,
    source:
      chapters.length > 0
        ? "postProcess.systemPromptResponses.CHAPTERS"
        : description
          ? "file.description"
          : null,
    chapters,
    description,
    warnings,
  };
}

export function summaryAsMarkdown(summary: StoredSummary): string {
  if (!summary.available) return "";
  if (summary.chapters.length === 0) return summary.description;
  return summary.chapters
    .map((chapter) => {
      const timestamp = chapter.start ? ` (${chapter.start})` : "";
      const heading = chapter.title.replace(/\s+/g, " ").replace(/^#+\s*/, "");
      return `### ${heading}${timestamp}\n\n${chapter.paragraph}`;
    })
    .join("\n\n");
}

export class ScreenAppSummaryClient {
  constructor(
    private readonly config: AppConfig,
    private readonly credentials: CredentialManager,
    private readonly fetchImplementation: FetchImplementation = fetch,
  ) {}

  async getSummary(fileId: string): Promise<StoredSummary> {
    const url = new URL(
      `files/${encodeURIComponent(fileId)}`,
      `${this.config.apiBaseUrl.toString().replace(/\/$/, "")}/`,
    );
    const response = await this.fetchImplementation(url, {
      redirect: "error",
      signal: AbortSignal.timeout(HTTP_REQUEST_TIMEOUT_MS),
      headers: {
        accept: "application/json",
        authorization: `Bearer ${await this.credentials.getAccessToken()}`,
      },
    });
    if (!response.ok) {
      throw new ScreenAppBridgeError(
        `ScreenApp returned HTTP ${String(response.status)} while reading recording ${fileId}.`,
        "SUMMARY_REQUEST_FAILED",
      );
    }
    return parseStoredSummary(fileId, await response.json());
  }
}
