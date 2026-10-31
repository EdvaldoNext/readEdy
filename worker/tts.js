import { isSubscriptionActive, userFromRequest } from "./auth.js";
import { execute } from "./db.js";
import { CORS, fail, secret } from "./http.js";

const DEFAULT_VOICE = "pt-BR-FranciscaNeural";
const MAX_CHARS = 4000;
const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const CHROMIUM_MAJOR = CHROMIUM_FULL_VERSION.split(".")[0];
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;
const WIN_EPOCH = 11644473600;
const WSS_BASE = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`;
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateLimitMap = new Map();
let clockSkewSeconds = 0;

function extractToken(request, url) {
  const header = request.headers.get("Authorization") || "";
  if (header.startsWith("Bearer ")) {
    const token = header.slice(7).trim();
    if (token && token !== "readedy-public") return token;
  }
  const query = url.searchParams.get("access_token") || url.searchParams.get("authorization");
  if (query && query !== "readedy-public") return query;
  return "";
}

async function authorize(request, env, url) {
  const token = extractToken(request, url);
  if (!token) throw fail("Login required for cloud TTS", 401);
  const user = await userFromRequest(new Request(request.url, { headers: { Authorization: `Bearer ${token}` } }), env);
  if (!user) throw fail("Invalid session", 401);
  const now = Date.now();
  const bucket = rateLimitMap.get(user.id);
  if (!bucket || bucket.resetAt <= now) {
    rateLimitMap.set(user.id, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
  } else {
    bucket.count += 1;
    if (bucket.count > RATE_LIMIT_MAX) throw fail("TTS rate limit exceeded", 429);
  }
  if (!(await isSubscriptionActive(env, user))) throw fail("Subscription inactive", 402);
  return user;
}

function clampRate(rate) {
  if (!Number.isFinite(rate)) return 1;
  return Math.max(0.25, Math.min(3, rate));
}

function concatChunks(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function mapOpenAIVoice(voice) {
  const value = voice.toLowerCase();
  if (value.includes("male") || value.includes("antonio") || value.includes("donaldo")) return "onyx";
  return "nova";
}

async function synthesizeOpenAI(env, text, voice, rate) {
  const key = secret(env, "OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY not set");
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: secret(env, "OPENAI_TTS_MODEL") || "tts-1",
      input: text,
      voice: mapOpenAIVoice(voice),
      speed: rate,
      response_format: "mp3",
    }),
  });
  if (!response.ok) throw new Error(`OpenAI ${response.status}: ${(await response.text()).slice(0, 180)}`);
  return new Uint8Array(await response.arrayBuffer());
}

function mapGoogleCloudVoice(voice) {
  const value = voice.toLowerCase();
  if (value.startsWith("pt-br")) return { languageCode: "pt-BR", name: "pt-BR-Neural2-C" };
  if (value.startsWith("pt")) return { languageCode: "pt-PT", name: "pt-PT-Neural2-A" };
  if (value.startsWith("en")) return { languageCode: "en-US", name: "en-US-Neural2-C" };
  if (value.startsWith("es")) return { languageCode: "es-ES", name: "es-ES-Neural2-A" };
  return { languageCode: "pt-BR", name: "pt-BR-Neural2-C" };
}

async function synthesizeGoogleCloud(env, text, voice, rate) {
  const key = secret(env, "GOOGLE_CLOUD_TTS_API_KEY");
  if (!key) throw new Error("GOOGLE_CLOUD_TTS_API_KEY not set");
  const mapped = mapGoogleCloudVoice(voice);
  const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: mapped.languageCode, name: mapped.name },
      audioConfig: { audioEncoding: "MP3", speakingRate: rate },
    }),
  });
  if (!response.ok) throw new Error(`Google Cloud ${response.status}: ${(await response.text()).slice(0, 180)}`);
  const data = await response.json();
  if (!data.audioContent) throw new Error("Google Cloud: sem audioContent");
  const binary = atob(data.audioContent);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function voiceToGoogleLang(voice) {
  const value = voice.toLowerCase();
  if (value.startsWith("pt-br")) return "pt-br";
  if (value.startsWith("pt")) return "pt";
  if (value.startsWith("en")) return "en";
  if (value.startsWith("es")) return "es";
  if (value.startsWith("fr")) return "fr";
  if (value.startsWith("de")) return "de";
  if (value.startsWith("it")) return "it";
  return "pt-br";
}

function splitTextIntoChunks(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text.trim();
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    const slice = remaining.substring(0, maxLen);
    let cutAt = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
    if (cutAt <= 0) cutAt = Math.max(slice.lastIndexOf(", "), slice.lastIndexOf(" "));
    if (cutAt <= 0) cutAt = maxLen;
    else cutAt += 1;
    chunks.push(remaining.substring(0, cutAt).trim());
    remaining = remaining.substring(cutAt).trim();
  }
  return chunks.filter((chunk) => chunk.length > 0);
}

async function synthesizeGoogleTranslate(text, voice) {
  const lang = voiceToGoogleLang(voice);
  const chunks = splitTextIntoChunks(text, 180);
  const audioChunks = [];
  const ua = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR}.0.0.0`;
  for (const chunk of chunks) {
    let got = false;
    for (const client of ["tw-ob", "gtx", "dict-chrome-ex", "webapp"]) {
      const target = `https://translate.google.com/translate_tts?ie=UTF-8&client=${client}&tl=${lang}&q=${encodeURIComponent(chunk)}`;
      try {
        const response = await fetch(target, {
          headers: { "User-Agent": ua, Referer: "https://translate.google.com/", Accept: "audio/mpeg, audio/*" },
        });
        if (response.ok) {
          const buf = await response.arrayBuffer();
          if (buf.byteLength > 80) {
            audioChunks.push(new Uint8Array(buf));
            got = true;
            break;
          }
        }
      } catch {
        /* próximo client */
      }
    }
    if (!got) throw new Error(`Google Translate falhou (${chunk.length} chars)`);
  }
  return concatChunks(audioChunks);
}

function mapStreamElementsVoice(voice) {
  const value = voice.toLowerCase();
  if (value.includes("antonio") || value.includes("male") || value.includes("donaldo")) return "Ricardo";
  return "Vitoria";
}

async function synthesizeStreamElements(text, voice) {
  const chunks = splitTextIntoChunks(text, 250);
  const audioChunks = [];
  for (const chunk of chunks) {
    const target = `https://api.streamelements.com/kappa/v2/speech?voice=${encodeURIComponent(mapStreamElementsVoice(voice))}&text=${encodeURIComponent(chunk)}`;
    const response = await fetch(target, { headers: { Accept: "audio/mpeg, audio/*" } });
    if (!response.ok) throw new Error(`StreamElements ${response.status}`);
    const buf = await response.arrayBuffer();
    if (buf.byteLength < 80) throw new Error("StreamElements: áudio vazio");
    audioChunks.push(new Uint8Array(buf));
  }
  return concatChunks(audioChunks);
}

async function generateSecMsGecHash() {
  const unixSec = Math.floor(Date.now() / 1000) + clockSkewSeconds;
  let ticks = unixSec + WIN_EPOCH;
  ticks -= ticks % 300;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${Math.floor(ticks * 1e7)}${TRUSTED_CLIENT_TOKEN}`));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function edgeDateString() {
  const date = new Date();
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (value) => String(value).padStart(2, "0");
  return `${days[date.getUTCDay()]} ${months[date.getUTCMonth()]} ${date.getUTCDate()} ${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`;
}

function toMicrosoftVoice(voice) {
  const match = voice.match(/^([a-z]{2,})-([A-Z]{2,})-(.+Neural)$/);
  if (!match) return voice;
  let region = match[2];
  let name = match[3];
  if (name.includes("-")) {
    region = `${region}-${name.slice(0, name.indexOf("-"))}`;
    name = name.slice(name.indexOf("-") + 1);
  }
  return `Microsoft Server Speech Text to Speech Voice (${match[1]}-${region}, ${name})`;
}

function cleanEdgeText(value) {
  return [...value].map((ch) => {
    const code = ch.charCodeAt(0);
    if ((code >= 0 && code <= 8) || (code >= 11 && code <= 12) || (code >= 14 && code <= 31)) return " ";
    return ch;
  }).join("");
}

async function synthesizeEdgeWebSocketOnce(text, voiceKey, rate) {
  const msVoice = toMicrosoftVoice(voiceKey);
  const pct = Math.round((rate - 1) * 100);
  const rateStr = `${pct >= 0 ? "+" : ""}${pct}%`;
  const escaped = cleanEdgeText(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  const lang = voiceKey.substring(0, 5);
  const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'><voice name='${msVoice}'><prosody rate='${rateStr}'>${escaped}</prosody></voice></speak>`;
  const secMsGec = await generateSecMsGecHash();
  const connId = crypto.randomUUID().replace(/-/g, "");
  const wsUrl = `${WSS_BASE}&ConnectionId=${connId}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;
  const reqId = crypto.randomUUID().replace(/-/g, "");
  const ts = edgeDateString();
  const speechConfig = `X-Timestamp:${ts}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"true","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`;
  const ssmlMsg = `X-RequestId:${reqId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${ts}Z\r\nPath:ssml\r\n\r\n${ssml}`;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const chunks = [];
    let settled = false;
    let audioReceived = false;
    const done = (ok, reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
      if (ok && chunks.length) resolve(concatChunks(chunks));
      else reject(new Error(reason || "Edge WS sem áudio"));
    };
    const timer = setTimeout(() => done(false, "Edge WS timeout"), 22000);
    ws.addEventListener("open", () => {
      ws.send(speechConfig);
      ws.send(ssmlMsg);
    });
    ws.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        if (event.data.includes("Path:turn.end")) done(audioReceived, audioReceived ? undefined : "turn.end sem áudio");
        if (/statuscode=40[13]/.test(event.data)) done(false, "Edge 403");
        return;
      }
      const buf = event.data;
      if (!buf || buf.byteLength < 2) return;
      const headerLen = new DataView(buf).getUint16(0, false);
      const start = 2 + headerLen;
      if (buf.byteLength > start) {
        chunks.push(new Uint8Array(buf.slice(start)));
        audioReceived = true;
      }
    });
    ws.addEventListener("error", () => done(false, "Edge WS error"));
    ws.addEventListener("close", () => {
      if (!settled && audioReceived) done(true);
      else if (!settled) done(false, "Edge WS closed");
    });
  });
}

async function synthesizeEdgeWebSocket(text, voice, rate) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await synthesizeEdgeWebSocketOnce(text, voice, rate);
    } catch (error) {
      if (attempt === 0) {
        clockSkewSeconds += 30;
        continue;
      }
      throw error;
    }
  }
  throw new Error("Edge WS failed");
}

async function synthesizeWithFallback(env, text, voice, rate) {
  const mode = (secret(env, "TTS_PROVIDER") || "auto").toLowerCase();
  const providers = [];
  if (mode === "openai") providers.push(["openai", () => synthesizeOpenAI(env, text, voice, rate)]);
  else if (mode === "google") providers.push(["google-cloud", () => synthesizeGoogleCloud(env, text, voice, rate)]);
  else if (mode === "edge") providers.push(["edge-ws", () => synthesizeEdgeWebSocket(text, voice, rate)]);
  else if (mode === "translate") providers.push(["google-translate", () => synthesizeGoogleTranslate(text, voice)]);
  else {
    if (secret(env, "OPENAI_API_KEY")) providers.push(["openai", () => synthesizeOpenAI(env, text, voice, rate)]);
    if (secret(env, "GOOGLE_CLOUD_TTS_API_KEY")) providers.push(["google-cloud", () => synthesizeGoogleCloud(env, text, voice, rate)]);
    providers.push(["google-translate", () => synthesizeGoogleTranslate(text, voice)]);
    providers.push(["streamelements", () => synthesizeStreamElements(text, voice)]);
    providers.push(["edge-ws", () => synthesizeEdgeWebSocket(text, voice, rate)]);
  }
  const errors = [];
  for (const [name, run] of providers) {
    try {
      const data = await run();
      if (data && data.length > 100) return data;
      errors.push(`${name}: empty`);
    } catch (error) {
      errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Todos os motores TTS falharam: ${errors.join(" | ")}`);
}

export async function handleTts(request, env, url) {
  if (request.method !== "GET" && request.method !== "POST") throw fail("Method Not Allowed", 405);
  let text = "";
  let voice = DEFAULT_VOICE;
  let rate = 1;
  if (request.method === "GET") {
    text = (url.searchParams.get("text") || "").trim();
    voice = url.searchParams.get("voice") || DEFAULT_VOICE;
    rate = clampRate(Number(url.searchParams.get("rate") || "1"));
  } else {
    const body = await request.json();
    text = String(body.text ?? "").trim();
    voice = String(body.voice ?? DEFAULT_VOICE);
    rate = clampRate(Number(body.rate) || 1);
  }
  const user = await authorize(request, env, url);
  if (!text) throw fail("text is required", 400);
  const sendText = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;
  execute(env, "INSERT INTO usage_logs (id, user_id, event_type, metadata) VALUES (?, ?, 'tts_request', ?)", [
    crypto.randomUUID(),
    user.id,
    JSON.stringify({ voice, chars: sendText.length }),
  ]).catch((error) => console.warn("[tts-proxy] usage_logs", error));
  const audio = await synthesizeWithFallback(env, sendText, voice, rate);
  return new Response(audio, {
    status: 200,
    headers: {
      ...CORS,
      "Content-Type": "audio/mpeg",
      "Content-Length": String(audio.byteLength),
      "Cache-Control": "no-store",
      "X-TTS-Engine": "readera-proxy",
    },
  });
}
