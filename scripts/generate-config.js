#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'config.js');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const env = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

function escapeJsString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

const fileEnv = loadEnvFile(path.join(ROOT, '.env'));
const url = process.env.SUPABASE_URL || fileEnv.SUPABASE_URL || '';
const anonKey = process.env.SUPABASE_ANON_KEY || fileEnv.SUPABASE_ANON_KEY || '';

if (!url || !anonKey) {
  console.warn(
    '[generate-config] SUPABASE_URL ou SUPABASE_ANON_KEY ausentes — config.js não gerado.'
  );
  process.exit(0);
}

const content = `/* Gerado por scripts/generate-config.js — não editar manualmente. */
window.READERA_SUPABASE = {
  url: '${escapeJsString(url)}',
  anonKey: '${escapeJsString(anonKey)}'
};
`;

fs.writeFileSync(OUT, content, 'utf8');
console.log('[generate-config] config.js gerado com sucesso.');
