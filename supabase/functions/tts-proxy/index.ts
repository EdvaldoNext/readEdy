/**
 * ReadEra TTS Proxy — Supabase Edge Function (Deno)
 *
 * Microsoft Edge TTS (WebSocket + Sec-MS-GEC DRM) alinhado com edge-tts.
 * Fallback: Google Translate TTS (sem API key).
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

/* edge-tts constants (rany2/edge-tts) */
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
  let voice = "pt-BR-FranciscaNeural";
  let rate = 1.0;

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      text = (url.searchParams.get("text") || "").trim();
      voice = url.searchParams.get("voice") || "pt-BR-FranciscaNeural";
      rate = Math.max(
        0.25,
        Math.min(3.0, Number(url.searchParams.get("rate") || "1.0")),
      );
    } else if (req.method === "POST") {
      const body = await req.json();
      text = String(body.text ?? "").trim();
      voice = String(body.voice ?? "pt-BR-FranciscaNeural");
      rate = Math.max(0.25, Math.min(3.0, Number(body.rate) || 1.0));
    } else {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: CORS,
      });
    }

    if (!text) {
      return new Response(JSON.stringify({ error: "text is required" }), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const MAX_CHARS = 4000;
    const sendText = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;

    let audioData: Uint8Array | null = null;
    try {
      audioData = await synthesizeEdgeTTS(sendText, voice, rate);
    } catch (edgeErr) {
      console.warn("[tts-proxy] Edge TTS falhou, usando Google TTS:", edgeErr);
    }

    if (!audioData || audioData.length === 0) {
      const lang = voiceToGoogleLang(voice);
      audioData = await synthesizeGoogleTTS(sendText, lang, rate);
    }

    return new Response(audioData, {
      status: 200,
      headers: {
        ...CORS,
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audioData.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[tts-proxy]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});

/* ════════════════════════════════════════════════════════════
   DRM / Sec-MS-GEC (edge-tts drm.py)
   ════════════════════════════════════════════════════════════ */

async function generateSecMsGecHash(): Promise<string> {
  const unixSec = Math.floor(Date.now() / 1000) + clockSkewSeconds;
  let ticks = unixSec + WIN_EPOCH;
  ticks -= ticks % 300;
  const ticks100ns = Math.floor(ticks * 1e7);
  const input = `${ticks100ns}${TRUSTED_CLIENT_TOKEN}`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function connectId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

function dateToString(): string {
  const d = new Date();
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${d.getUTCDate()} ` +
    `${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:` +
    `${pad(d.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`
  );
}

function rateToSSML(rate: number): string {
  const pct = Math.round((rate - 1) * 100);
  return pct >= 0 ? `+${pct}%` : `${pct}%`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function removeIncompatibleCharacters(s: string): string {
  const chars = Array.from(s);
  for (let i = 0; i < chars.length; i++) {
    const code = chars[i].charCodeAt(0);
    if (
      (code >= 0 && code <= 8) ||
      (code >= 11 && code <= 12) ||
      (code >= 14 && code <= 31)
    ) {
      chars[i] = " ";
    }
  }
  return chars.join("");
}

/** Converte pt-BR-FranciscaNeural → formato Microsoft (edge-tts TTSConfig) */
function toMicrosoftVoice(voice: string): string {
  const m = voice.match(/^([a-z]{2,})-([A-Z]{2,})-(.+Neural)$/);
  if (!m) return voice;
  let lang = m[1];
  let region = m[2];
  let name = m[3];
  if (name.includes("-")) {
    region = `${region}-${name.slice(0, name.indexOf("-"))}`;
    name = name.slice(name.indexOf("-") + 1);
  }
  return (
    "Microsoft Server Speech Text to Speech Voice " +
    `(${lang}-${region}, ${name})`
  );
}

function mkssml(voice: string, rate: string, escapedText: string): string {
  const lang = voice.includes("(")
    ? voice.match(/\(([a-z]{2}-[A-Za-z0-9-]+)/)?.[1] ?? "en-US"
    : voice.substring(0, 5);
  return (
    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' " +
    `xml:lang='${lang}'>` +
    `<voice name='${voice}'>` +
    `<prosody pitch='+0Hz' rate='${rate}' volume='+0%'>` +
    `${escapedText}</prosody></voice></speak>`
  );
}

async function synthesizeEdgeTTS(
  text: string,
  voiceKey: string,
  rate: number,
): Promise<Uint8Array> {
  const cleaned = escapeXml(removeIncompatibleCharacters(text));
  const msVoice = toMicrosoftVoice(voiceKey);
  const rateStr = rateToSSML(rate);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await synthesizeEdgeTTSOnce(cleaned, msVoice, rateStr);
    } catch (err) {
      if (attempt === 0 && err instanceof Error && /403|401/i.test(err.message)) {
        clockSkewSeconds += 30;
        continue;
      }
      throw err;
    }
  }
  throw new Error("Edge TTS failed after retry");
}

async function synthesizeEdgeTTSOnce(
  escapedText: string,
  msVoice: string,
  rateStr: string,
): Promise<Uint8Array> {
  const secMsGec = await generateSecMsGecHash();
  const connId = connectId();

  const wsUrl =
    `${WSS_BASE}&ConnectionId=${connId}` +
    `&Sec-MS-GEC=${secMsGec}` +
    `&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;

  const ssml = mkssml(msVoice, rateStr, escapedText);
  const requestId = connectId();
  const ts = dateToString();

  const speechConfig =
    `X-Timestamp:${ts}\r\n` +
    "Content-Type:application/json; charset=utf-8\r\n" +
    "Path:speech.config\r\n\r\n" +
    '{"context":{"synthesis":{"audio":{"metadataoptions":{' +
    '"sentenceBoundaryEnabled":"true","wordBoundaryEnabled":"false"' +
    '},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n';

  const ssmlMsg =
    `X-RequestId:${requestId}\r\n` +
    "Content-Type:application/ssml+xml\r\n" +
    `X-Timestamp:${ts}Z\r\n` +
    "Path:ssml\r\n\r\n" +
    ssml;

  return new Promise<Uint8Array>((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      reject(e);
      return;
    }
    ws.binaryType = "arraybuffer";

    const chunks: Uint8Array[] = [];
    let settled = false;
    let audioReceived = false;

    const settle = (ok: boolean, reason?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch (_) {
        /* ignore */
      }
      if (ok) {
        const total = chunks.reduce((s, c) => s + c.length, 0);
        const out = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) {
          out.set(c, off);
          off += c.length;
        }
        resolve(out);
      } else {
        reject(new Error(reason ?? "Edge TTS failed"));
      }
    };

    const timer = setTimeout(
      () => settle(false, "Edge TTS timeout (25 s)"),
      25_000,
    );

    ws.onopen = () => {
      ws.send(speechConfig);
      ws.send(ssmlMsg);
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        if (ev.data.includes("Path:turn.end")) {
          if (audioReceived) settle(true);
          else settle(false, "turn.end without audio");
        }
        if (/Path:turn\.start/.test(ev.data) && /statuscode=40[13]/.test(ev.data)) {
          settle(false, "Edge TTS 403/401");
        }
      } else {
        const buf = ev.data as ArrayBuffer;
        if (buf.byteLength < 2) return;
        const headerLen = new DataView(buf).getUint16(0, false);
        const audioStart = 2 + headerLen;
        if (buf.byteLength > audioStart) {
          chunks.push(new Uint8Array(buf.slice(audioStart)));
          audioReceived = true;
        }
      }
    };

    ws.onerror = () => settle(false, "Edge TTS WebSocket error");
    ws.onclose = () => {
      if (!settled) {
        if (chunks.length > 0) settle(true);
        else settle(false, "Edge TTS WebSocket closed without audio");
      }
    };
  });
}

/* ════════════════════════════════════════════════════════════
   Google Translate TTS (fallback)
   ════════════════════════════════════════════════════════════ */

function voiceToGoogleLang(voice: string): string {
  const v = voice.toLowerCase();
  if (v.startsWith("pt-br")) return "pt-br";
  if (v.startsWith("pt-pt") || v.startsWith("pt")) return "pt";
  if (v.startsWith("en-us") || v.startsWith("en")) return "en";
  if (v.startsWith("es")) return "es";
  if (v.startsWith("fr")) return "fr";
  if (v.startsWith("de")) return "de";
  if (v.startsWith("it")) return "it";
  return voice.substring(0, 5).toLowerCase();
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
      slice.lastIndexOf(".\n"),
    );
    if (cutAt <= 0) cutAt = Math.max(slice.lastIndexOf(", "), slice.lastIndexOf(" "));
    if (cutAt <= 0) cutAt = maxLen;
    else cutAt += 1;
    chunks.push(remaining.substring(0, cutAt).trim());
    remaining = remaining.substring(cutAt).trim();
  }
  return chunks.filter((c) => c.length > 0);
}

async function synthesizeGoogleTTS(
  text: string,
  lang: string,
  _rate: number,
): Promise<Uint8Array> {
  const MAX_CHUNK = 200;
  const chunks = splitTextIntoChunks(text, MAX_CHUNK);
  const audioChunks: Uint8Array[] = [];
  const ua =
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ` +
    `(KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR}.0.0.0 Safari/537.36`;

  for (const chunk of chunks) {
    const url =
      `https://translate.google.com/translate_tts` +
      `?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=${lang}&client=tw-ob`;
    const resp = await fetch(url, {
      headers: {
        "User-Agent": ua,
        Referer: "https://translate.google.com/",
        Accept: "audio/mpeg, audio/*",
      },
    });
    if (!resp.ok) {
      throw new Error(`Google TTS HTTP ${resp.status}`);
    }
    audioChunks.push(new Uint8Array(await resp.arrayBuffer()));
  }

  const total = audioChunks.reduce((s, c) => s + c.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const c of audioChunks) {
    output.set(c, offset);
    offset += c.length;
  }
  return output;
}
