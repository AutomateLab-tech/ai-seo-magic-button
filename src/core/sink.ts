// Optional agency-os / Notion sink (AL-726).
//
// If the user runs agency-os (a Notion Tasks DB), push each plan item in as a
// task so it flows Suggestion -> To-Do -> Done and their agent works the board.
// MUST degrade gracefully to a local checklist when no sink is configured, so
// the product never depends on Notion. Dogfoods agency-os rather than leaking
// any internal board wiring.

import { writeFile } from "node:fs/promises";
import { planToMarkdown } from "./plan.js";
import type { Plan } from "./schema.js";

export type SinkBackend = "agency-os" | "local";

export interface SinkResult {
  backend: SinkBackend;
  pushed: number;
  detail: string;
  output_path?: string;
}

// Detect an agency-os/Notion sink from the environment. We deliberately read
// only generic, publicly-documented agency-os env vars — never an internal board.
function detectAgencyOs(): { token: string; dataSource: string } | null {
  const token = process.env.NOTION_TOKEN || process.env.NOTION_KEY;
  const dataSource = process.env.AGENCY_OS_TASKS_DS || process.env.NOTION_TASKS_DATA_SOURCE_ID;
  if (token && dataSource) return { token, dataSource };
  return null;
}

export async function pushToSink(
  plan: Plan,
  opts: { backend?: SinkBackend; checklistPath?: string } = {}
): Promise<SinkResult> {
  const agency = opts.backend === "local" ? null : detectAgencyOs();

  if (agency) {
    // agency-os present: create one task per item via the Notion API.
    let pushed = 0;
    for (const item of plan.items) {
      const ok = await createNotionTask(agency, plan, item).catch(() => false);
      if (ok) pushed++;
    }
    return {
      backend: "agency-os",
      pushed,
      detail: `pushed ${pushed}/${plan.items.length} items into the agency-os Tasks DB`,
    };
  }

  // Graceful degradation: write a local markdown checklist.
  const path = opts.checklistPath ?? "plan.md";
  await writeFile(path, planToMarkdown(plan), "utf8");
  return {
    backend: "local",
    pushed: plan.items.length,
    detail: "no agency-os sink configured; wrote local checklist",
    output_path: path,
  };
}

async function createNotionTask(
  agency: { token: string; dataSource: string },
  plan: Plan,
  item: Plan["items"][number]
): Promise<boolean> {
  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${agency.token}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      parent: { type: "data_source_id", data_source_id: agency.dataSource },
      properties: {
        Title: { title: [{ text: { content: `[AI-SEO] ${item.title}` } }] },
        Status: { status: { name: "Suggestion" } },
      },
      children: [
        {
          object: "block",
          type: "paragraph",
          paragraph: { rich_text: [{ text: { content: `${item.rationale}\n\nURL: ${item.url}\nDone when: ${item.acceptance}` } }] },
        },
      ],
    }),
  });
  return res.ok;
}
