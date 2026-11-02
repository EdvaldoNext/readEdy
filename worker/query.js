import { userFromRequest } from "./auth.js";
import { execute, many, one } from "./db.js";
import { fail, json, parseJson, readJson } from "./http.js";

const USER_TABLES = {
  documents: {
    select: true,
    insert: ["id", "title", "storage_path", "bytes", "num_pages", "last_page"],
    update: ["last_page", "num_pages", "deleted_at", "title"],
    remove: true,
    filters: ["id", "user_id", "deleted_at", "storage_path"],
    order: ["updated_at", "created_at"],
  },
  user_preferences: {
    select: true,
    upsert: ["theme", "tts_rate", "continuous_read", "voice_key"],
    filters: ["user_id"],
    order: ["updated_at"],
  },
  subscriptions: {
    select: true,
    filters: ["user_id", "status", "id"],
    order: ["created_at", "updated_at"],
  },
  usage_logs: {
    insert: ["event_type", "metadata"],
  },
};

const ADMIN_VIEWS = new Set([
  "admin_visits_daily",
  "admin_visits_geo",
  "admin_clients_summary",
  "admin_user_storage",
  "admin_subscriptions_summary",
  "admin_dashboard_daily",
  "admin_project_storage",
]);

function isAdmin(user) {
  return parseJson(user && user.app_metadata, {}).role === "admin";
}

function column(name, allowed) {
  if (!allowed || !allowed.includes(name)) throw fail("Consulta inválida", 400);
  return name;
}

function where(filters, allowed, args) {
  const parts = [];
  for (const filter of filters || []) {
    const name = column(filter.column, allowed);
    if (filter.op === "eq") {
      parts.push(`${name} = ?`);
      args.push(filter.value ?? null);
    } else if (filter.op === "is") {
      if (filter.value == null) parts.push(`${name} IS NULL`);
      else {
        parts.push(`${name} = ?`);
        args.push(filter.value);
      }
    } else if (filter.op === "in") {
      const values = Array.isArray(filter.value) ? filter.value : [];
      if (!values.length) {
        parts.push("0");
      } else {
        parts.push(`${name} IN (${values.map(() => "?").join(", ")})`);
        args.push(...values);
      }
    } else {
      throw fail("Filtro inválido", 400);
    }
  }
  return parts;
}

function limitOf(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 500;
  return Math.min(500, Math.floor(number));
}

function finish(rows, mode) {
  if (mode === "one" || mode === "maybe") {
    if (rows.length > 1) return { data: null, error: { message: "Mais de um registro encontrado" } };
    if (!rows.length) {
      return mode === "one"
        ? { data: null, error: { message: "Documento não encontrado" } }
        : { data: null, error: null };
    }
    return { data: rows[0], error: null };
  }
  return { data: rows, error: null };
}

async function planLimits(env, userId) {
  const row = await one(
    env,
    `SELECT p.max_pdfs, p.storage_mb
     FROM subscriptions s
     JOIN plans p ON p.id = s.plan_id
     WHERE s.user_id = ? AND s.status IN ('pending', 'active', 'past_due')
     ORDER BY s.created_at DESC
     LIMIT 1`,
    [userId],
  );
  const maxPdfs = row && row.max_pdfs ? Number(row.max_pdfs) : 3;
  const maxMb = row && row.storage_mb ? Number(row.storage_mb) : 45;
  return { maxPdfs, maxBytes: maxMb * 1024 * 1024, maxMb };
}

export async function assertUploadQuota(env, user, extraBytes) {
  if (isAdmin(user)) return;
  const userId = user && user.id;
  if (!userId) throw fail("Unauthorized", 401);
  const rows = await many(env, "SELECT bytes FROM documents WHERE user_id = ?", [userId]);
  const limits = await planLimits(env, userId);
  if (rows.length >= limits.maxPdfs) {
    throw fail(`Limite do plano: máximo ${limits.maxPdfs} PDFs na nuvem.`, 400);
  }
  const used = rows.reduce((sum, row) => sum + (Number(row.bytes) || 0), 0);
  if (used + (Number(extraBytes) || 0) > limits.maxBytes) {
    throw fail(`Limite do plano: máximo ${limits.maxMb} MB na nuvem.`, 400);
  }
}

export function ownedPath(userId, path) {
  const value = String(path || "");
  if (!value.startsWith(`${userId}/`) || value.includes("..")) {
    throw fail("Caminho de arquivo inválido", 400);
  }
  return value;
}

async function selectSubscriptions(env, user, body) {
  const args = [user.id];
  const filters = (body.filters || []).filter((filter) => filter.column !== "user_id");
  const parts = where(filters, USER_TABLES.subscriptions.filters, args);
  let sql = `SELECT s.id, s.status, s.current_period_end, s.trial_ends_at, s.created_at,
                    p.slug AS plan_slug, p.name AS plan_name, p.price_brl, p.billing_interval,
                    p.storage_mb AS plan_storage_mb, p.max_pdfs AS plan_max_pdfs
             FROM subscriptions s
             LEFT JOIN plans p ON p.id = s.plan_id
             WHERE s.user_id = ?`;
  if (parts.length) sql += ` AND ${parts.join(" AND ")}`;
  if (body.order && body.order.column) {
    const name = column(body.order.column, USER_TABLES.subscriptions.order);
    sql += ` ORDER BY s.${name} ${body.order.ascending === false ? "DESC" : "ASC"}`;
  }
  sql += " LIMIT ?";
  args.push(limitOf(body.limit));
  const rows = await many(env, sql, args);
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    current_period_end: row.current_period_end,
    trial_ends_at: row.trial_ends_at,
    created_at: row.created_at,
    plan: row.plan_slug ? {
      slug: row.plan_slug,
      name: row.plan_name,
      price_brl: row.price_brl,
      billing_interval: row.billing_interval,
      storage_mb: row.plan_storage_mb,
      max_pdfs: row.plan_max_pdfs,
    } : null,
  }));
}

async function handleUserTable(env, user, body) {
  const spec = USER_TABLES[body.table];
  if (!spec) throw fail("Tabela não disponível", 403);
  const action = body.action;
  if (body.table === "subscriptions") {
    if (action !== "select") throw fail("Operação não permitida", 403);
    return finish(await selectSubscriptions(env, user, body), body.mode);
  }
  if (body.table === "usage_logs") {
    if (action !== "insert") throw fail("Operação não permitida", 403);
    const payload = body.payload || {};
    const metadata = payload.metadata && typeof payload.metadata === "object"
      ? JSON.stringify(payload.metadata)
      : String(payload.metadata || "{}");
    await execute(
      env,
      "INSERT INTO usage_logs (id, user_id, event_type, metadata) VALUES (?, ?, ?, ?)",
      [crypto.randomUUID(), user.id, String(payload.event_type || ""), metadata],
    );
    return { data: null, error: null };
  }
  if (body.table === "user_preferences" && action === "upsert") {
    const payload = body.payload || {};
    const continuous = payload.continuous_read == null ? 1 : (payload.continuous_read ? 1 : 0);
    await execute(
      env,
      `INSERT INTO user_preferences (user_id, theme, tts_rate, continuous_read, voice_key)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         theme = excluded.theme,
         tts_rate = excluded.tts_rate,
         continuous_read = excluded.continuous_read,
         voice_key = excluded.voice_key`,
      [
        user.id,
        payload.theme || "light",
        payload.tts_rate == null ? 1 : Number(payload.tts_rate),
        continuous,
        payload.voice_key || null,
      ],
    );
    return { data: null, error: null };
  }
  if (action === "select" && spec.select) {
    const args = [user.id];
    const filters = (body.filters || []).filter((filter) => filter.column !== "user_id");
    const parts = where(filters, spec.filters, args);
    let sql = `SELECT * FROM ${body.table} WHERE user_id = ?`;
    if (parts.length) sql += ` AND ${parts.join(" AND ")}`;
    if (body.order && body.order.column) {
      const name = column(body.order.column, spec.order);
      sql += ` ORDER BY ${name} ${body.order.ascending === false ? "DESC" : "ASC"}`;
    }
    sql += " LIMIT ?";
    args.push(limitOf(body.limit));
    return finish(await many(env, sql, args), body.mode);
  }
  if (action === "insert" && spec.insert) {
    const payload = body.payload || {};
    const id = payload.id || crypto.randomUUID();
    ownedPath(user.id, payload.storage_path);
    await assertUploadQuota(env, user, payload.bytes);
    await execute(
      env,
      `INSERT INTO documents
        (id, user_id, title, storage_path, bytes, num_pages, last_page)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        user.id,
        String(payload.title || "documento.pdf"),
        payload.storage_path,
        Number(payload.bytes) || 0,
        payload.num_pages == null ? null : Number(payload.num_pages),
        payload.last_page == null ? 1 : Number(payload.last_page),
      ],
    );
    return finish([{ id }], body.mode || "one");
  }
  if (action === "update" && spec.update) {
    const payload = body.payload || {};
    const setSql = [];
    const setArgs = [];
    for (const key of spec.update) {
      if (Object.prototype.hasOwnProperty.call(payload, key)) {
        setSql.push(`${key} = ?`);
        setArgs.push(payload[key]);
      }
    }
    if (!setSql.length) return { data: null, error: null };
    const filters = (body.filters || []).filter((filter) => filter.column !== "user_id");
    const filterArgs = [];
    const filterSql = where(filters, spec.filters, filterArgs);
    await execute(
      env,
      `UPDATE ${body.table} SET ${setSql.join(", ")} WHERE user_id = ?${filterSql.length ? ` AND ${filterSql.join(" AND ")}` : ""}`,
      [...setArgs, user.id, ...filterArgs],
    );
    return { data: null, error: null };
  }
  if (action === "delete" && spec.remove) {
    const args = [user.id];
    const filters = (body.filters || []).filter((filter) => filter.column !== "user_id");
    const parts = where(filters, spec.filters, args);
    await execute(
      env,
      `DELETE FROM ${body.table} WHERE user_id = ?${parts.length ? ` AND ${parts.join(" AND ")}` : ""}`,
      args,
    );
    return { data: null, error: null };
  }
  throw fail("Operação não permitida", 403);
}

export async function handleQuery(request, env) {
  if (request.method !== "POST") throw fail("Method not allowed", 405);
  const body = await readJson(request);
  const user = await userFromRequest(request, env);
  if (ADMIN_VIEWS.has(body.table)) {
    if (!user || !isAdmin(user)) throw fail("Forbidden", 403);
    if (body.action !== "select") throw fail("Operação não permitida", 403);
    const args = [];
    let sql = `SELECT * FROM ${body.table}`;
    sql += " LIMIT ?";
    args.push(limitOf(body.limit));
    return json(finish(await many(env, sql, args), body.mode));
  }
  if (!user) return json({ data: null, error: { message: "Faça login para usar a nuvem" } }, 401);
  try {
    return json(await handleUserTable(env, user, body));
  } catch (error) {
    if (error.code === "unique") {
      return json({ data: null, error: { message: "Este registro já existe" } }, 409);
    }
    throw error;
  }
}
