import { userFromRequest } from "./auth.js";
import { fail, hmacHex, json, secret, timingSafeEqual } from "./http.js";
import { assertUploadQuota, ownedPath } from "./query.js";

const SIGN_PREFIX = "/storage/v1/object/sign/pdfs/";
const OBJECT_PREFIX = "/storage/v1/object/pdfs/";

async function signature(env, path, exp) {
  const key = secret(env, "AUTH_SECRET");
  if (!key) throw fail("Arquivos não configurados", 503);
  return hmacHex(key, `${path}\n${exp}`);
}

export async function handleStorage(request, env, url) {
  if (!env.PDFS) throw fail("Armazenamento não configurado", 503);
  const path = decodeURIComponent(url.pathname);
  if (path.startsWith(SIGN_PREFIX) && request.method === "POST") {
    return signObject(request, env, url, path.slice(SIGN_PREFIX.length));
  }
  if (path === "/storage/v1/object/pdfs/remove" && request.method === "POST") {
    return removeObjects(request, env);
  }
  if (path.startsWith(OBJECT_PREFIX)) {
    const objectPath = path.slice(OBJECT_PREFIX.length);
    if (request.method === "PUT") return putObject(request, env, objectPath);
    if (request.method === "GET") return getObject(request, env, url, objectPath);
    if (request.method === "DELETE") return removeObjects(request, env, [objectPath]);
  }
  throw fail("Not found", 404);
}

async function signObject(request, env, url, objectPath) {
  const user = await userFromRequest(request, env);
  if (!user) throw fail("Unauthorized", 401);
  ownedPath(user.id, objectPath);
  const body = await request.json().catch(() => ({}));
  const expiresIn = Math.min(3600, Math.max(30, Number(body.expiresIn) || 600));
  const exp = Math.floor(Date.now() / 1000) + expiresIn;
  const sig = await signature(env, objectPath, exp);
  const signed = new URL(`/storage/v1/object/pdfs/${objectPath.split("/").map(encodeURIComponent).join("/")}`, url.origin);
  signed.searchParams.set("exp", String(exp));
  signed.searchParams.set("sig", sig);
  return json({ signedURL: signed.toString() });
}

async function authorizedPath(request, env, url, objectPath) {
  const exp = url.searchParams.get("exp");
  const sig = url.searchParams.get("sig");
  if (exp && sig) {
    if (Number(exp) < Math.floor(Date.now() / 1000)) throw fail("Link do arquivo expirado", 401);
    const expected = await signature(env, objectPath, exp);
    if (!timingSafeEqual(expected, sig)) throw fail("Link do arquivo inválido", 401);
    return objectPath;
  }
  const user = await userFromRequest(request, env);
  if (!user) throw fail("Unauthorized", 401);
  return ownedPath(user.id, objectPath);
}

async function getObject(request, env, url, objectPath) {
  const key = await authorizedPath(request, env, url, objectPath);
  const object = await env.PDFS.get(key);
  if (!object) throw fail("Arquivo não encontrado", 404);
  const headers = new Headers();
  headers.set("Content-Type", object.httpMetadata?.contentType || "application/pdf");
  headers.set("Cache-Control", "private, max-age=60");
  headers.set("Access-Control-Allow-Origin", "*");
  return new Response(object.body, { status: 200, headers });
}

async function putObject(request, env, objectPath) {
  const user = await userFromRequest(request, env);
  if (!user) throw fail("Unauthorized", 401);
  ownedPath(user.id, objectPath);
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength) throw fail("Arquivo PDF vazio", 400);
  await assertUploadQuota(env, user, bytes.byteLength);
  await env.PDFS.put(objectPath, bytes, {
    httpMetadata: { contentType: request.headers.get("Content-Type") || "application/pdf" },
  });
  return json({ path: objectPath });
}

async function removeObjects(request, env, preset) {
  const user = await userFromRequest(request, env);
  if (!user) throw fail("Unauthorized", 401);
  const body = preset ? { paths: preset } : await request.json().catch(() => ({}));
  const paths = Array.isArray(body.paths) ? body.paths : [];
  for (const item of paths) {
    const key = ownedPath(user.id, item);
    await env.PDFS.delete(key);
  }
  return json({ data: paths, error: null });
}
