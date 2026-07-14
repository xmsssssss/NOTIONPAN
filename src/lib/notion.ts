import { Client } from "@notionhq/client";
import { getRuntimeEnv, getRuntimeEnvRequired, ensureRuntimeEnvLoaded } from "./runtime-env";

export function getEnv(name: string): string {
  return getRuntimeEnvRequired(name);
}

export function getNotionClient() {
  ensureRuntimeEnvLoaded();
  return new Client({
    auth: getEnv("NOTION_API_KEY"),
  });
}

export function getDatabaseId() {
  return getEnv("NOTION_DATABASE_ID").replace(/-/g, "");
}

export async function getDataSourceId(notion: Client): Promise<string | null> {
  const fromEnv = getRuntimeEnv("NOTION_DATA_SOURCE_ID")?.trim();
  if (fromEnv) return fromEnv;

  try {
    const db = await notion.databases.retrieve({ database_id: getDatabaseId() });
    const dataSources = (db as { data_sources?: Array<{ id: string }> }).data_sources;
    if (dataSources?.[0]?.id) return dataSources[0].id;
  } catch {
    // ignore
  }
  return null;
}

export function richText(content: string) {
  return [{ type: "text" as const, text: { content: content.slice(0, 2000) } }];
}
