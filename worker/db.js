import { fail } from "./http.js";

function endpoint(databaseUrl) {
  return `${String(databaseUrl || "").replace(/^libsql:\/\//, "https://").replace(/\/$/, "")}/v2/pipeline`;
}

function bind(value) {
  if (value === null || value === undefined) return { type: "null" };
  if (typeof value === "boolean") return { type: "integer", value: value ? "1" : "0" };
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value)
      ? { type: "integer", value: String(value) }
      : { type: "float", value: String(value) };
  }
  return { type: "text", value: String(value) };
}

function cell(value) {
  if (!value || value.type === "null" || value.value == null) return null;
  if (value.type === "integer" || value.type === "float") return Number(value.value);
  return value.value;
}

function rowsOf(result) {
  const exec = result?.response?.result || {};
  const cols = (exec.cols || []).map((col) => col.name);
  const rows = (exec.rows || []).map((row) => {
    const item = {};
    cols.forEach((name, index) => {
      item[name] = cell(row[index]);
    });
    return item;
  });
  return { rows, rowsAffected: exec.affected_row_count || 0 };
}

export async function pipeline(env, statements) {
  if (!env.TURSO_DATABASE_URL || !env.TURSO_AUTH_TOKEN) {
    throw fail("Banco não configurado", 503);
  }
  const response = await fetch(endpoint(env.TURSO_DATABASE_URL), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.TURSO_AUTH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requests: [
        ...statements.map((statement) => ({
          type: "execute",
          stmt: { sql: statement.sql, args: (statement.args || []).map(bind) },
        })),
        { type: "close" },
      ],
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("[turso]", response.status, statements[0]?.sql?.slice(0, 80) || "");
    throw fail("Falha no banco", 500);
  }
  const results = data.results || [];
  const parsed = [];
  for (let i = 0; i < statements.length; i++) {
    const result = results[i];
    if (!result || result.type === "error") {
      console.error("[turso]", JSON.stringify(result || data).slice(0, 500));
      const raw = String(result?.error?.message || result?.error || "Falha no banco");
      const unique = /UNIQUE constraint failed/i.test(raw);
      const error = fail(unique ? raw : "Falha no banco", unique ? 409 : 500);
      error.code = unique ? "unique" : "db";
      throw error;
    }
    parsed.push(rowsOf(result));
  }
  return parsed;
}

export async function execute(env, sql, args) {
  const [result] = await pipeline(env, [{ sql, args }]);
  return result;
}

export async function one(env, sql, args) {
  const result = await execute(env, sql, args);
  return result.rows[0] || null;
}

export async function many(env, sql, args) {
  const result = await execute(env, sql, args);
  return result.rows;
}

export async function transaction(env, statements) {
  const results = await pipeline(env, [
    { sql: "BEGIN" },
    ...statements,
    { sql: "COMMIT" },
  ]);
  return results.slice(1, -1);
}
