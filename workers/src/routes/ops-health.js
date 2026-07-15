/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Sentinelle de soi (OPS-2 · SEPT_PROD_SPRINTS)
   ───────────────────────────────────────────────────────────────
   Keystone surveille Keystone. Toutes les 5 min (cron 5-minutes), le worker
   pinge la landing Vercel + quelques /health représentatifs, garde
   l'état en D1 (ops_health), et alerte Stéphane par e-mail Resend
   APRÈS 2 échecs consécutifs (anti-flap), puis un e-mail de
   rétablissement quand tout revient.

   ⚠ Limite ASSUMÉE : un worker mort ne peut pas se pinger lui-même
   (le cron est mort aussi). Cette brique couvre les pannes PARTIELLES
   (landing HS, un pad HS, D1 en erreur) tant que le worker tourne.
   Le filet pour « worker totalement mort » = un moniteur EXTERNE
   gratuit (UptimeRobot / GitHub Actions), à poser par Stéphane —
   procédure dans SEPT_PROD_SPRINTS.md (OPS-2).

   Ces mêmes signaux nourriront la future page /status (backlog trust).
   ═══════════════════════════════════════════════════════════════ */

import { json, err, requireAdmin, getAllowedOrigin } from '../lib/auth.js';
import { sendEmail } from '../lib/email-resend.js';
// Santés appelées EN INTERNE (pas de self-HTTP) — cf. probeInproc ci-dessous.
import { handleDeskHealth }        from './desk.js';
import { handleSmartAgentHealth }  from './smart-agent.js';
import { handleSentinelHealth }    from './sentinel.js';

const STATE_KEY = 'self';
const DEFAULT_THRESHOLD = 2;       // e-mail après N échecs consécutifs (anti-flap)
const FETCH_TIMEOUT = 8000;

// Bases par défaut (surchargées par env pour dev/test).
const workerBase  = (env) => (env.KS_WORKER_URL  || 'https://keystone-os-api.keystone-os.workers.dev').replace(/\/$/, '');
const landingBase = (env) => (env.KS_LANDING_URL || 'https://protein-keystone.com').replace(/\/$/, '');
const alertTo     = (env) => env.KS_OPS_ALERT_EMAIL || env.KS_ADMIN_EMAIL || 'protein.keystone@gmail.com';

// ── Santés représentatives, appelées EN INTERNE ─────────────────
// ⚠ On NE fait PAS de self-HTTP vers le hostname du worker : Cloudflare
// ne re-route pas fiablement une requête d'un worker vers sa propre URL
// workers.dev (elle revient en 404) → faux positifs garantis. On appelle
// donc directement les handlers de santé (in-process), ce qui exerce le
// vrai code (desk & sentinel revalident même leur schéma D1) sans réseau.
const INPROC_HEALTHS = [
  { name: 'desk',        fn: handleDeskHealth },
  { name: 'smart-agent', fn: handleSmartAgentHealth },
  { name: 'sentinel',    fn: handleSentinelHealth },
];

async function probeInproc(env, { name, fn }) {
  try {
    const req = new Request(`${workerBase(env)}/api/${name}/health`);
    const res = await fn(req, env);
    let ok = res.status === 200;
    if (ok) { try { ok = (await res.json())?.ok === true; } catch { ok = false; } }
    return { name, ok, status: res.status };
  } catch (e) {
    return { name, ok: false, status: 0, error: e.message };
  }
}

// La landing Vercel EST une origine externe → un vrai fetch réseau est
// légitime et fiable (c'est ce qui a bien répondu 200 dans l'alerte).
async function probeLanding(env) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(`${landingBase(env)}/`, { signal: ctrl.signal, redirect: 'manual' });
    return { name: 'landing', ok: res.status === 200, status: res.status };
  } catch (e) {
    return { name: 'landing', ok: false, status: 0, error: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

async function ensureTable(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS ops_health (
      key               TEXT PRIMARY KEY,
      consecutive_fails INTEGER NOT NULL DEFAULT 0,
      alerted           INTEGER NOT NULL DEFAULT 0,
      last_status       TEXT,
      last_ok_at        TEXT,
      last_fail_at      TEXT,
      last_detail       TEXT,
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    )`).run().catch(() => {});
}

// ── Le run principal (cron + endpoint on-demand) ────────────────
// opts.simulate : 'down' | 'up' → force le résultat (test du pipeline
// d'alerte sans vraie panne). Sinon : vraies sondes réseau.
export async function runSelfCheck(env, opts = {}) {
  await ensureTable(env);
  const threshold = parseInt(env.KS_OPS_FAIL_THRESHOLD || String(DEFAULT_THRESHOLD), 10);
  const nowIso = new Date().toISOString();

  // 1) Résultat des sondes (ou simulation).
  let checks, down;
  if (opts.simulate === 'down' || opts.simulate === 'up') {
    down = opts.simulate === 'down';
    checks = [{ name: 'simulate', ok: !down, status: down ? 0 : 200, simulated: true }];
  } else {
    // Landing = fetch externe ; santés = appels in-process (jamais de self-HTTP).
    checks = await Promise.all([
      probeLanding(env),
      ...INPROC_HEALTHS.map(h => probeInproc(env, h)),
    ]);
    down = checks.some(c => !c.ok);
  }
  const failed = checks.filter(c => !c.ok).map(c => c.name);

  // 2) État précédent.
  const prev = await env.DB.prepare('SELECT * FROM ops_health WHERE key = ?').bind(STATE_KEY).first()
    || { consecutive_fails: 0, alerted: 0 };

  let consecutive = prev.consecutive_fails || 0;
  let alerted = !!prev.alerted;
  let alertSent = false, recoverySent = false, emailError = null;

  if (down) {
    consecutive += 1;
    // Alerte au FRANCHISSEMENT du seuil, une seule fois (anti-flap + anti-spam).
    if (consecutive >= threshold && !alerted) {
      alerted = true;
      try { await sendAlert(env, { down: true, checks, failed, consecutive }); alertSent = true; }
      catch (e) { emailError = e.message; }
    }
  } else {
    // Rétablissement : e-mail uniquement si on avait alerté.
    if (alerted) {
      try { await sendAlert(env, { down: false, checks, failed: [], consecutive: 0 }); recoverySent = true; }
      catch (e) { emailError = e.message; }
    }
    consecutive = 0;
    alerted = false;
  }

  const detail = JSON.stringify({ checks, failed, alertSent, recoverySent, emailError });
  await env.DB.prepare(`
    INSERT INTO ops_health (key, consecutive_fails, alerted, last_status, last_ok_at, last_fail_at, last_detail, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET
      consecutive_fails = excluded.consecutive_fails,
      alerted           = excluded.alerted,
      last_status       = excluded.last_status,
      last_ok_at        = COALESCE(excluded.last_ok_at, ops_health.last_ok_at),
      last_fail_at      = COALESCE(excluded.last_fail_at, ops_health.last_fail_at),
      last_detail       = excluded.last_detail,
      updated_at        = excluded.updated_at
  `).bind(
    STATE_KEY, consecutive, alerted ? 1 : 0,
    down ? 'down' : 'ok',
    down ? null : nowIso,
    down ? nowIso : null,
    detail,
  ).run().catch(() => {});

  const summary = { status: down ? 'down' : 'ok', consecutiveFails: consecutive, alerted, alertSent, recoverySent, failed, checks, emailError };
  console.log('[ops-selfcheck]', JSON.stringify({ status: summary.status, consecutive, failed, alertSent, recoverySent }));
  return summary;
}

// ── E-mail d'alerte / de rétablissement ─────────────────────────
async function sendAlert(env, { down, checks, failed, consecutive }) {
  if (!env.KS_RESEND_KEY) { console.warn('[ops-selfcheck] KS_RESEND_KEY absent — pas d\'e-mail'); return; }
  const subject = down
    ? `⚠ Keystone — anomalie détectée (${failed.join(', ')})`
    : `✓ Keystone — rétabli`;
  const rows = checks.map(c =>
    `<tr><td style="padding:4px 12px;color:#94a3b8;font-size:13px">${esc(c.name)}</td>`
    + `<td style="padding:4px 12px;color:${c.ok ? '#4ade80' : '#f87171'};font-size:13px">${c.ok ? 'OK' : 'KO'} (${esc(String(c.status))}${c.error ? ' · ' + esc(c.error) : ''})</td></tr>`
  ).join('');
  const intro = down
    ? `La sentinelle de soi a détecté <strong style="color:#f87171">${consecutive} échec(s) consécutif(s)</strong> sur : <strong>${esc(failed.join(', '))}</strong>.`
    : `Tout est revenu à la normale. Les cibles surveillées répondent de nouveau.`;
  const html = `
  <!DOCTYPE html><html><head><meta charset="utf-8"/></head>
  <body style="margin:0;padding:0;background:#0a0e14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0e14;padding:40px 16px"><tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#111720;border:1px solid #1f2a37;border-radius:12px;overflow:hidden">
        <tr><td style="padding:32px 40px 24px 40px">
          <div style="font-size:14px;letter-spacing:2px;color:#c9a96e;text-transform:uppercase;margin-bottom:8px">Keystone OS — Sentinelle</div>
          <h1 style="margin:0 0 16px 0;color:#f1f5f9;font-size:22px;font-weight:600">${down ? 'Anomalie détectée' : 'Service rétabli'}</h1>
          <p style="margin:0 0 20px 0;color:#94a3b8;font-size:15px;line-height:1.6">${intro}</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#0a0e14;border:1px solid #1f2a37;border-radius:8px;margin:0 0 20px 0">${rows}</table>
          <p style="margin:0;color:#64748b;font-size:12px;line-height:1.6">Vérifié depuis le worker · ${esc(new Date().toISOString())}. Cet e-mail n'est envoyé qu'au franchissement (anti-flap), pas à chaque tick.</p>
        </td></tr>
      </table>
    </td></tr></table>
  </body></html>`;
  await sendEmail(env, { to: alertTo(env), subject, html });
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }

// ═══════════════════════════════════════════════════════════════
// Endpoints Admin (observabilité + test du pipeline d'alerte)
// ═══════════════════════════════════════════════════════════════

// GET /api/admin/ops-health — état courant de la sentinelle (pour /status).
export async function handleOpsHealthGet(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);
  await ensureTable(env);
  const row = await env.DB.prepare('SELECT * FROM ops_health WHERE key = ?').bind(STATE_KEY).first();
  let detail = null; try { detail = row?.last_detail ? JSON.parse(row.last_detail) : null; } catch { /* ignore */ }
  return json({
    ok: true,
    status: row?.last_status || 'unknown',
    consecutive_fails: row?.consecutive_fails ?? 0,
    alerted: !!(row?.alerted),
    last_ok_at: row?.last_ok_at || null,
    last_fail_at: row?.last_fail_at || null,
    updated_at: row?.updated_at || null,
    detail,
  }, 200, origin);
}

// POST /api/admin/ops-health/run-now { simulate? } — force un self-check
// maintenant. simulate:'down'|'up' teste le pipeline d'alerte sans panne.
export async function handleOpsHealthRunNow(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);
  let body = {}; try { body = await request.json(); } catch { /* ignore */ }
  const simulate = body?.simulate === 'down' || body?.simulate === 'up' ? body.simulate : undefined;
  const summary = await runSelfCheck(env, { simulate });
  return json({ ok: true, ...summary }, 200, origin);
}
