/**
 * ReadEra TTS Proxy — Supabase Edge Function (Deno)
 *
 * Cadeia em modo auto (mais estável primeiro):
 *   1. OpenAI tts-1 — OPENAI_API_KEY
 *   2. Google Cloud TTS — GOOGLE_CLOUD_TTS_API_KEY
 *   3. Google Translate (gratuito, sem token Microsoft)
 *   4. StreamElements (gratuito)
 *   5. edge-tts-universal (Microsoft Edge)
 *   6. WebSocket Edge manual (backup se o pacote npm falhar)
 *
 * GET ?text=&voice=&rate=  →  audio/mpeg 200
 * POST { text, voice, rate }  →  audio/mpeg 200
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const DEFAULT_VOICE = "pt-BR-FranciscaNeural";
const MAX_CHARS = 4000;

/* edge-tts / rany2 constants (atualizado pela comunidade) */
const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const CHROMIUM_MAJOR = CHROMIUM_FULL_VERSION.split(".")[0];
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;
const WIN_EPOCH = 11644473600;
const WSS_BASE =
  `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`;

let clockSkewSeconds = 0;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  let text = "";
  let voice = DEFAULT_VOICE;
  let rate = 1.0;

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      text = (url.searchParams.get("text") || "").trim();
      voice = url.searchParams.get("voice") || DEFAULT_VOICE;
      rate = clampRate(Number(url.searchParams.get("rate") || "1.0"));
    } else if (req.method === "POST") {
      const body = await req.json();
      text = String(body.text ?? "").trim();
      voice = String(body.voice ?? DEFAULT_VOICE);
      rate = clampRate(Number(body.rate) || 1.0);
    } else {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: CORS,
      });
    }

    if (!text) {
      return jsonError("text is required", 400);
    }

    const sendText = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;
    const audioData = await synthesizeWithFallback(sendText, voice, rate);

    return new Response(audioData, {
      status: 200,
      headers: {
        ...CORS,
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audioData.byteLength),
        "Cache-Control": "no-store",
        "X-TTS-Engine": "readera-proxy",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[tts-proxy]", msg);
    return jsonError(msg, 500);
  }
});

function jsonError(msg: string, status: number): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1.0;
  return Math.max(0.25, Math.min(3.0, rate));
}

function rateToProsody(rate: number): string {
  const pct = Math.round((rate - 1) * 100);
  return (pct >= 0 ? "+" : "") + pct + "%";
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/* ── Cadeia de providers ───────────────────────────────────── */

async function synthesizeWithFallback(
  text: string,
  voice: string,
  rate: number,
): Promise<Uint8Array> {
  const mode = (Deno.env.get("TTS_PROVIDER") || "auto").toLowerCase();
  const errors: string[] = [];

  const providers: Array<{ name: string; run: () => Promise<Uint8Array> }> = [];

  if (mode === "openai") {
    providers.push({ name: "openai", run: () => synthesizeOpenAI(text, voice, rate) });
  } else if (mode === "google") {
    providers.push({ name: "google-cloud", run: () => synthesizeGoogleCloud(text, voice, rate) });
  } else if (mode === "edge") {
    providers.push({ name: "edge-npm", run: () => synthesizeEdgeNpm(text, voice, rate) });
    providers.push({ name: "edge-ws", run: () => synthesizeEdgeWebSocket(text, voice, rate) });
  } else if (mode === "translate") {
    providers.push({ name: "google-translate", run: () => synthesizeGoogleTranslate(text, voice) });
  } else {
    /* auto: estáveis primeiro; Microsoft por último */
    if (Deno.env.get("OPENAI_API_KEY")) {
      providers.push({ name: "openai", run: () => synthesizeOpenAI(text, voice, rate) });
    }
    if (Deno.env.get("GOOGLE_CLOUD_TTS_API_KEY")) {
      providers.push({ name: "google-cloud", run: () => synthesizeGoogleCloud(text, voice, rate) });
    }
    providers.push({ name: "google-translate", run: () => synthesizeGoogleTranslate(text, voice) });
    providers.push({ name: "streamelements", run: () => synthesizeStreamElements(text, voice) });
    providers.push({ name: "edge-npm", run: () => synthesizeEdgeNpm(text, voice, rate) });
    providers.push({ name: "edge-ws", run: () => synthesizeEdgeWebSocket(text, voice, rate) });
  }

  for (const p of providers) {
    try {
      const data = await p.run();
      if (data && data.length > 100) {
        console.log(`[tts-proxy] OK ${p.name} (${data.length} bytes)`);
        return data;
      }
      errors.push(`${p.name}: empty`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${p.name}: ${msg}`);
      console.warn(`[tts-proxy] ${p.name}:`, msg);
    }
  }

  throw new Error("Todos os motores TTS falharam: " + errors.join(" | "));
}

/* ── OpenAI tts-1 ──────────────────────────────────────────── */

function mapOpenAIVoice(voice: string): string {
  const v = voice.toLowerCase();
  if (v.includes("male") || v.includes("antonio") || v.includes("donaldo")) return "onyx";
  return "nova";
}

async function synthesizeOpenAI(
  text: string,
  voice: string,
  rate: number,
): Promise<Uint8Array> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY not set");

  const resp = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: Deno.env.get("OPENAI_TTS_MODEL") || "tts-1",
      input: text,
      voice: mapOpenAIVoice(voice),
      speed: rate,
      response_format: "mp3",
    }),
  });

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => "");
    throw new Error(`OpenAI ${resp.status}: ${errBody.slice(0, 180)}`);
  }
  return new Uint8Array(await resp.arrayBuffer());
}

/* ── Google Cloud TTS ──────────────────────────────────────── */

function mapGoogleCloudVoice(voice: string): { languageCode: string; name: string } {
  const v = voice.toLowerCase();
  if (v.startsWith("pt-br")) return { languageCode: "pt-BR", name: "pt-BR-Neural2-C" };
  if (v.startsWith("pt")) return { languageCode: "pt-PT", name: "pt-PT-Neural2-A" };
  if (v.startsWith("en")) return { languageCode: "en-US", name: "en-US-Neural2-C" };
  if (v.startsWith("es")) return { languageCode: "es-ES", name: "es-ES-Neural2-A" };
  return { languageCode: "pt-BR", name: "pt-BR-Neural2-C" };
}

async function synthesizeGoogleCloud(
  text: string,
  voice: string,
  rate: number,
): Promise<Uint8Array> {
  const key = Deno.env.get("GOOGLE_CLOUD_TTS_API_KEY");
  if (!key) throw new Error("GOOGLE_CLOUD_TTS_API_KEY not set");

  const mapped = mapGoogleCloudVoice(voice);
  const resp = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: mapped.languageCode, name: mapped.name },
        audioConfig: { audioEncoding: "MP3", speakingRate: rate },
      }),
    },
  );

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => "");
    throw new Error(`Google Cloud ${resp.status}: ${errBody.slice(0, 180)}`);
  }

  const json = await resp.json();
  if (!json.audioContent) throw new Error("Google Cloud: sem audioContent");

  const binary = atob(json.audioContent);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/* ── Google Translate (gratuito) ───────────────────────────── */

function voiceToGoogleLang(voice: string): string {
  const v = voice.toLowerCase();
  if (v.startsWith("pt-br")) return "pt-br";
  if (v.startsWith("pt")) return "pt";
  if (v.startsWith("en")) return "en";
  if (v.startsWith("es")) return "es";
  if (v.startsWith("fr")) return "fr";
  if (v.startsWith("de")) return "de";
  if (v.startsWith("it")) return "it";
  return "pt-br";
}

function splitTextIntoChunks(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    const slice = remaining.substring(0, maxLen);
    let cutAt = Math.max(
      slice.lastIndexOf(". "),
      slice.lastIndexOf("! "),
      slice.lastIndexOf("? "),
    );
    if (cutAt <= 0) cutAt = Math.max(slice.lastIndexOf(", "), slice.lastIndexOf(" "));
    if (cutAt <= 0) cutAt = maxLen;
    else cutAt += 1;
    chunks.push(remaining.substring(0, cutAt).trim());
    remaining = remaining.substring(cutAt).trim();
  }
  return chunks.filter((c) => c.length > 0);
}

async function synthesizeGoogleTranslate(
  text: string,
  voice: string,
): Promise<Uint8Array> {
  const lang = voiceToGoogleLang(voice);
  const chunks = splitTextIntoChunks(text, 180);
  const audioChunks: Uint8Array[] = [];
  const ua =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    `(KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR}.0.0.0`;

  const clients = ["tw-ob", "gtx", "dict-chrome-ex", "webapp"];

  for (const chunk of chunks) {
    let got = false;
    for (const client of clients) {
      const url =
        `https://translate.google.com/translate_tts?ie=UTF-8&client=${client}` +
        `&tl=${lang}&q=${encodeURIComponent(chunk)}`;
      try {
        const resp = await fetch(url, {
          headers: {
            "User-Agent": ua,
            Referer: "https://translate.google.com/",
            Accept: "audio/mpeg, audio/*",
          },
        });
        if (resp.ok) {
          const buf = await resp.arrayBuffer();
          if (buf.byteLength > 80) {
            audioChunks.push(new Uint8Array(buf));
            got = true;
            break;
          }
        }
      } catch (_) {
        /* próximo client */
      }
    }
    if (!got) throw new Error(`Google Translate falhou (${chunk.length} chars)`);
  }
  return concatChunks(audioChunks);
}

/* ── StreamElements (gratuito, pt-BR) ──────────────────────── */

function mapStreamElementsVoice(voice: string): string {
  const v = voice.toLowerCase();
  if (v.includes("antonio") || v.includes("male") || v.includes("donaldo")) return "Ricardo";
  return "Vitoria";
}

async function synthesizeStreamElements(
  text: string,
  voice: string,
): Promise<Uint8Array> {
  const seVoice = mapStreamElementsVoice(voice);
  const chunks = splitTextIntoChunks(text, 250);
  const audioChunks: Uint8Array[] = [];

  for (const chunk of chunks) {
    const url =
      `https://api.streamelements.com/kappa/v2/speech?voice=${encodeURIComponent(seVoice)}` +
      `&text=${encodeURIComponent(chunk)}`;
    const resp = await fetch(url, {
      headers: { Accept: "audio/mpeg, audio/*" },
    });
    if (!resp.ok) throw new Error(`StreamElements ${resp.status}`);
    const buf = await resp.arrayBuffer();
    if (buf.byteLength < 80) throw new Error("StreamElements: áudio vazio");
    audioChunks.push(new Uint8Array(buf));
  }
  return concatChunks(audioChunks);
}

/* ── edge-tts-universal (npm, dinâmico) ────────────────────── */

async function synthesizeEdgeNpm(
  text: string,
  voice: string,
  rate: number,
): Promise<Uint8Array> {
  const { EdgeTTS } = await import("npm:edge-tts-universal@1.4.0");
  const tts = new EdgeTTS(text, voice, { rate: rateToProsody(rate) });
  const result = await tts.synthesize();
  const buf = await result.audio.arrayBuffer();
  if (!buf || buf.byteLength < 80) throw new Error("edge-tts-universal: vazio");
  return new Uint8Array(buf);
}

/* ── Edge WebSocket manual (protocolo edge-tts) ────────────── */

async function generateSecMsGecHash(): Promise<string> {
  const unixSec = Math.floor(Date.now() / 1000) + clockSkewSeconds;
  let ticks = unixSec + WIN_EPOCH;
  ticks -= ticks % 300;
  const input = `${Math.floor(ticks * 1e7)}${TRUSTED_CLIENT_TOKEN}`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function edgeDateString(): string {
  const d = new Date();
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const p = (n: number) => String(n).padStart(2, "0");
  return `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${d.getUTCDate()} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`;
}

function toMicrosoftVoice(voice: string): string {
  const m = voice.match(/^([a-z]{2,})-([A-Z]{2,})-(.+Neural)$/);
  if (!m) return voice;
  let region = m[2];
  let name = m[3];
  if (name.includes("-")) {
    region = `${region}-${name.slice(0, name.indexOf("-"))}`;
    name = name.slice(name.indexOf("-") + 1);
  }
  return `Microsoft Server Speech Text to Speech Voice (${m[1]}-${region}, ${name})`;
}

function cleanEdgeText(s: string): string {
  return Array.from(s).map((ch) => {
    const c = ch.charCodeAt(0);
    if ((c >= 0 && c <= 8) || (c >= 11 && c <= 12) || (c >= 14 && c <= 31)) return " ";
    return ch;
  }).join("");
}

async function synthesizeEdgeWebSocket(
  text: string,
  voiceKey: string,
  rate: number,
): Promise<Uint8Array> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await synthesizeEdgeWebSocketOnce(text, voiceKey, rate);
    } catch (e) {
      if (attempt === 0) {
        clockSkewSeconds += 30;
        continue;
      }
      throw e;
    }
  }
  throw new Error("Edge WS failed");
}

async function synthesizeEdgeWebSocketOnce(
  text: string,
  voiceKey: string,
  rate: number,
): Promise<Uint8Array> {
  const msVoice = toMicrosoftVoice(voiceKey);
  const pct = Math.round((rate - 1) * 100);
  const rateStr = (pct >= 0 ? "+" : "") + pct + "%";
  const escaped = cleanEdgeText(text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  const lang = voiceKey.substring(0, 5);
  const ssml =
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'>` +
    `<voice name='${msVoice}'><prosody rate='${rateStr}'>${escaped}</prosody></voice></speak>`;

  const secMsGec = await generateSecMsGecHash();
  const connId = crypto.randomUUID().replace(/-/g, "");
  const wsUrl =
    `${WSS_BASE}&ConnectionId=${connId}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;

  const reqId = crypto.randomUUID().replace(/-/g, "");
  const ts = edgeDateString();
  const speechConfig =
    `X-Timestamp:${ts}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
  `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"true","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`;
  const ssmlMsg =
    `X-RequestId:${reqId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${ts}Z\r\nPath:ssml\r\n\r\n${ssml}`;

  return new Promise<Uint8Array>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    const chunks: Uint8Array[] = [];
    let settled = false;
    let audioReceived = false;

    const done = (ok: boolean, reason?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch (_) { /* ignore */ }
      if (ok && chunks.length > 0) resolve(concatChunks(chunks));
      else reject(new Error(reason ?? "Edge WS sem áudio"));
    };

    const timer = setTimeout(() => done(false, "Edge WS timeout"), 22_000);

    ws.onopen = () => {
      ws.send(speechConfig);
      ws.send(ssmlMsg);
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        if (ev.data.includes("Path:turn.end")) {
          if (audioReceived) done(true);
          else done(false, "turn.end sem áudio");
        }
        if (/statuscode=40[13]/.test(ev.data)) done(false, "Edge 403");
      } else {
        const buf = ev.data as ArrayBuffer;
        if (buf.byteLength < 2) return;
        const headerLen = new DataView(buf).getUint16(0, false);
        const start = 2 + headerLen;
        if (buf.byteLength > start) {
          chunks.push(new Uint8Array(buf.slice(start)));
          audioReceived = true;
        }
      }
    };

    ws.onerror = () => done(false, "Edge WS error");
    ws.onclose = () => {
      if (!settled && audioReceived) done(true);
      else if (!settled) done(false, "Edge WS closed");
    };
  });
}
