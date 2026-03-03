import * as SQLite from 'expo-sqlite';

const db = SQLite.openDatabaseSync('omni-costs.db');

let initialized = false;

async function ensureInitialized() {
  if (initialized) {
    return;
  }
  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS cloud_cost_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      route TEXT NOT NULL,
      model_id TEXT NOT NULL,
      usd_cost REAL NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL
    );`
  );
  initialized = true;
}

export type CostSummary = {
  totalCostUsd: number;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
};

export async function addCostEvent({
  route,
  modelId,
  usdCost,
  inputTokens,
  outputTokens,
}: {
  route: string;
  modelId: string;
  usdCost: number;
  inputTokens: number;
  outputTokens: number;
}) {
  await ensureInitialized();
  await db.runAsync(
    `INSERT INTO cloud_cost_events (created_at, route, model_id, usd_cost, input_tokens, output_tokens)
     VALUES (?, ?, ?, ?, ?, ?)`,
    new Date().toISOString(),
    route,
    modelId,
    usdCost,
    inputTokens,
    outputTokens
  );
}

export async function getCostSummary(): Promise<CostSummary> {
  await ensureInitialized();
  const row = await db.getFirstAsync<{
    totalCostUsd: number | null;
    totalRequests: number | null;
    totalInputTokens: number | null;
    totalOutputTokens: number | null;
  }>(
    `SELECT
      COALESCE(SUM(usd_cost), 0) as totalCostUsd,
      COUNT(*) as totalRequests,
      COALESCE(SUM(input_tokens), 0) as totalInputTokens,
      COALESCE(SUM(output_tokens), 0) as totalOutputTokens
    FROM cloud_cost_events`
  );
  return {
    totalCostUsd: row?.totalCostUsd ?? 0,
    totalRequests: row?.totalRequests ?? 0,
    totalInputTokens: row?.totalInputTokens ?? 0,
    totalOutputTokens: row?.totalOutputTokens ?? 0,
  };
}
