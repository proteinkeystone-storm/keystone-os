/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — MCP sprint 5 : le REFLET chiffré par jeton
   ───────────────────────────────────────────────────────────────
   Le navigateur publie, par pad autorisé et par connexion dont il connaît
   le secret, un reflet chiffré (app/mirror.js). Le Worker ne détient
   JAMAIS la clé : il la dérive du secret porté par le jeton d'accès de
   l'appel, déchiffre en mémoire, répond, oublie. Au repos, la base ne
   contient rien de lisible. Révoquer une connexion efface ses reflets.

   Dérivation (DOIT rester identique à app/mirror.js) :
     clé = SHA-256( secret + '|keystone-mcp-mirror|' + pad ) → AES-256-GCM
     iv  = 12 octets aléatoires, base64 ; ciphertext base64.

   Routes (JWT Keystone du navigateur) :
     GET    /api/mcp/mirror                          état (pad, connexion, date, taille)
     PUT    /api/mcp/mirror/:connection_id/:pad      { ciphertext, iv }  (≤ 64 Ko)
     DELETE /api/mcp/mirror/:pad                     interrupteur coupé → reflets du pad effacés
   Rétention : reflet non rafraîchi depuis 90 j purgé (cron 3 h).
   ═══════════════════════════════════════════════════════════════ */
import { json, err, parseBody, getAllowedOrigin } from '../lib/auth.js';
import { requireJWT } from '../lib/jwt.js';

export const MIRROR_PADS      = ['brainstorming', 'ghostwriter', 'social'];
export const MIRROR_MAX_BYTES = 64 * 1024;
export const MIRROR_STALE_H   = 24;       // au-delà : avertissement daté
export const MIRROR_DEAD_D    = 7;        // au-delà : message seul, jamais la donnée

let _ready = false;
export async function ensureMcpMirrorSchema(env) {
  if (_ready) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS mcp_mirror (sub TEXT NOT NULL, connection_id TEXT NOT NULL, pad TEXT NOT NULL,
    ciphertext TEXT NOT NULL, iv TEXT NOT NULL, size_bytes INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (sub, connection_id, pad))`).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_mcp_mirror_conn ON mcp_mirror(connection_id)').run();
  _ready = true;
}
const iso = (v) => (typeof v === 'string' && !/[TZ]/.test(v)) ? v.replace(' ', 'T') + 'Z' : v;
const fromB64 = (b) => Uint8Array.from(atob(b), c => c.charCodeAt(0));

/* ═══ CRYPTO (miroir de app/mirror.js) ═══ */
export async function mirrorKey(secret, pad) {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${secret}|keystone-mcp-mirror|${pad}`));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function mirrorDecrypt(secret, pad, ciphertextB64, ivB64) {
  const key = await mirrorKey(secret, pad);
  const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(ivB64) }, key, fromB64(ciphertextB64));
  return JSON.parse(new TextDecoder().decode(buf));
}

/* ═══ LECTURE (depuis /mcp, avec le secret du jeton présenté) ═══
   → { ok:true, data, updated_at, age_h, avertissement? }
   | { ok:false, reason:'absent'|'illisible'|'perime', updated_at? } */
export async function mirrorRead(env, { sub, connectionId, secret, pad }) {
  await ensureMcpMirrorSchema(env);
  if (!secret || !connectionId || !MIRROR_PADS.includes(pad)) return { ok: false, reason: 'absent' };
  const row = await env.DB.prepare('SELECT ciphertext, iv, updated_at FROM mcp_mirror WHERE sub = ? AND connection_id = ? AND pad = ?').bind(sub, connectionId, pad).first();
  if (!row) return { ok: false, reason: 'absent' };
  const updated = iso(row.updated_at);
  const ageH = Math.max(0, (Date.now() - Date.parse(updated)) / 3600e3);
  if (ageH > MIRROR_DEAD_D * 24) return { ok: false, reason: 'perime', updated_at: updated };
  let data;
  try { data = await mirrorDecrypt(secret, pad, row.ciphertext, row.iv); }
  catch (_) { return { ok: false, reason: 'illisible', updated_at: updated }; }
  const out = { ok: true, data, updated_at: updated, age_h: Math.round(ageH * 10) / 10 };
  if (ageH > MIRROR_STALE_H) out.avertissement = `Reflet du ${updated} (plus de ${Math.floor(ageH)} h) : ouvre Keystone pour le rafraîchir.`;
  return out;
}

/* ═══ ROUTES ═══ */
async function gate(request, env, origin) {
  const claims = await requireJWT(request, env);
  if (!claims || !claims.sub) return { error: err('Jeton Keystone requis', 401, origin) };
  return { claims };
}
export async function handleMirrorList(request, env) {
  const origin = getAllowedOrigin(env, request);
  const g = await gate(request, env, origin); if (g.error) return g.error;
  await ensureMcpMirrorSchema(env);
  const { results } = await env.DB.prepare('SELECT connection_id, pad, size_bytes, updated_at FROM mcp_mirror WHERE sub = ? ORDER BY updated_at DESC').bind(g.claims.sub).all();
  return json({ ok: true, pads: MIRROR_PADS, items: (results || []).map(r => ({ connection_id: r.connection_id, pad: r.pad, size_bytes: r.size_bytes, updated_at: iso(r.updated_at) })) }, 200, origin);
}
export async function handleMirrorPut(request, env, connectionId, pad) {
  const origin = getAllowedOrigin(env, request);
  const g = await gate(request, env, origin); if (g.error) return g.error;
  await ensureMcpMirrorSchema(env);
  if (!MIRROR_PADS.includes(pad)) return err('Pad inconnu', 400, origin);
  const conn = await env.DB.prepare('SELECT id FROM mcp_connections WHERE id = ? AND sub = ? AND revoked_at IS NULL').bind(String(connectionId || ''), g.claims.sub).first().catch(() => null);
  if (!conn) return err('Connexion introuvable', 404, origin);
  const body = await parseBody(request);
  const ct = body && typeof body.ciphertext === 'string' ? body.ciphertext : '', iv = body && typeof body.iv === 'string' ? body.iv : '';
  if (!ct || !iv || !/^[A-Za-z0-9+/=]+$/.test(ct) || !/^[A-Za-z0-9+/=]{16}$/.test(iv)) return err('ciphertext / iv attendus (base64)', 400, origin);
  const size = Math.floor(ct.length * 3 / 4);
  if (size > MIRROR_MAX_BYTES) return err(`Reflet trop volumineux (${size} > ${MIRROR_MAX_BYTES} octets)`, 413, origin);
  await env.DB.prepare(`INSERT INTO mcp_mirror (sub, connection_id, pad, ciphertext, iv, size_bytes, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
                        ON CONFLICT(sub, connection_id, pad) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, size_bytes = excluded.size_bytes, updated_at = datetime('now')`)
    .bind(g.claims.sub, conn.id, pad, ct, iv, size).run();
  return json({ ok: true, pad, connection_id: conn.id, size_bytes: size }, 200, origin);
}
export async function handleMirrorDelete(request, env, pad) {
  const origin = getAllowedOrigin(env, request);
  const g = await gate(request, env, origin); if (g.error) return g.error;
  await ensureMcpMirrorSchema(env);
  if (!MIRROR_PADS.includes(pad)) return err('Pad inconnu', 400, origin);
  const r = await env.DB.prepare('DELETE FROM mcp_mirror WHERE sub = ? AND pad = ?').bind(g.claims.sub, pad).run();
  return json({ ok: true, pad, deleted: r?.meta?.changes || 0 }, 200, origin);
}
export async function purgeMcpMirror(env) {
  await ensureMcpMirrorSchema(env);
  const x = await env.DB.prepare("DELETE FROM mcp_mirror WHERE updated_at < datetime('now', '-90 days')").run().catch(() => null);
  return { mirror: x?.meta?.changes ?? 0 };
}
