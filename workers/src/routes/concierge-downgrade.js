/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Auto-dégradation Concierge à l'échéance
   (chantier annoncé dans [[qr_concierge_to_dynamic_livre]])
   ───────────────────────────────────────────────────────────────
   Problème : un QR Concierge (mode='smart', template_id='concierge')
   continue de répondre via IA (coût Cloudflare AI) même après que le
   client a résilié son abonnement — le redirect public ne vérifie pas
   la licence. Fuite de marge.

   Solution : un job quotidien (cron) bascule les Concierge des licences
   INACTIVES ou EXPIRÉES en redirection simple (mode='dynamic'). Effet :
     • le QR imprimé continue de fonctionner (302 vers la target_url
       existante — VALIDE par construction pour un Concierge url-type) ;
     • l'IA est coupée → plus de coût.
   C'est la version AUTOMATIQUE du bouton manuel « Transformer en
   redirection simple » déjà livré le 03/06.

   Sûreté :
     • DORMANT par défaut. Kill-switch env KS_CONCIERGE_AUTODOWNGRADE_ENABLED
       = 'true' pour muter réellement. Sinon DRY-RUN (audit de ce qui SERAIT
       fait, zéro écriture). Même discipline que les autres enforcements.
     • Réutilise evaluateModeConversion (pure, testée) → si la target_url
       de secours n'est pas joignable, on SKIP (jamais de redirection cassée).
     • N'affecte JAMAIS le tenant 'default' (admin/Stéphane) : il n'a pas de
       lookup_hmac dans la requête des licences mortes.
     • Idempotent : un Concierge déjà dégradé (mode='dynamic') est ignoré.
     • Ne RÉ-UPGRADE pas automatiquement si le client re-souscrit (le bouton
       manuel « Repasser en Concierge » existe pour ça).

   Déclencheurs :
     • Cron quotidien (index.js scheduled).
     • POST /api/admin/concierge-downgrade/run-now (admin, ?dry=1 = preview).
   ═══════════════════════════════════════════════════════════════ */

import { json, err, requireAdmin, getAllowedOrigin } from '../lib/auth.js';
import { audit }                                      from '../lib/audit.js';
import { evaluateModeConversion }                     from './qr.js';

const MAX_DEAD_TENANTS = 400;   // garde-fou taille du IN() (params SQLite)
const MAX_QRS          = 1000;  // garde-fou volume scan par run

function _isHttpUrl(s) {
  try {
    const u = new URL(String(s));
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

// ── PURE (testable) — ce QR doit-il être auto-dégradé ? ───────────
// Concierge en mode smart, avec un short_id (donc une redirection).
export function shouldDowngradeConcierge(data) {
  return !!data
    && data.mode === 'smart'
    && data.template_id === 'concierge'
    && typeof data.short_id === 'string'
    && data.short_id.length > 0;
}

// ═══════════════════════════════════════════════════════════════
// Job principal. opts.dryRun force le dry-run ; sinon il est déduit
// du kill-switch (off ⇒ dry-run). Retourne un résumé.
// ═══════════════════════════════════════════════════════════════
export async function handleConciergeAutoDowngrade(env, opts = {}) {
  const killSwitchOn = env.KS_CONCIERGE_AUTODOWNGRADE_ENABLED === 'true';
  const dryRun = opts.dryRun === true || !killSwitchOn;

  // 1. Tenants « morts » = licences inactives OU expirées (par lookup_hmac).
  const { results: deadRows = [] } = await env.DB.prepare(`
    SELECT lookup_hmac FROM licences
     WHERE lookup_hmac IS NOT NULL
       AND ( is_active = 0
             OR (expires_at IS NOT NULL AND datetime(expires_at) < datetime('now')) )
     LIMIT ${MAX_DEAD_TENANTS}
  `).all().catch(() => ({ results: [] }));
  const deadTenants = [...new Set(deadRows.map(r => r.lookup_hmac).filter(Boolean))];
  if (deadTenants.length === 0) {
    return { dry_run: dryRun, dead_tenants: 0, candidates: 0, downgraded: 0, skipped: 0, sample: [] };
  }

  // 2. QRs de ces tenants — scan borné, filtre Concierge smart en JS
  //    (mode/template vivent dans le JSON entities.data).
  const ph = deadTenants.map(() => '?').join(',');
  const { results: rows = [] } = await env.DB.prepare(`
    SELECT id, tenant_id, data FROM entities
     WHERE type = 'qr_codes' AND deleted_at IS NULL
       AND tenant_id IN (${ph})
     LIMIT ${MAX_QRS}
  `).bind(...deadTenants).all().catch(() => ({ results: [] }));

  const candidates = [];
  for (const r of rows) {
    let data; try { data = JSON.parse(r.data); } catch { continue; }
    if (shouldDowngradeConcierge(data)) candidates.push({ id: r.id, tenant_id: r.tenant_id, data });
  }

  let downgraded = 0, skipped = 0;
  const sample = [];
  for (const c of candidates) {
    // Cible existante (valide par construction pour un Concierge url-type).
    const rd = await env.DB
      .prepare('SELECT target_url FROM qr_redirects WHERE short_id = ?')
      .bind(c.data.short_id).first().catch(() => null);
    const existingUrl = rd?.target_url || null;

    // On réutilise la logique PURE testée : smart → dynamic exige une cible
    // joignable. Si la fallback n'est pas une URL http(s) valide → SKIP
    // (jamais de redirection cassée, même garde-fou que le bouton manuel).
    const verdict = evaluateModeConversion({
      currentMode: 'smart', targetModeRaw: 'dynamic', qrType: 'url',
      smartAllowed: true,
      newTargetUrl: null, newTargetUrlValid: false,
      existingTargetUrl: existingUrl, existingTargetUrlValid: _isHttpUrl(existingUrl),
      hasTemplate: true,
    });
    if (!verdict.ok || verdict.noop || verdict.newMode !== 'dynamic') {
      skipped++;
      if (sample.length < 25) sample.push({ short_id: c.data.short_id, skipped: verdict.error || 'noop' });
      continue;
    }

    if (sample.length < 25) sample.push({ short_id: c.data.short_id, target_url: existingUrl });
    if (dryRun) continue;   // dry-run : on ne mute pas

    // Mutation : flip mode → dynamic (target_url existant intact dans
    // qr_redirects). Trace l'auto-dégradation dans le JSON.
    c.data.mode = 'dynamic';
    c.data.auto_downgraded_at = new Date().toISOString();
    c.data.auto_downgrade_reason = 'licence_inactive_or_expired';
    c.data.updated_at = c.data.auto_downgraded_at;
    await env.DB.prepare(`
      UPDATE entities SET data = ?, updated_at = datetime('now')
       WHERE tenant_id = ? AND type = 'qr_codes' AND id = ?
    `).bind(JSON.stringify(c.data), c.tenant_id, c.id).run();

    await audit(env, {
      action:   'concierge_auto_downgrade',
      actor:    'cron',
      target:   c.data.short_id,
      tenantId: c.tenant_id,
      details:  { qr_id: c.id, reason: 'licence_inactive_or_expired' },
    });
    downgraded++;
  }

  const summary = {
    dry_run:      dryRun,
    dead_tenants: deadTenants.length,
    candidates:   candidates.length,
    downgraded,
    skipped,
    sample,
  };
  // Audit récap (en dry-run : montre ce qui SERAIT fait sans rien muter).
  await audit(env, {
    action:  dryRun ? 'concierge_auto_downgrade_dryrun' : 'concierge_auto_downgrade_run',
    actor:   'cron',
    details: summary,
  });
  return summary;
}

// ═══════════════════════════════════════════════════════════════
// POST /api/admin/concierge-downgrade/run-now
// Déclenche le job à la demande (admin). ?dry=1 force le dry-run même
// si le kill-switch est ON (prévisualisation). Sinon, respecte le
// kill-switch (off ⇒ dry-run, comme le run-now des rappels d'expiration).
// ═══════════════════════════════════════════════════════════════
export async function handleConciergeDowngradeRunNow(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);
  const url = new URL(request.url);
  const forceDry = url.searchParams.get('dry') === '1';
  const summary = await handleConciergeAutoDowngrade(env, forceDry ? { dryRun: true } : {});
  return json({ ok: true, summary }, 200, origin);
}
