/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Landing leads (capture email beta)
   ─────────────────────────────────────────────────────────────
   POST /api/leads            public — enregistre un email d'intérêt
   GET  /api/admin/leads      admin  — liste (JSON) + ?format=csv

   Souverain : stockage D1 (WEUR), zéro service tiers. Pas de double
   opt-in pour l'instant (aucune campagne envoyée) — collecte propre
   avec mention « désinscription sur demande » côté landing.

   Anti-spam (sans friction) :
     - honeypot : champ `company` qui doit rester vide (bots le remplissent)
     - rate-limit : max LEAD_CAP_IP inscriptions/jour/IP
     - dédoublonnage : un email = une ligne (ON CONFLICT DO NOTHING)
   ═══════════════════════════════════════════════════════════════ */

import { json, err, requireAdmin, parseBody, getAllowedOrigin } from '../lib/auth.js';

const EMAIL_RE   = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const LEAD_CAP_IP = 10;          // inscriptions/jour/IP (anti-flood, large pour un foyer/bureau partagé)
const SOURCE_MAX  = 40;          // longueur max du libellé de provenance

let _leadsSchemaReady = false;
async function ensureLeadsSchema(env) {
  if (_leadsSchemaReady) return;
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS landing_leads (
        email      TEXT PRIMARY KEY,
        source     TEXT,
        ip_hash    TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();
    await env.DB.prepare(
      'CREATE INDEX IF NOT EXISTS idx_landing_leads_ip ON landing_leads(ip_hash, created_at)'
    ).run().catch(() => {});
  } catch (_) { /* déjà créé : OK */ }
  _leadsSchemaReady = true;
}

// Hash IP anonyme (jamais l'IP en clair) — sert au rate-limit du jour.
async function _ipHash(ip) {
  const data = new TextEncoder().encode('lead:' + ip);
  const buf  = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── POST /api/leads ───────────────────────────────────────────
export async function handleLeadCapture(request, env) {
  const origin = getAllowedOrigin(env, request);
  await ensureLeadsSchema(env);

  const b = await parseBody(request);

  // Honeypot : un humain ne voit/remplit jamais ce champ.
  if (b && typeof b.company === 'string' && b.company.trim() !== '') {
    // On répond 200 « ok » pour ne pas renseigner le bot, mais on n'écrit rien.
    return json({ ok: true }, 200, origin);
  }

  const email = (typeof b?.email === 'string') ? b.email.trim().toLowerCase().slice(0, 254) : '';
  if (!EMAIL_RE.test(email)) return err('Adresse e-mail invalide.', 400, origin);

  const source = (typeof b?.source === 'string') ? b.source.trim().slice(0, SOURCE_MAX) : 'landing';

  // Rate-limit par IP/jour (anonyme).
  const ip = (request.headers.get('cf-connecting-ip') || '').slice(0, 64);
  const ipHash = ip ? await _ipHash(ip) : null;
  if (ipHash) {
    const n = await env.DB
      .prepare("SELECT COUNT(*) AS c FROM landing_leads WHERE ip_hash = ? AND created_at >= datetime('now','-1 day')")
      .bind(ipHash).first().catch(() => null);
    if ((n?.c ?? 0) >= LEAD_CAP_IP) return err('Trop de tentatives. Réessayez plus tard.', 429, origin);
  }

  // Un email = une ligne. Réinscription = no-op silencieux (on renvoie ok).
  await env.DB
    .prepare("INSERT INTO landing_leads (email, source, ip_hash) VALUES (?, ?, ?) ON CONFLICT(email) DO NOTHING")
    .bind(email, source, ipHash).run().catch(() => {});

  return json({ ok: true }, 200, origin);
}

// ── GET /api/admin/leads (?format=csv) ────────────────────────
export async function handleLeadsList(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);
  await ensureLeadsSchema(env);

  const rows = (await env.DB
    .prepare('SELECT email, source, created_at FROM landing_leads ORDER BY created_at DESC')
    .all().catch(() => ({ results: [] }))).results || [];

  const url = new URL(request.url);
  if (url.searchParams.get('format') === 'csv') {
    const esc = s => '"' + String(s ?? '').replace(/"/g, '""') + '"';
    const csv = ['email,source,created_at',
      ...rows.map(r => [r.email, r.source, r.created_at].map(esc).join(','))].join('\n');
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="keystone-leads.csv"',
        'Access-Control-Allow-Origin': origin,
      },
    });
  }

  return json({ count: rows.length, leads: rows }, 200, origin);
}
