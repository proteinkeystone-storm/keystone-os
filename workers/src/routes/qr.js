/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Routes SDQR · Dynamic QR (Sprint 1)

   Routes :
     GET  /r/:shortId       Public — redirige + log scan (RGPD safe)
     POST /api/qr           Tenant — crée un QR dynamique
     GET  /api/qr           Tenant — liste les QRs du tenant
     PATCH /api/qr/:id      Tenant — modifie cible / status / nom / tags
     DELETE /api/qr/:id     Tenant — suppression definitive (cascade)
     GET /api/qr/:id/stats  Tenant — agrégations scan (period=7d|30d|90d|all)
     GET /api/qr/:id/scans.csv Tenant — export brut (RGPD-safe : 0 PII)
     GET /sdqr-privacy        Public — page de transparence RGPD

   RGPD : aucune IP brute stockée. country via cf.country, device_kind
   et os_kind dérivés du User-Agent, ua_hash = sha-256(UA) tronqué.
   ═══════════════════════════════════════════════════════════════ */

import { json, err, parseBody, getAllowedOrigin, requireDevice, requireAdmin } from '../lib/auth.js';
import { requireJWT } from '../lib/jwt.js';
// Smart QR V2 — registry de templates (cf. ./smart-templates/index.js)
import { getTemplate, isKnownTemplate } from './smart-templates/index.js';
// Concierge VEFA (Sprint 2) — prompt déterministe + moteur IA + garde-fou budget.
import { buildConciergePrompt, conciergeTokenMap } from './smart-templates/concierge.js';
// Concierge VEFA (Sprint 7) — adaptation source « vefa » -> bloc canonique au
// save. Le front ne peut pas importer le contrat (module backend) ; l'adaptation
// se fait donc ICI, à la création/édition du QR concierge.
import { buildConciergeBlockFromVefa, buildConciergeBlockFromKeyform } from './smart-templates/concierge-schema.js';
import { KS_AI_MODEL } from '../lib/ai-model.js';
import { budgetGuard, recordUsage, estimateTokens } from '../lib/ai-budget.js';
import { isEnforceEnabled, resolvePlanByHmac, consumeCredits, quotaForPlan } from '../lib/ai-credits.js';
import { audit } from '../lib/audit.js';

// ── Helpers ────────────────────────────────────────────────────

// nanoid simplifié — 8 chars alphabet URL-safe = 218 trillion combos.
function shortId(len = 8) {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZabcdefghijkmnopqrstuvwxyz';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

// SHA-256(value) tronqué (Web Crypto API dispo sur Workers).
async function sha256Hex(value, truncate = 8) {
  const buf  = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  const hex  = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, truncate);
}

// Parse minimal du User-Agent. Pas de lib externe (poids), regex maison.
function parseUA(ua = '') {
  const s = String(ua).toLowerCase();
  let device = 'other';
  if (/ipad|tablet/i.test(s))                  device = 'tablet';
  else if (/mobile|iphone|android.*mobile/i.test(s)) device = 'mobile';
  else if (s)                                   device = 'desktop';

  let os = 'other';
  if (/iphone|ipad|ipod|ios/i.test(s))     os = 'ios';
  else if (/android/i.test(s))              os = 'android';
  else if (/windows/i.test(s))              os = 'windows';
  else if (/mac\s*os|macintosh/i.test(s))   os = 'macos';
  else if (/linux/i.test(s))                os = 'linux';

  return { device, os };
}

// Validation simple URL (Worker n'a pas le navigateur URL global mais bien `new URL`).
function isValidUrl(s) {
  try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { return false; }
}

// ── Conversion de mode (Sprint Concierge → Dynamic, 2026-06-03) ────
// Décide PUREMENT si un QR existant peut basculer entre 'smart'
// (interstitiel / Concierge IA) et 'dynamic' (redirection 302 simple), sur le
// MÊME short_id → le support imprimé ne change pas, stats + historique +
// template_data préservés. Aucune I/O → unit-testable (test-qr-convert.mjs).
// handleUpdateQr résout les faits (validité d'URL, droit IA) et applique le
// verdict en base.
//
//   smart → dynamic : allègement (coupe l'IA). Toujours permis au
//     propriétaire. Une URL de destination joignable DOIT exister à l'arrivée
//     (nouvelle fournie, ou l'existante du Concierge réutilisée — jamais de
//     bascule vers une redirection cassée).
//   dynamic → smart : rallumage IA. Gated via `smartAllowed` (admin ou licence
//     active reconnue) ; le coût par question reste de toute façon enforced au
//     scan par ai-credits (flag enforce_ai_credits_v1).
//   'static' n'est jamais une cible (un QR à short_id perdrait sa redirection)
//     et un mode cible inconnu est refusé.
export function evaluateModeConversion({
  currentMode, targetModeRaw, qrType, smartAllowed,
  newTargetUrl, newTargetUrlValid,
  existingTargetUrl, existingTargetUrlValid,
  hasTemplate,
}) {
  const targetMode = String(targetModeRaw || '').toLowerCase();
  if (targetMode !== 'smart' && targetMode !== 'dynamic') {
    return { ok: false, status: 400, error: 'Conversion impossible : le mode cible doit être « dynamic » ou « smart ».' };
  }
  if (currentMode === 'static') {
    return { ok: false, status: 400, error: "Un QR statique ne peut pas être converti (il n'a pas d'identifiant de redirection)." };
  }
  // Idempotent : déjà dans le mode cible → no-op (zéro écriture, zéro erreur).
  if (currentMode === targetMode) {
    return { ok: true, noop: true, newMode: currentMode, effectiveTargetUrl: null };
  }
  // Rallumage IA → gate licence (smartAllowed déjà résolu par le caller).
  if (targetMode === 'smart' && !smartAllowed) {
    return { ok: false, status: 403, error: 'Repasser en mode Concierge nécessite une licence active incluant ce mode.' };
  }
  // Cible joignable : URL fournie prioritaire, sinon réutilise l'existante.
  let effectiveTargetUrl = null;
  if (newTargetUrl != null) {
    if (!newTargetUrlValid) {
      return { ok: false, status: 400, error: 'URL de destination invalide (http/https requis).' };
    }
    effectiveTargetUrl = newTargetUrl;
  } else if (targetMode === 'dynamic' && qrType === 'url') {
    if (!existingTargetUrlValid) {
      return { ok: false, status: 400, error: 'Aucune URL de destination valide : renseignez une URL pour la redirection.' };
    }
    effectiveTargetUrl = existingTargetUrl;
  }
  // Vers smart sans template préservé → fallback (cohérent avec le create).
  const fallbackTemplate = targetMode === 'smart' && !hasTemplate;
  return { ok: true, newMode: targetMode, effectiveTargetUrl, fallbackTemplate };
}

// Sprint Sécu-1 / C2 : auth obligatoire pour tous les CRUD QR.
// Le tenant est dérivé du JWT licence (sub = lookup_hmac) OU du
// device token. Le header X-Tenant-Id n'est plus pris en compte —
// cela empêche le tenant spoofing par envoi d'un header arbitraire.
// Retourne null si auth absente ou invalide → 401 côté handler.
//
// Hotfix Sprint Kodex-1 : autorise aussi l'admin (Stéphane via
// KS_ADMIN_SECRET en Bearer) → accès au tenant 'default'. Cela
// rétablit l'usage SDQR depuis le dashboard admin tant que la
// flow JWT licence n'est pas configurée pour ces comptes.
// TODO long terme : exposer ?tenantId= côté admin pour pouvoir
// consulter les QR de tous les tenants (audit, support client).
async function _authTenant(request, env) {
  if (requireAdmin(request, env)) return 'default';
  const claims = await requireJWT(request, env);
  // Hotfix 2026-05-24 : un user authentifié en JWT avec claims.isAdmin === true
  // doit voir le tenant 'default' (où vivent les QRs créés via /admin avec
  // KS_ADMIN_SECRET). Sans ça, l'admin loggé en landing/magic-link perdait
  // l'accès à ses QRs créés dans une session précédente via /admin
  // (cas Stéphane "QR Prométhée invisible après reset" 24/05).
  if (claims?.isAdmin) return 'default';
  if (claims?.sub) return claims.sub;
  const device = await requireDevice(request, env);
  if (device?.tenant_id) return device.tenant_id;
  return null;
}

// ══════════════════════════════════════════════════════════════════
// GET /r/:shortId — redirect public + log scan (cœur SDQR)
// Sprint SDQR-2.5 : dispatch selon qr_type :
//   - url   → 302 redirect (legacy)
//   - vcard → .vcf file (Content-Type text/x-vcard)
//   - ical  → .ics file (Content-Type text/calendar)
//   - text  → HTML page lisible avec bouton Copier
// ══════════════════════════════════════════════════════════════════
export async function handleQrRedirect(request, env, shortId) {
  if (!shortId || shortId.length < 4 || shortId.length > 32) {
    return new Response('Not Found', { status: 404 });
  }

  // Lookup ultra-rapide via PRIMARY KEY (qr_redirects.short_id)
  // qr_type + encoded_payload servent à dispatcher selon le type (SDQR-2.5)
  const row = await env.DB
    .prepare('SELECT target_url, qr_type, encoded_payload, status FROM qr_redirects WHERE short_id = ?')
    .bind(shortId)
    .first();

  if (!row || row.status !== 'active') {
    return new Response('QR introuvable ou archivé', { status: 404 });
  }

  // Log scan (async, non bloquant) — RGPD safe : pas d IP brute
  const ua      = request.headers.get('User-Agent') || '';
  const country = request.cf?.country || null;
  const { device, os } = parseUA(ua);
  const uaHash  = await sha256Hex(ua, 8);
  try {
    await env.DB
      .prepare(`INSERT INTO qr_scans (short_id, country, device_kind, os_kind, ua_hash)
                VALUES (?, ?, ?, ?, ?)`)
      .bind(shortId, country, device, os, uaHash)
      .run();
  } catch (e) {
    console.warn('[qr-redirect] scan log failed:', e.message);
  }

  // SDQR Smart 2026-05-24 — Si le QR est en mode "smart", on intercepte
  // la redirection pour servir l'interstitiel IA. On lit le mode depuis
  // entities (la colonne qr_redirects ne porte pas le mode pour ne pas
  // exiger de migration). Bypass si query param `?direct=1` (utile pour
  // le bouton "Continuer" qui force le redirect après l'interstitiel).
  const url = new URL(request.url);
  const isDirectBypass = url.searchParams.get('direct') === '1';
  if (!isDirectBypass) {
    try {
      const entityRow = await env.DB
        .prepare(`SELECT data FROM entities
                  WHERE type = 'qr_codes' AND json_extract(data, '$.short_id') = ?
                  AND deleted_at IS NULL LIMIT 1`)
        .bind(shortId)
        .first();
      if (entityRow?.data) {
        const data = JSON.parse(entityRow.data);
        if (data.mode === 'smart') {
          // Délègue à handleSmartQrInterstitial — renvoie l'HTML interstitiel
          return await handleSmartQrInterstitial(request, env, shortId, {
            qr: data, target_url: row.target_url, qr_type: row.qr_type,
            encoded_payload: row.encoded_payload, scan: { country, device, os, ua },
          });
        }
      }
    } catch (e) {
      // Si la résolution entity échoue, on tombe sur le comportement standard
      // (redirect direct) — fail-safe pour ne jamais bloquer un scan.
      console.warn('[qr-redirect] smart mode lookup failed, falling back to direct:', e.message);
    }
  }

  const type = row.qr_type || 'url';

  // ── URL : 302 standard ──────────────────────────────────────
  if (type === 'url') {
    return Response.redirect(row.target_url, 302);
  }

  // ── vCard : .vcf téléchargeable (iOS / Android proposent "Ajouter contact") ──
  if (type === 'vcard') {
    return new Response(row.encoded_payload || '', {
      status: 200,
      headers: {
        'Content-Type': 'text/x-vcard; charset=utf-8',
        'Content-Disposition': `attachment; filename="contact-${shortId}.vcf"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  // ── iCal : .ics téléchargeable (iOS / Android proposent "Ajouter événement") ──
  if (type === 'ical') {
    return new Response(row.encoded_payload || '', {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="event-${shortId}.ics"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  // ── Texte : page HTML lisible avec bouton Copier ──
  if (type === 'text') {
    return new Response(_renderTextPage(row.encoded_payload || ''), {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  return new Response('Type non supporté : ' + type, { status: 500 });
}

// Page HTML standalone servie pour les QR texte dynamiques.
// Inline CSS pour aucune dépendance externe, look Keystone (navy / gold).
function _renderTextPage(text) {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
  }[c]));
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Keystone OS — Contenu</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;background:linear-gradient(180deg,#0a1024 0%,#060a18 100%);color:#e8edf8;min-height:100vh;padding:24px 20px;line-height:1.55}
  .wrap{max-width:560px;margin:0 auto}
  .pill{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#c9a84c;background:rgba(184,148,90,.10);border:1px solid rgba(184,148,90,.32);padding:5px 11px;border-radius:999px;margin-bottom:18px}
  h1{font-family:Georgia,"Times New Roman",serif;font-weight:600;font-size:22px;color:#fff;letter-spacing:-.01em;margin-bottom:18px}
  .card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.10);border-radius:10px;padding:20px;margin-bottom:14px;white-space:pre-wrap;word-break:break-word;font-size:15px;color:#fff}
  button{display:inline-flex;align-items:center;gap:8px;padding:11px 18px;background:#c9a84c;color:#1a1a1a;border:none;border-radius:8px;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;transition:transform .15s,background .15s}
  button:hover{background:#d4b27a;transform:translateY(-1px)}
  .foot{margin-top:30px;font-size:11px;color:rgba(220,225,240,.45);text-align:center;line-height:1.6}
  .foot strong{color:rgba(220,225,240,.7)}
</style>
</head>
<body>
<div class="wrap">
  <span class="pill">Keystone OS · Contenu dynamique</span>
  <h1>Contenu partagé</h1>
  <div class="card" id="content">${esc(text)}</div>
  <button id="copy">Copier le contenu</button>
  <div class="foot">
    Ce contenu est servi par un <strong>QR souverain Keystone</strong>.<br>
    Aucune donnée tierce collectée. <a href="/sdqr-privacy" style="color:#c9a84c;text-decoration:underline;text-underline-offset:2px">Politique de transparence</a>
  </div>
</div>
<script>
document.getElementById('copy').addEventListener('click',function(){
  navigator.clipboard.writeText(document.getElementById('content').textContent).then(function(){
    var b=document.getElementById('copy');b.textContent='✓ Copié';
    setTimeout(function(){b.textContent='Copier le contenu';},1500);
  });
});
</script>
</body>
</html>`;
}

// ══════════════════════════════════════════════════════════════════
// POST /api/qr — créer un QR (statique ou dynamique)
// Sprint SDQR-2 : accepte qr_type (url|text|vcard|wifi|ical) + mode
// (static|dynamic) + payload (objet typé).
// Mode dynamic : impose qr_type='url' + target_url + génère short_id.
// Mode static  : pas de short_id, pas de qr_redirects, encode côté client.
// ══════════════════════════════════════════════════════════════════
const ALLOWED_TYPES = new Set(['url', 'text', 'vcard', 'wifi', 'ical']);

export async function handleCreateQr(request, env) {
  const origin   = getAllowedOrigin(env, request);
  const tenantId = await _authTenant(request, env);
  if (!tenantId) return err('Auth requise', 401, origin);
  const body     = await parseBody(request);

  const name    = (body.name || '').toString().trim();
  const type    = (body.type || 'url').toString().toLowerCase();
  // SDQR Smart 2026-05-24 : 3e mode "smart" qui se comporte comme
  // "dynamic" côté tracking/short_id mais sert un interstitiel IA
  // contextuel avant la redirection finale.
  const rawMode = (body.mode || 'dynamic').toString().toLowerCase();
  const mode    = ['static', 'dynamic', 'smart'].includes(rawMode) ? rawMode : 'dynamic';
  const payload = (body.payload && typeof body.payload === 'object') ? body.payload : {};
  const design  = (body.design  && typeof body.design  === 'object') ? body.design  : {};
  const tags    = Array.isArray(body.tags) ? body.tags.slice(0, 12) : [];
  // Smart QR — titre + message saisis en direct par le propriétaire,
  // affichés tels quels sur l'interstitiel (plus d'IA depuis 2026-05-30).
  const smart_title   = (body.smart_title   || '').toString().trim().slice(0, 80);
  const smart_message = (body.smart_message || '').toString().trim().slice(0, 400);
  // Smart QR V2 — template_id sélectionné par le propriétaire (registry
  // ./smart-templates/). Optionnel : fallback 'storytelling-brand' au scan
  // (handleSmartQrInterstitial gère le fallback). Ici on valide juste
  // que l'id est connu ou vide.
  const template_id_raw = (body.template_id || '').toString().trim();
  if (mode === 'smart' && template_id_raw && !isKnownTemplate(template_id_raw)) {
    return err(`template_id inconnu : ${template_id_raw}`, 400, origin);
  }
  const template_id   = mode === 'smart' ? (template_id_raw || 'storytelling-brand') : null;
  // Concierge VEFA (S7 / S7.5) — provenance du bloc de connaissance :
  //   'inline' (défaut) : le studio SDQR a saisi le bloc canonique -> verbatim.
  //   'vefa'            : programme « à plat » de VEFA Studio (immo) adapté ICI.
  //   'keyform'         : submission générique du gabarit studio SDQR adaptée ICI.
  const concierge_source = (body.concierge_source || '').toString().trim().toLowerCase();
  // template_data : blob JSON libre (schéma défini par chaque template).
  // Limité à 32 KB pour éviter les abus / quotas D1.
  let template_data = null;
  if (mode === 'smart' && template_id === 'concierge' && concierge_source === 'vefa') {
    // Adaptation source -> bloc canonique au save (cf. concierge-schema.js).
    // validateBlock + cap 32 KB sont appliqués dans le helper.
    const res = buildConciergeBlockFromVefa(body.concierge_payload);
    if (res.error) return err(res.error, 400, origin);
    template_data = res.block;
  } else if (mode === 'smart' && template_id === 'concierge' && concierge_source === 'keyform') {
    // Source générique : keyformToBlock + validateBlock + cap dans le helper.
    const res = buildConciergeBlockFromKeyform(body.concierge_payload);
    if (res.error) return err(res.error, 400, origin);
    template_data = res.block;
  } else {
    const template_data_raw = body.template_data && typeof body.template_data === 'object'
      ? body.template_data : null;
    if (template_data_raw) {
      const json_str = JSON.stringify(template_data_raw);
      if (json_str.length > 64 * 1024) {
        return err('template_data trop volumineux (max 64 KB)', 400, origin);
      }
      template_data = template_data_raw;
    }
  }

  if (!name)                  return err('Le nom est obligatoire', 400, origin);
  if (!ALLOWED_TYPES.has(type)) return err(`Type inconnu : ${type}`, 400, origin);

  // Validation mode/type : Wi-Fi reste static-only (cf. spec SDQR-2.5).
  // URL/Text/vCard/iCal supportent les 2 autres modes (dynamic + smart).
  if (mode !== 'static' && type === 'wifi') {
    return err('Wi-Fi ne supporte que le mode statique.', 400, origin);
  }

  const id  = crypto.randomUUID();
  const now = new Date().toISOString();
  let target_url      = '';
  let encoded_payload = (body.encoded_payload || '').toString();
  let short = null;

  // dynamic + smart partagent : génération short_id, ligne qr_redirects.
  // La différence smart vs dynamic se joue à la lecture (handleQrRedirect),
  // pas à la création.
  const needsShortId = (mode === 'dynamic' || mode === 'smart');
  if (needsShortId) {
    if (type === 'url') {
      target_url = (body.target_url || payload?.url || '').toString().trim();
      if (!isValidUrl(target_url)) return err('target_url invalide (http/https requis)', 400, origin);
    } else {
      // Pour text/vcard/ical, le frontend pre-encode le payload
      // et nous envoie la string a servir. Worker ne refait pas l encoding.
      if (!encoded_payload.trim()) {
        return err('encoded_payload manquant pour QR dynamique/smart non-URL.', 400, origin);
      }
    }

    // Génère un short_id unique
    for (let i = 0; i < 3; i++) {
      const candidate = shortId(8);
      const exists = await env.DB
        .prepare('SELECT 1 FROM qr_redirects WHERE short_id = ?')
        .bind(candidate).first();
      if (!exists) { short = candidate; break; }
    }
    if (!short) return err('Impossible de générer un identifiant unique', 500, origin);
  }

  const entityData = {
    id, tenant_id: tenantId, type: 'qr_codes',
    name, qr_type: type, mode, payload, design, tags,
    short_id: short, status: 'active', created_at: now, updated_at: now,
    // Smart QR — titre + message statiques affichés sur l'interstitiel.
    // Stockés dans entities.data (JSON blob) — pas de migration SQL.
    smart_title:   smart_title   || null,
    smart_message: smart_message || null,
    // V2 templates programmables (cf. ./smart-templates/)
    template_id, template_data,
    // Concierge VEFA (S7) — provenance du bloc (inline | vefa), pour le miroir
    // SDQR et la ré-édition. null hors concierge (zéro bruit sur les autres QR).
    concierge_source: (template_id === 'concierge' && concierge_source) ? concierge_source : null,
  };

  try {
    if (needsShortId) {
      await env.DB
        .prepare(`INSERT INTO qr_redirects (short_id, qr_id, tenant_id, target_url, qr_type, encoded_payload, status)
                  VALUES (?, ?, ?, ?, ?, ?, 'active')`)
        .bind(short, id, tenantId, target_url, type, encoded_payload || null)
        .run();
    }

    await env.DB
      .prepare(`INSERT INTO entities (id, tenant_id, type, data) VALUES (?, ?, 'qr_codes', ?)`)
      .bind(id, tenantId, JSON.stringify(entityData))
      .run();

    return json({ qr: { ...entityData, target_url } }, 201, origin);
  } catch (e) {
    if (short) {
      await env.DB.prepare('DELETE FROM qr_redirects WHERE short_id = ?').bind(short).run().catch(() => {});
    }
    return err('Création échouée : ' + e.message, 500, origin);
  }
}

// ══════════════════════════════════════════════════════════════════
// GET /api/qr — liste les QRs du tenant (avec stats sommaires)
// ══════════════════════════════════════════════════════════════════
export async function handleListQr(request, env) {
  const origin   = getAllowedOrigin(env, request);
  const tenantId = await _authTenant(request, env);
  if (!tenantId) return err('Auth requise', 401, origin);

  // QRs = entités type='qr_codes' du tenant (non supprimées)
  const { results: qrRows } = await env.DB
    .prepare(`SELECT data FROM entities
              WHERE tenant_id = ? AND type = 'qr_codes' AND deleted_at IS NULL
              ORDER BY updated_at DESC`)
    .bind(tenantId)
    .all();

  const qrs = (qrRows || []).map(r => {
    try { return JSON.parse(r.data); } catch { return null; }
  }).filter(Boolean);

  if (qrs.length === 0) return json({ qrs: [] }, 200, origin);

  // Ajout des compteurs de scans + target_url courante (depuis qr_redirects)
  const shortIds = qrs.map(q => q.short_id).filter(Boolean);
  const placeholders = shortIds.map(() => '?').join(',');

  let scansMap = new Map();
  let targetsMap = new Map();
  if (shortIds.length) {
    const scans = await env.DB
      .prepare(`SELECT short_id, COUNT(*) AS total FROM qr_scans
                WHERE short_id IN (${placeholders}) GROUP BY short_id`)
      .bind(...shortIds).all();
    scans.results?.forEach(r => scansMap.set(r.short_id, r.total));

    const targets = await env.DB
      .prepare(`SELECT short_id, target_url FROM qr_redirects WHERE short_id IN (${placeholders})`)
      .bind(...shortIds).all();
    targets.results?.forEach(r => targetsMap.set(r.short_id, r.target_url));
  }

  const enriched = qrs.map(q => ({
    ...q,
    target_url   : targetsMap.get(q.short_id) || null,
    scans_total  : scansMap.get(q.short_id) || 0,
  }));

  return json({ qrs: enriched }, 200, origin);
}

// ══════════════════════════════════════════════════════════════════
// PATCH /api/qr/:id — modifie cible / nom / tags / status
// ══════════════════════════════════════════════════════════════════
export async function handleUpdateQr(request, env, qrId) {
  const origin   = getAllowedOrigin(env, request);
  const tenantId = await _authTenant(request, env);
  if (!tenantId) return err('Auth requise', 401, origin);
  const body     = await parseBody(request);

  // Charge l'entité existante
  const row = await env.DB
    .prepare(`SELECT data FROM entities
              WHERE tenant_id = ? AND type = 'qr_codes' AND id = ? AND deleted_at IS NULL`)
    .bind(tenantId, qrId).first();
  if (!row) return err('QR introuvable', 404, origin);

  let entity;
  try { entity = JSON.parse(row.data); } catch { return err('Données corrompues', 500, origin); }

  // Mise à jour des champs autorisés
  let targetChanged          = false;
  let encodedPayloadChanged  = false;
  if (body.name !== undefined)    entity.name   = String(body.name).trim() || entity.name;
  if (body.tags !== undefined)    entity.tags   = Array.isArray(body.tags) ? body.tags.slice(0, 12) : entity.tags;
  // Dossiers "Mes QR" (Phase 1, plats) : un nom libre stocké sur le QR,
  // comme un tag unique. null = retiré du dossier.
  if (body.folder !== undefined)  entity.folder = body.folder ? String(body.folder).trim().slice(0, 80) : null;
  if (body.design !== undefined)  entity.design = body.design;
  if (body.payload !== undefined) entity.payload = body.payload;
  // Smart QR — titre + message statiques de l'interstitiel, éditables après
  // création (comme la cible d'un QR dynamique). null = champ vidé.
  if (body.smart_title !== undefined) {
    entity.smart_title = String(body.smart_title).trim().slice(0, 80) || null;
  }
  if (body.smart_message !== undefined) {
    entity.smart_message = String(body.smart_message).trim().slice(0, 400) || null;
  }
  // Concierge VEFA (S7 / S7.5) — ré-adaptation du bloc à l'édition. Gated sur
  // template_id === 'concierge' (zéro impact sur les autres templates smart,
  // qui n'éditent pas template_data via PATCH). Symétrique du create :
  //   'vefa'    : programme « à plat » de VEFA Studio ré-adapté au save ;
  //   'keyform' : submission générique du gabarit studio ré-adaptée au save ;
  //   sinon     : template_data canonique verbatim (cap 32 KB).
  // Absent (ni source vefa/keyform ni template_data) => bloc existant intact.
  if (entity.template_id === 'concierge') {
    const upd_source = (body.concierge_source || '').toString().trim().toLowerCase();
    if (upd_source === 'vefa') {
      const res = buildConciergeBlockFromVefa(body.concierge_payload);
      if (res.error) return err(res.error, 400, origin);
      entity.template_data    = res.block;
      entity.concierge_source = 'vefa';
    } else if (upd_source === 'keyform') {
      const res = buildConciergeBlockFromKeyform(body.concierge_payload);
      if (res.error) return err(res.error, 400, origin);
      entity.template_data    = res.block;
      entity.concierge_source = 'keyform';
    } else if (body.template_data !== undefined && typeof body.template_data === 'object') {
      const json_str = JSON.stringify(body.template_data);
      if (json_str.length > 64 * 1024) {
        return err('template_data trop volumineux (max 64 KB)', 400, origin);
      }
      entity.template_data    = body.template_data;
      entity.concierge_source = upd_source || entity.concierge_source || 'inline';
    }
  }
  if (body.status !== undefined && ['active', 'archived'].includes(body.status)) {
    entity.status = body.status;
  }
  // ── Conversion de mode (Concierge ↔ redirection) — additif. Si body.mode est
  //    absent, comportement 100 % inchangé. Bascule sur le MÊME short_id : le
  //    QR imprimé reste valable, stats/historique/template_data préservés.
  let modeChanged         = false;
  let modeFrom            = null;
  let modeEffectiveTarget = null;
  if (body.mode !== undefined) {
    const targetMode = String(body.mode).toLowerCase();
    // Droit de (ré)activer le mode smart : l'admin (tenant 'default') est
    // toujours OK ; sinon il faut une licence active dont le plan inclut l'IA.
    // Le coût par question reste enforced au scan (ai-credits).
    let smartAllowed = true;
    if (targetMode === 'smart' && entity.mode !== 'smart' && tenantId !== 'default') {
      const lic = await env.DB
        .prepare('SELECT plan, is_active FROM licences WHERE lookup_hmac = ? LIMIT 1')
        .bind(tenantId).first().catch(() => null);
      smartAllowed = !!(lic && lic.is_active !== 0 && quotaForPlan(lic.plan) !== 0);
    }
    // URL fournie dans le body (champ éditable pré-rempli côté studio).
    const bodyUrl = (body.target_url !== undefined) ? String(body.target_url).trim() : null;
    // Cible existante du Concierge — lue seulement si on bascule vers une
    // redirection URL sans nouvelle URL fournie (on EXIGE une cible joignable).
    let existingUrl = null;
    if (targetMode === 'dynamic' && entity.qr_type === 'url' && bodyUrl == null) {
      const rd = await env.DB
        .prepare('SELECT target_url FROM qr_redirects WHERE short_id = ?')
        .bind(entity.short_id).first().catch(() => null);
      existingUrl = rd?.target_url || null;
    }
    const verdict = evaluateModeConversion({
      currentMode: entity.mode, targetModeRaw: body.mode, qrType: entity.qr_type,
      smartAllowed,
      newTargetUrl: bodyUrl, newTargetUrlValid: bodyUrl != null ? isValidUrl(bodyUrl) : false,
      existingTargetUrl: existingUrl, existingTargetUrlValid: existingUrl ? isValidUrl(existingUrl) : false,
      hasTemplate: !!entity.template_id,
    });
    if (!verdict.ok) return err(verdict.error, verdict.status || 400, origin);
    if (!verdict.noop) {
      modeFrom = entity.mode;
      if (verdict.fallbackTemplate) entity.template_id = 'storytelling-brand';
      entity.mode = verdict.newMode;
      modeChanged = true;
      modeEffectiveTarget = verdict.effectiveTargetUrl;
      // Si bodyUrl est fourni, le bloc target_url ci-dessous le persiste dans
      // qr_redirects ; sinon l'existante (validée) reste en place, intacte.
    }
  }
  if (body.target_url !== undefined) {
    if (entity.mode === 'static') {
      return err('Impossible de modifier la cible d\'un QR statique (regénérez un nouveau QR).', 400, origin);
    }
    if (entity.qr_type !== 'url') {
      return err('target_url ne s\'applique qu\'aux QR de type URL.', 400, origin);
    }
    if (!isValidUrl(body.target_url)) return err('target_url invalide', 400, origin);
    targetChanged = true;
  }
  // Sprint SDQR-2.5 : encoded_payload editable pour dynamic non-URL.
  // Le frontend recompute via sdqr-types.js et envoie la nouvelle string.
  if (body.encoded_payload !== undefined) {
    if (entity.mode === 'static') {
      return err('Le contenu d\'un QR statique n\'est pas modifiable (regénérez).', 400, origin);
    }
    if (entity.qr_type === 'url') {
      return err('Pour un QR URL, utilisez target_url plutôt qu\'encoded_payload.', 400, origin);
    }
    if (!String(body.encoded_payload).trim()) {
      return err('encoded_payload ne peut pas être vide.', 400, origin);
    }
    encodedPayloadChanged = true;
  }
  entity.updated_at = new Date().toISOString();

  try {
    await env.DB
      .prepare(`UPDATE entities SET data = ?, updated_at = datetime('now')
                WHERE tenant_id = ? AND type = 'qr_codes' AND id = ?`)
      .bind(JSON.stringify(entity), tenantId, qrId).run();

    if (targetChanged) {
      await env.DB
        .prepare(`UPDATE qr_redirects SET target_url = ?, updated_at = datetime('now')
                  WHERE short_id = ?`)
        .bind(body.target_url, entity.short_id).run();
    }
    if (encodedPayloadChanged) {
      await env.DB
        .prepare(`UPDATE qr_redirects SET encoded_payload = ?, updated_at = datetime('now')
                  WHERE short_id = ?`)
        .bind(body.encoded_payload, entity.short_id).run();
    }
    if (body.status !== undefined) {
      await env.DB
        .prepare(`UPDATE qr_redirects SET status = ?, updated_at = datetime('now')
                  WHERE short_id = ?`)
        .bind(entity.status, entity.short_id).run();
    }

    // Trace la conversion : un QR imprimé ne se redéploie pas → on garde de
    // quoi diagnostiquer/réparer si un client signale « mon QR a changé ».
    if (modeChanged) {
      await audit(env, {
        action: 'qr_mode_convert',
        actor:  tenantId === 'default' ? 'admin' : tenantId,
        target: entity.short_id,
        tenantId,
        details: {
          qr_id: qrId, from: modeFrom, to: entity.mode,
          template_id: entity.template_id || null,
          target_url: modeEffectiveTarget || null,
        },
        request,
      });
    }

    return json({ qr: { ...entity, target_url: body.target_url || modeEffectiveTarget || null } }, 200, origin);
  } catch (e) {
    return err('Mise à jour échouée : ' + e.message, 500, origin);
  }
}

// ══════════════════════════════════════════════════════════════════
// DELETE /api/qr/:id — suppression définitive (cascade)
// Pré-requis : le QR doit etre en status='archived' (double securite
// contre suppression accidentelle d un QR encore imprime/diffuse).
// Cascade : entities soft-delete + qr_redirects hard-delete +
// qr_scans conserves (audit historique, purge via cron policy a part).
// ══════════════════════════════════════════════════════════════════
export async function handleDeleteQr(request, env, qrId) {
  const origin   = getAllowedOrigin(env, request);
  const tenantId = await _authTenant(request, env);
  if (!tenantId) return err('Auth requise', 401, origin);

  const row = await env.DB
    .prepare(`SELECT data FROM entities
              WHERE tenant_id = ? AND type = 'qr_codes' AND id = ? AND deleted_at IS NULL`)
    .bind(tenantId, qrId).first();
  if (!row) return err('QR introuvable', 404, origin);

  let entity;
  try { entity = JSON.parse(row.data); } catch { return err('Données corrompues', 500, origin); }

  // Double securite : on n autorise la suppression definitive QUE pour
  // les QR deja archives. Force un archivage explicite d abord.
  if (entity.status !== 'archived') {
    return err('Archivez le QR avant de le supprimer définitivement.', 409, origin);
  }

  try {
    // 1. Soft-delete entity (preserve l audit / data fabric history)
    await env.DB
      .prepare(`UPDATE entities SET deleted_at = datetime('now'), updated_at = datetime('now')
                WHERE tenant_id = ? AND type = 'qr_codes' AND id = ?`)
      .bind(tenantId, qrId).run();

    // 2. Hard-delete redirect (libere le short_id, plus de redirection possible)
    await env.DB
      .prepare(`DELETE FROM qr_redirects WHERE short_id = ?`)
      .bind(entity.short_id).run();

    // 3. qr_scans conservés intentionnellement (audit/stats historiques).
    //    Une purge auto sera ajoutee en SDQR-5 (retention policy par tenant).

    return json({ deleted: true, id: qrId }, 200, origin);
  } catch (e) {
    return err('Suppression échouée : ' + e.message, 500, origin);
  }
}

// ══════════════════════════════════════════════════════════════════
// GET /api/qr/:id/stats — agrégations scans pour un QR (Sprint SDQR-4)
// Query string : period=7d|30d|90d|all (défaut 30d)
// Retour : { totals, byDay[], byCountry[], byDevice[], byOs[] }
// Tout est RGPD-safe : pas d IP brute exposée, juste les agrégats.
// ══════════════════════════════════════════════════════════════════

const PERIOD_DAYS = { '7d': 7, '30d': 30, '90d': 90, 'all': null };

export async function handleStatsQr(request, env, qrId) {
  const origin   = getAllowedOrigin(env, request);
  const tenantId = await _authTenant(request, env);
  if (!tenantId) return err('Auth requise', 401, origin);
  const url      = new URL(request.url);
  const period   = url.searchParams.get('period') || '30d';
  const days     = PERIOD_DAYS[period];   // null = all

  // Charge le QR pour récupérer son short_id (les scans sont indexés par short_id)
  const row = await env.DB
    .prepare(`SELECT data FROM entities
              WHERE tenant_id = ? AND type = 'qr_codes' AND id = ? AND deleted_at IS NULL`)
    .bind(tenantId, qrId).first();
  if (!row) return err('QR introuvable', 404, origin);

  let entity;
  try { entity = JSON.parse(row.data); } catch { return err('Données corrompues', 500, origin); }

  // QR statique : pas de scans trackés (par design, pas de /r/<id>)
  if (entity.mode === 'static') {
    return json({
      mode: 'static',
      info: 'Mode statique — aucun scan tracké (par design, RGPD natif).',
      totals: { total: 0, unique: 0, today: 0, week: 0 },
      byDay: [], byCountry: [], byDevice: [], byOs: [],
    }, 200, origin);
  }

  const shortId = entity.short_id;
  if (!shortId) {
    return json({ totals: { total:0, unique:0, today:0, week:0 }, byDay:[], byCountry:[], byDevice:[], byOs:[] }, 200, origin);
  }

  // Filtre temporel optionnel pour les agrégats. days numerique uniquement
  // (pas d'injection — vient de la whitelist PERIOD_DAYS).
  const periodWhere = days ? `AND ts >= datetime('now', '-${days} days')` : '';

  // ── Totaux ──────────────────────────────────────────────────
  // `unique` est un keyword reserve SQL → on l alias en uniq_count.
  // `today` compare via date(ts) pour simplicite (evite start-of-day).
  try {
    const totals = await env.DB.prepare(`
      SELECT
        COUNT(*)                AS total,
        COUNT(DISTINCT ua_hash) AS uniq_count,
        SUM(CASE WHEN date(ts) = date('now')                   THEN 1 ELSE 0 END) AS today,
        SUM(CASE WHEN ts >= datetime('now', '-7 days')         THEN 1 ELSE 0 END) AS week
      FROM qr_scans
      WHERE short_id = ? ${periodWhere}
    `).bind(shortId).first() || { total: 0, uniq_count: 0, today: 0, week: 0 };

  // ── Scans par jour (pour line chart) ───────────────────────
  const { results: byDay } = await env.DB.prepare(`
    SELECT date(ts) AS day, COUNT(*) AS cnt
    FROM qr_scans
    WHERE short_id = ? ${periodWhere}
    GROUP BY day
    ORDER BY day ASC
  `).bind(shortId).all();

  // ── Top pays ──────────────────────────────────────────────
  const { results: byCountry } = await env.DB.prepare(`
    SELECT country, COUNT(*) AS cnt
    FROM qr_scans
    WHERE short_id = ? AND country IS NOT NULL ${periodWhere}
    GROUP BY country
    ORDER BY cnt DESC
    LIMIT 10
  `).bind(shortId).all();

  // ── Device kind ────────────────────────────────────────────
  const { results: byDevice } = await env.DB.prepare(`
    SELECT device_kind, COUNT(*) AS cnt
    FROM qr_scans
    WHERE short_id = ? ${periodWhere}
    GROUP BY device_kind
    ORDER BY cnt DESC
  `).bind(shortId).all();

  // ── OS ─────────────────────────────────────────────────────
  const { results: byOs } = await env.DB.prepare(`
    SELECT os_kind, COUNT(*) AS cnt
    FROM qr_scans
    WHERE short_id = ? ${periodWhere}
    GROUP BY os_kind
    ORDER BY cnt DESC
  `).bind(shortId).all();

    return json({
      mode: 'dynamic',
      period,
      totals: {
        total : totals.total      || 0,
        unique: totals.uniq_count || 0,
        today : totals.today      || 0,
        week  : totals.week       || 0,
      },
      byDay     : (byDay     || []).map(r => ({ day: r.day, cnt: r.cnt })),
      byCountry : (byCountry || []).map(r => ({ country: r.country, cnt: r.cnt })),
      byDevice  : (byDevice  || []).map(r => ({ device: r.device_kind || 'other', cnt: r.cnt })),
      byOs      : (byOs      || []).map(r => ({ os: r.os_kind || 'other', cnt: r.cnt })),
    }, 200, origin);
  } catch (e) {
    console.error('[qr-stats]', e);
    return err('Stats query failed : ' + e.message, 500, origin);
  }
}

// ══════════════════════════════════════════════════════════════════
// GET /api/qr/:id/scans.csv — export brut des scans (RGPD-safe)
// Colonnes : ts, country, device_kind, os_kind, ua_hash (8 hex tronqué)
// Aucune PII exposée. Pour audit / import dans tableur tiers.
// ══════════════════════════════════════════════════════════════════
export async function handleScansCsv(request, env, qrId) {
  const origin   = getAllowedOrigin(env, request);
  const tenantId = await _authTenant(request, env);
  if (!tenantId) return err('Auth requise', 401, origin);

  const row = await env.DB
    .prepare(`SELECT data FROM entities
              WHERE tenant_id = ? AND type = 'qr_codes' AND id = ? AND deleted_at IS NULL`)
    .bind(tenantId, qrId).first();
  if (!row) return err('QR introuvable', 404, origin);

  let entity;
  try { entity = JSON.parse(row.data); } catch { return err('Données corrompues', 500, origin); }
  if (entity.mode === 'static' || !entity.short_id) {
    return new Response('ts,country,device_kind,os_kind,ua_hash\n', {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="scans-${qrId}.csv"`,
        'Access-Control-Allow-Origin': origin,
      },
    });
  }

  const { results } = await env.DB.prepare(`
    SELECT ts, country, device_kind, os_kind, ua_hash
    FROM qr_scans
    WHERE short_id = ?
    ORDER BY ts DESC
    LIMIT 10000
  `).bind(entity.short_id).all();

  const rows = (results || []).map(r =>
    `${r.ts},${r.country || ''},${r.device_kind || ''},${r.os_kind || ''},${r.ua_hash || ''}`
  ).join('\n');
  const csv = `ts,country,device_kind,os_kind,ua_hash\n${rows}`;

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="scans-${entity.short_id}.csv"`,
      'Access-Control-Allow-Origin': origin,
    },
  });
}

// ══════════════════════════════════════════════════════════════════
// GET /sdqr-privacy — page de transparence RGPD (Sprint SDQR-5)
// Page publique accessible depuis tout QR Keystone (lien en footer
// du viewer texte) qui expose noir sur blanc ce qui est tracké,
// combien de temps, comment exercer ses droits.
// ══════════════════════════════════════════════════════════════════
export async function handlePrivacyPage(request, env) {
  const retentionDays = parseInt(env.SDQR_SCAN_RETENTION_DAYS || '90', 10);
  const dpoEmail = env.SDQR_DPO_EMAIL || 'protein.keystone@gmail.com';
  return new Response(_renderPrivacyPage(retentionDays, dpoEmail), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

function _renderPrivacyPage(retentionDays, dpoEmail) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Politique de transparence — Dynamic QR</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;background:linear-gradient(180deg,#0a1024 0%,#060a18 100%);color:#e8edf8;min-height:100vh;line-height:1.65;padding:40px 24px 80px}
  .wrap{max-width:720px;margin:0 auto}
  .pill{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#c9a84c;background:rgba(184,148,90,.10);border:1px solid rgba(184,148,90,.32);padding:5px 12px;border-radius:999px;margin-bottom:24px}
  h1{font-family:'Cormorant Garamond',Georgia,serif;font-weight:600;font-size:36px;color:#fff;letter-spacing:-.02em;line-height:1.2;margin-bottom:14px}
  h2{font-family:'Cormorant Garamond',serif;font-weight:600;font-size:20px;color:#fff;margin:32px 0 12px;padding-top:24px;border-top:1px solid rgba(255,255,255,.08)}
  h2:first-of-type{border-top:none;padding-top:0}
  p{font-size:15px;color:rgba(220,225,240,.85);margin-bottom:12px}
  ul{margin:0 0 14px 22px;color:rgba(220,225,240,.85);font-size:14.5px}
  li{margin-bottom:6px}
  strong{color:#fff;font-weight:600}
  em{color:#c9a84c;font-style:normal;font-weight:500}
  .lead{font-size:17px;color:rgba(220,225,240,.95);line-height:1.65;margin-bottom:8px;font-family:'Cormorant Garamond',serif;font-style:italic}
  .card{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:18px 22px;margin:16px 0}
  .table{width:100%;border-collapse:collapse;margin:12px 0;font-size:14px}
  .table th,.table td{padding:9px 12px;text-align:left;border-bottom:1px solid rgba(255,255,255,.07)}
  .table th{color:rgba(220,225,240,.55);font-weight:600;font-size:11px;letter-spacing:.08em;text-transform:uppercase}
  .table td{color:rgba(220,225,240,.9)}
  code{background:rgba(0,0,0,.25);padding:2px 7px;border-radius:4px;font-family:'SF Mono',Menlo,monospace;font-size:13px;color:#a5b4fc}
  a{color:#c9a84c;text-decoration:none;border-bottom:1px dashed rgba(184,148,90,.4)}
  a:hover{color:#d4b27a;border-bottom-color:rgba(184,148,90,.7)}
  .foot{margin-top:48px;padding-top:24px;border-top:1px solid rgba(255,255,255,.08);font-size:12px;color:rgba(220,225,240,.45);text-align:center}
  .badge-ok{display:inline-block;padding:2px 8px;background:rgba(46,179,124,.12);color:#6ee7a7;border-radius:3px;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
  .badge-no{display:inline-block;padding:2px 8px;background:rgba(239,68,68,.10);color:#fca5a5;border-radius:3px;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
  .priv-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:24px}
  .priv-top .pill{margin-bottom:0}
  .back-btn{display:inline-flex;align-items:center;gap:6px;background:rgba(184,148,90,.10);border:1px solid rgba(184,148,90,.32);color:#c9a84c;font:inherit;font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;padding:5px 12px;border-radius:999px;cursor:pointer;transition:background .15s,border-color .15s,color .15s}
  .back-btn:hover{background:rgba(184,148,90,.18);border-color:rgba(184,148,90,.6);color:#d4b27a}
  .back-btn svg{width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
</style>
</head>
<body>
<div class="wrap">
  <div class="priv-top">
    <button type="button" class="back-btn" onclick="if(history.length>1){history.back()}else{window.close()}" aria-label="Retour">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>Retour
    </button>
    <span class="pill">Dynamic QR · Transparence</span>
  </div>
  <h1>Ce que ce QR collecte<br>et ce qu'il ne collecte pas</h1>
  <p class="lead">Vous venez de scanner un QR généré par Keystone OS. Voici, en clair, ce qui se passe.</p>

  <h2>Données collectées</h2>
  <p>Chaque scan d'un QR <strong>dynamique</strong> Keystone fait passer la requête par un serveur Cloudflare (datacenter UE). Nous y enregistrons strictement les informations suivantes :</p>
  <table class="table">
    <thead><tr><th>Donnée</th><th>Exemple</th><th>Pourquoi</th></tr></thead>
    <tbody>
      <tr><td>Date / heure</td><td><code>2026-05-12 14:23:00 UTC</code></td><td>Statistiques temporelles</td></tr>
      <tr><td>Pays</td><td><code>FR</code></td><td>Carte d'audience géographique</td></tr>
      <tr><td>Type d'appareil</td><td><code>mobile / desktop / tablet</code></td><td>Optimisation du contenu servi</td></tr>
      <tr><td>Système</td><td><code>ios / android / macos / windows / linux</code></td><td>Idem</td></tr>
      <tr><td>Empreinte UA</td><td><code>3f8a91b2</code> (8 chars)</td><td>Compteur de visiteurs uniques</td></tr>
    </tbody>
  </table>

  <h2>Ce que nous NE collectons PAS</h2>
  <ul>
    <li><span class="badge-no">Non</span> Adresse IP brute ni géolocalisation précise</li>
    <li><span class="badge-no">Non</span> Identifiant publicitaire mobile (IDFA, AAID…)</li>
    <li><span class="badge-no">Non</span> Cookie ni stockage local sur votre appareil</li>
    <li><span class="badge-no">Non</span> Aucun pixel tracker tiers (Google, Meta, X…)</li>
    <li><span class="badge-no">Non</span> Aucune donnée transmise à des régies publicitaires</li>
  </ul>
  <p>L'<em>empreinte UA</em> est un hash SHA-256 tronqué à 8 caractères du <em>User-Agent</em> de votre navigateur. Elle permet de distinguer si deux scans proviennent du même appareil <strong>sans pouvoir vous identifier</strong>. Elle est non-réversible.</p>

  <h2>Durée de conservation</h2>
  <p>Les logs de scan sont automatiquement supprimés après <strong>${retentionDays} jours</strong>. Une fois purgés, il est impossible de les reconstituer.</p>

  <h2>Souveraineté technique</h2>
  <div class="card">
    <p style="margin:0"><strong>Hébergement :</strong> Cloudflare Workers (datacenter Europe — frontière des données respectée).<br>
    <strong>Base de données :</strong> Cloudflare D1 SQLite, isolation tenant par chiffrement applicatif.<br>
    <strong>Aucun sous-traitant tiers</strong> n'a accès aux logs de scan (pas de Google Analytics, pas de Plausible, pas de Hotjar).</p>
  </div>

  <h2>Vos droits RGPD</h2>
  <p>Conformément au Règlement Général sur la Protection des Données (UE 2016/679), vous disposez des droits suivants :</p>
  <ul>
    <li><strong>Information</strong> (art. 13-14) — Cette page exerce ce droit.</li>
    <li><strong>Accès</strong> (art. 15) — Demande de copie des données vous concernant.</li>
    <li><strong>Rectification / effacement</strong> (art. 16-17) — Correction ou suppression anticipée.</li>
    <li><strong>Limitation</strong> (art. 18) — Gel du traitement en cas de contestation.</li>
    <li><strong>Portabilité</strong> (art. 20) — Export structuré CSV / JSON.</li>
    <li><strong>Opposition</strong> (art. 21) — Refus du traitement statistique.</li>
  </ul>
  <p>Pour exercer ces droits, contactez le DPO de l'opérateur du QR ou écrivez à :<br>
  <a href="mailto:${dpoEmail}">${dpoEmail}</a></p>

  <h2>Réclamation</h2>
  <p>Si vos demandes n'ont pas reçu de réponse satisfaisante, vous pouvez introduire une réclamation auprès de la <a href="https://www.cnil.fr/fr/plaintes" target="_blank" rel="noopener">CNIL</a> (Autorité de contrôle française).</p>

  <div class="foot">
    Politique publiée par <strong>Keystone OS</strong> — éditeur de l'artefact Dynamic QR.<br>
    Version 1.0 · ${new Date().toISOString().slice(0, 10)} · Conforme RGPD UE 2016/679.
  </div>
</div>
</body>
</html>`;
}

// ══════════════════════════════════════════════════════════════════
// Cron handler — auto-purge des scans > retention (Sprint SDQR-5)
// Déclenché par un scheduled trigger défini dans wrangler.toml.
// Default 90 jours, configurable via env.SDQR_SCAN_RETENTION_DAYS.
// ══════════════════════════════════════════════════════════════════
export async function handleScheduledPurge(env) {
  const retentionDays = parseInt(env.SDQR_SCAN_RETENTION_DAYS || '90', 10);

  // Sprint Sécu-2 / H9 — observabilité du cron :
  // Auto-migration de la table system_meta (idempotent, ne casse rien).
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS system_meta (
      key        TEXT PRIMARY KEY,
      value      TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run().catch(() => {});

  let purged = '?';
  let status = 'ok';
  let error  = null;
  try {
    const result = await env.DB
      .prepare(`DELETE FROM qr_scans WHERE ts < datetime('now', '-${retentionDays} days')`)
      .run();
    purged = result?.meta?.changes ?? '?';
    console.log(`[sdqr-purge] OK — supprimé ${purged} lignes anciennes (> ${retentionDays}j)`);
  } catch (e) {
    status = 'failed';
    error  = e.message;
    console.error('[sdqr-purge] FAILED', e.message);
  }

  // Enregistre toujours le timestamp, même en cas d'échec : permet à
  // /api/admin/health de détecter un cron qui rate régulièrement.
  await env.DB.prepare(`
    INSERT INTO system_meta (key, value, updated_at)
    VALUES ('last_purge_at', ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET
      value      = excluded.value,
      updated_at = excluded.updated_at
  `).bind(JSON.stringify({ status, purged, error, retentionDays })).run().catch(() => {});
}

// ══════════════════════════════════════════════════════════════════
// SDQR Smart QR — Interstitiel statique (2026-05-24, IA retirée 2026-05-30)
// ───────────────────────────────────────────────────────────────────
// Un scan de QR mode "smart" → page intermédiaire (template d'expérience
// d'attente) avant la redirection finale. Le titre + message affichés sont
// saisis en direct par le propriétaire (smart_title / smart_message) et
// rendus en statique côté serveur — plus d'appel IA ni de cache D1.
// handleSmartQrInterstitial dispatche vers le registry de templates
// (cf. ./smart-templates/index.js) ; chaque template rend sa page complète.
// ══════════════════════════════════════════════════════════════════

// Appelé depuis handleQrRedirect quand data.mode === 'smart'. Dispatcher
// vers le registry de templates. Le QR porte son template_id dans
// entities.data (fallback 'storytelling-brand' si absent ou supprimé).
export async function handleSmartQrInterstitial(request, env, shortId, ctx) {
  const qrData      = ctx?.qr || {};
  const template    = getTemplate(qrData.template_id || 'storytelling-brand');
  // Injecte short_id dans qrData pour que renderHTML puisse construire les
  // URLs /r/SHORTID?direct=1 (le QR data en base n'a pas toujours short_id
  // dénormalisé selon les contextes d'appel).
  const enrichedQr  = { ...qrData, short_id: shortId };
  const scanCtx     = ctx?.scan || {};
  const html        = template.renderHTML(enrichedQr, scanCtx);
  return new Response(html, {
    status:  200,
    headers: {
      'Content-Type':  'text/html; charset=utf-8',
      'Cache-Control': 'no-store', // contextuel par essence
    },
  });
}

// ══════════════════════════════════════════════════════════════════
// Smart QR V4.3 (2026-05-26) — Endpoint authoritative pour les jeux
// ───────────────────────────────────────────────────────────────────
// Endpoint PUBLIC appelé depuis les templates machine-a-sous + carte-a-
// gratter. Tire l'aléatoire CÔTÉ SERVEUR (jamais côté client = anti-
// triche), enregistre le play en D1 pour l'anti-rejouage, et retourne
// le résultat. Le client n'a qu'à animer le résultat reçu.
//
// Contrat : POST /api/smartqr/game-play { short_id }
//   → { result: 'win'|'lose', symboles?: [s1,s2,s3], code_won?: string,
//       message: string, replay_blocked?: boolean }
//
// Anti-abus :
//   - device_hash = sha256(UA + cf-connecting-ip).slice(0,16) — anonyme
//   - Si template_data.un_jeu_par_appareil=true → 1 play par device_hash
//   - lots_disponibles : check COUNT(*) WHERE result='win' avant de
//     tirer. Race condition possible sur le dernier lot (acceptée V1).
// ══════════════════════════════════════════════════════════════════

let _smartGameTableReady = false;
async function _ensureSmartGameTable(env) {
  if (_smartGameTableReady) return;
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS smartqr_game_plays (
        short_id    TEXT NOT NULL,
        device_hash TEXT NOT NULL,
        played_at   TEXT NOT NULL DEFAULT (datetime('now')),
        result      TEXT NOT NULL,
        code_won    TEXT,
        tier_label  TEXT,
        PRIMARY KEY (short_id, device_hash, played_at)
      )
    `).run();
    // V4.7 — tier_label : libellé du lot gagné (carte à gratter multi-lots).
    // ALTER idempotent pour les bases créées avant V4.7.
    try {
      await env.DB.prepare(`ALTER TABLE smartqr_game_plays ADD COLUMN tier_label TEXT`).run();
    } catch (e) { /* colonne déjà présente */ }
    // Index pour les COUNT(*) WHERE result='win' rapides
    await env.DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_smartqr_game_wins
      ON smartqr_game_plays (short_id, result)
    `).run();
    _smartGameTableReady = true;
  } catch (e) {
    console.warn('[smartqr] game-plays table init failed:', e.message);
  }
}

async function _deviceHash(request) {
  const ua = request.headers.get('User-Agent') || '?';
  const ip = request.headers.get('cf-connecting-ip')
          || request.headers.get('x-forwarded-for')
          || '?';
  const seed = ua + '|' + ip;
  const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed));
  const hex  = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 16);
}

// V4.3 UX (2026-05-26) — Génère un code de gain unique cryptographiquement
// signé. Format : WIN-XXXX-XXXX (8 chars hex en 2 blocs). Impossible à
// inventer sans le secret serveur. Reproductible : 2 appels avec les mêmes
// (shortId, deviceHash, ts) donnent le même code.
//
// Le secret SMARTQR_SIGN_SECRET doit être configuré en prod via :
//   wrangler secret put SMARTQR_SIGN_SECRET
// En dev (ou si non configuré) fallback à un secret constant. Pas critique
// car le but est juste l'anti-falsification triviale, pas la résistance NSA.
async function _generateWinCode(env, shortId, deviceHash, ts) {
  const secret = env.SMARTQR_SIGN_SECRET || 'keystone-dev-secret-2026-05';
  const seed   = `${shortId}|${deviceHash}|${ts}|${secret}`;
  const buf    = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed));
  const hex    = Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  return `WIN-${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}

function _pickRandomSymbols(symbols, isWin) {
  // symbols : array de 5-10 symboles/emojis fournis par le proprio
  // Si gain : 3 fois le même
  // Si perte : 3 symboles non-tous-identiques (au moins 1 différent)
  const safe = Array.isArray(symbols) && symbols.length >= 1 ? symbols : ['🍒', '🍋', '⭐', '🔔', '💎'];
  const pick = () => safe[Math.floor(Math.random() * safe.length)];
  if (isWin) {
    const s = pick();
    return [s, s, s];
  }
  // Perte : tirer 3 et garantir que ce n'est pas tous identiques
  for (let i = 0; i < 6; i++) {
    const trio = [pick(), pick(), pick()];
    if (!(trio[0] === trio[1] && trio[1] === trio[2])) return trio;
  }
  // Fallback si symbols n'a qu'un seul élément (forçage win impossible) :
  // on retourne quand même 3 identiques mais on marque comme perte côté
  // caller. Pas idéal mais le proprio aurait dû fournir + de symboles.
  return [pick(), pick(), pick()];
}

export async function handleSmartQrGamePlay(request, env) {
  const origin = '*'; // public, pas d'auth
  await _ensureSmartGameTable(env);

  const body    = await parseBody(request);
  const shortId = (body.short_id || '').toString().trim();
  if (!shortId || shortId.length < 4 || shortId.length > 32) {
    return err('short_id invalide', 400, origin);
  }

  // Récupère le QR (mode smart obligatoire, template machine-a-sous ou carte-a-gratter)
  let qrData = null;
  try {
    const entityRow = await env.DB
      .prepare(`SELECT data FROM entities
                WHERE type = 'qr_codes' AND json_extract(data, '$.short_id') = ?
                AND deleted_at IS NULL LIMIT 1`)
      .bind(shortId)
      .first();
    if (entityRow?.data) qrData = JSON.parse(entityRow.data);
  } catch (e) {
    return err('Lookup entity échoué : ' + e.message, 500, origin);
  }
  if (!qrData) return err('QR introuvable', 404, origin);
  if (qrData.mode !== 'smart') return err('QR non Smart', 400, origin);

  const tplId = qrData.template_id || '';
  if (tplId !== 'machine-a-sous' && tplId !== 'carte-a-gratter') {
    return err('Template non-jeu', 400, origin);
  }

  const td = qrData.template_data || {};
  const tauxGain = Math.max(0, Math.min(100, Number(td.taux_de_gain) || 20));
  const lotsMax  = Number.isFinite(Number(td.lots_disponibles)) && Number(td.lots_disponibles) > 0
                 ? Math.floor(Number(td.lots_disponibles))
                 : null; // null = illimité
  const unParAppareil = td.un_jeu_par_appareil === true || td.un_jeu_par_appareil === 'true';

  const deviceH = await _deviceHash(request);

  // Anti-rejouage si activé
  if (unParAppareil) {
    try {
      const prev = await env.DB
        .prepare(`SELECT result, code_won, tier_label FROM smartqr_game_plays
                  WHERE short_id = ? AND device_hash = ?
                  ORDER BY played_at DESC LIMIT 1`)
        .bind(shortId, deviceH)
        .first();
      if (prev) {
        // Renvoie le résultat précédent + flag replay_blocked. En multi-lots,
        // tier_label = le lot précis regagné ; sinon message_gain unique.
        const symbols = (td.symboles_cylindre || '').toString().split('\n')
          .map(s => s.trim()).filter(Boolean);
        const trio = _pickRandomSymbols(symbols, prev.result === 'win');
        const wonPrev = prev.tier_label || td.message_gain || 'Bravo !';
        return json({
          result:          prev.result,
          symboles:        trio,
          code_won:        prev.code_won || '',
          won_lot:         prev.result === 'win' ? (prev.tier_label || '') : '',
          message_gain:    wonPrev,
          message:         prev.result === 'win'
                             ? wonPrev
                             : (td.message_perte || 'Merci d\'avoir tenté ta chance — à bientôt !'),
          replay_blocked:  true,
        }, 200, origin);
      }
    } catch (e) { /* miss = on continue normalement */ }
  }

  // ── Multi-lots (carte à gratter, V4.7) ─────────────────────────
  // Si des `lots` sont définis (carte-a-gratter uniquement), on tire QUEL
  // lot selon sa probabilité, avec plafond de gagnants par lot. Sinon →
  // binaire historique (taux global + message unique). La machine à sous
  // n'a jamais de `lots` → elle reste strictement sur le chemin binaire.
  const lots = (tplId === 'carte-a-gratter' && Array.isArray(td.lots))
    ? td.lots.map(l => ({
        label: String(l?.label || '').trim(),
        proba: Math.max(0, Math.min(100, Number(l?.proba) || 0)),
        max:   Number.isFinite(Number(l?.max)) && Number(l?.max) > 0 ? Math.floor(Number(l.max)) : 0,
      })).filter(l => l.label).slice(0, 3)
    : [];
  const multi = lots.length > 0;

  let isWin = false;
  let wonLabel = '';

  if (multi) {
    // Bandes de probabilité cumulées, dans l'ordre des lots. Un lot dont le
    // plafond est atteint conserve sa bande mais ne paie plus → le tirage y
    // tombe en "perdu" (le lot est épuisé). Les probas restent donc fixes.
    const draw = Math.random() * 100;
    let cumul = 0;
    for (const lot of lots) {
      const lo = cumul, hi = cumul + lot.proba;
      cumul = hi;
      if (draw >= lo && draw < hi) {
        if (lot.max > 0) {
          let n = 0;
          try {
            const r = await env.DB
              .prepare(`SELECT COUNT(*) AS n FROM smartqr_game_plays
                        WHERE short_id = ? AND result = 'win' AND tier_label = ?`)
              .bind(shortId, lot.label).first();
            n = Number(r?.n || 0);
          } catch (e) { /* best-effort */ }
          if (n < lot.max) { isWin = true; wonLabel = lot.label; }
        } else {
          isWin = true; wonLabel = lot.label;
        }
        break;
      }
    }
  } else {
    // Binaire historique (+ stock global lots_disponibles).
    let stockEpuise = false;
    if (lotsMax !== null) {
      try {
        const winsRow = await env.DB
          .prepare(`SELECT COUNT(*) AS n FROM smartqr_game_plays
                    WHERE short_id = ? AND result = 'win'`)
          .bind(shortId).first();
        if (Number(winsRow?.n || 0) >= lotsMax) stockEpuise = true;
      } catch (e) { /* on continue */ }
    }
    isWin = !stockEpuise && (Math.random() * 100) < tauxGain;
    if (isWin) wonLabel = td.message_gain || 'Bravo, tu as gagné !';
  }

  // Symboles (machine à sous uniquement ; le client affiche selon template_id)
  const symbols = (td.symboles_cylindre || '').toString().split('\n')
    .map(s => s.trim()).filter(Boolean);
  const trio = _pickRandomSymbols(symbols, isWin);

  // Code de gain signé (uniquement si gain)
  let codeWon = '';
  if (isWin) {
    const ts = Date.now().toString();
    codeWon = await _generateWinCode(env, shortId, deviceH, ts);
  }

  // Enregistre le play (tier_label = lot gagné en multi-lots, sinon '')
  try {
    await env.DB
      .prepare(`INSERT INTO smartqr_game_plays
                (short_id, device_hash, played_at, result, code_won, tier_label)
                VALUES (?, ?, datetime('now'), ?, ?, ?)`)
      .bind(shortId, deviceH, isWin ? 'win' : 'lose', codeWon, isWin ? wonLabel : '')
      .run();
  } catch (e) {
    console.warn('[smartqr] game-play insert failed:', e.message);
  }

  const winMsg = wonLabel || td.message_gain || 'Bravo, tu as gagné !';
  return json({
    result:       isWin ? 'win' : 'lose',
    symboles:     trio,
    code_won:     codeWon,
    won_lot:      isWin ? wonLabel : '',
    message_gain: winMsg,
    message:      isWin
                    ? winMsg
                    : (td.message_perte || 'Merci d\'avoir tenté ta chance — à bientôt !'),
    replay_blocked: false,
  }, 200, origin);
}

// ══════════════════════════════════════════════════════════════════
// V4.3 (2026-05-26) — Endpoint de vérification d'authenticité d'un code
// de gain. Permet au commerçant de confirmer qu'un code WIN-XXXX-XXXX
// présenté par un client est bien authentique (issu d'un vrai gain
// enregistré dans D1) et de récupérer le contexte (QR concerné, date,
// message du commerçant).
//
// Contrat : GET /api/smartqr/verify-win?code=WIN-XXXX-XXXX
//   → 200 { valid: true, short_id, played_at, message_gain, qr_name }
//   → 200 { valid: false } si code inconnu (404 serait gênant pour le
//                          commerçant qui croirait à une erreur réseau)
// ══════════════════════════════════════════════════════════════════
export async function handleSmartQrVerifyWin(request, env) {
  const origin = '*';
  await _ensureSmartGameTable(env);
  await _ensureSmartLoyaltyTable(env);

  const url  = new URL(request.url);
  const code = (url.searchParams.get('code') || '').trim().toUpperCase();
  // Format strict : WIN-XXXX-XXXX (8 chars hex en 2 blocs)
  if (!/^WIN-[0-9A-F]{4}-[0-9A-F]{4}$/.test(code)) {
    return json({ valid: false, reason: 'format_invalide' }, 200, origin);
  }

  // V4.4 (2026-05-26) : un même code peut provenir soit d'un gain jeu
  // (machine à sous, carte à gratter), soit d'une récompense fidélité
  // (carte de fidélité). On cherche dans les 2 tables et on garde le
  // résultat. `source` distingue le type pour que la page commerçant
  // puisse afficher le bon libellé.
  let row = null;
  let source = '';
  try {
    row = await env.DB
      .prepare(`SELECT short_id, played_at AS issued_at, tier_label FROM smartqr_game_plays
                WHERE code_won = ? AND result = 'win' LIMIT 1`)
      .bind(code)
      .first();
    if (row) source = 'game';
  } catch (e) {
    return err('Lookup jeu échoué : ' + e.message, 500, origin);
  }
  if (!row) {
    try {
      row = await env.DB
        .prepare(`SELECT short_id, last_stamp_at AS issued_at FROM smartqr_loyalty_stamps
                  WHERE reward_code = ? LIMIT 1`)
        .bind(code)
        .first();
      if (row) source = 'loyalty';
    } catch (e) {
      return err('Lookup fidélité échoué : ' + e.message, 500, origin);
    }
  }

  if (!row) {
    return json({ valid: false, reason: 'code_inconnu' }, 200, origin);
  }

  // Récupère le QR pour donner contexte au commerçant
  let qrName = '', messageGain = '';
  try {
    const entityRow = await env.DB
      .prepare(`SELECT data FROM entities
                WHERE type = 'qr_codes' AND json_extract(data, '$.short_id') = ?
                AND deleted_at IS NULL LIMIT 1`)
      .bind(row.short_id)
      .first();
    if (entityRow?.data) {
      const qr = JSON.parse(entityRow.data);
      qrName = (qr.name || '').toString().slice(0, 80);
      // Le message à montrer en caisse dépend de la source :
      //   - jeu      → template_data.message_gain ("Glace offerte avec ce QR")
      //   - fidélité → template_data.nom_recompense ("Café offert")
      if (source === 'loyalty') {
        messageGain = (qr?.template_data?.nom_recompense || '').toString().slice(0, 240);
      } else {
        // Multi-lots : le lot précis gagné est mémorisé sur la partie ;
        // sinon (binaire) on retombe sur le message_gain unique du QR.
        messageGain = (row.tier_label || qr?.template_data?.message_gain || '').toString().slice(0, 240);
      }
    }
  } catch (e) { /* contexte best-effort */ }

  return json({
    valid:        true,
    source:       source,           // 'game' ou 'loyalty' (V4.4)
    short_id:     row.short_id,
    played_at:    row.issued_at,    // legacy name conservé pour la page commerçant
    qr_name:      qrName,
    message_gain: messageGain,
  }, 200, origin);
}

// ══════════════════════════════════════════════════════════════════
// Smart QR V4.4 (2026-05-26) — Endpoint authoritative carte de fidélité
// ───────────────────────────────────────────────────────────────────
// Endpoint PUBLIC appelé au load du template carte-fidelite. Incrémente
// le compteur de tampons côté SERVEUR (jamais côté client = anti-triche),
// applique la règle de validité (reset si trop de jours depuis le 1er
// tampon), et débloque la récompense au Nᵉ tampon avec code signé.
//
// Contrat : POST /api/smartqr/loyalty-stamp { short_id }
//   → {
//       stamps_count    : number,   // total tampons dans le cycle actuel
//       stamps_total    : number,   // objectif (nb_tampons_total config)
//       stamps_added    : 0|1,      // 1 si on a réellement ajouté un tampon
//       reward_unlocked : boolean,  // true si stamps_count ≥ stamps_total
//       reward_code     : string,   // code WIN-XXXX-XXXX (vide si pas débloqué)
//       reward_name     : string,   // libellé proprio (ex "Café offert")
//       cycle_reset     : boolean,  // true si la validité expirée a remis à 0
//       first_stamp_at  : string,   // ISO du 1er tampon du cycle
//     }
//
// Anti-abus :
//   - device_hash = sha256(UA + cf-connecting-ip).slice(0,16) — anonyme
//   - Délai mini 60s entre 2 tampons par device → empêche un user de
//     spammer le bouton refresh. Au-delà du seuil "stamps_added=0",
//     on renvoie l'état actuel sans incrémenter (le client peut quand
//     même afficher la carte).
// ══════════════════════════════════════════════════════════════════

let _smartLoyaltyTableReady = false;
async function _ensureSmartLoyaltyTable(env) {
  if (_smartLoyaltyTableReady) return;
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS smartqr_loyalty_stamps (
        short_id       TEXT NOT NULL,
        device_hash    TEXT NOT NULL,
        stamps_count   INTEGER NOT NULL DEFAULT 0,
        first_stamp_at TEXT NOT NULL,
        last_stamp_at  TEXT NOT NULL,
        redeemed_at    TEXT,
        reward_code    TEXT,
        PRIMARY KEY (short_id, device_hash)
      )
    `).run();
    _smartLoyaltyTableReady = true;
  } catch (e) {
    console.warn('[smartqr] loyalty-stamps table init failed:', e.message);
  }
}

const _LOYALTY_MIN_INTERVAL_MS = 60 * 1000; // 60s minimum entre 2 tampons

export async function handleSmartQrLoyaltyStamp(request, env) {
  const origin = '*';
  await _ensureSmartLoyaltyTable(env);

  const body    = await parseBody(request);
  const shortId = (body.short_id || '').toString().trim();
  if (!shortId || shortId.length < 4 || shortId.length > 32) {
    return err('short_id invalide', 400, origin);
  }

  // Récupère le QR (mode smart, template carte-fidelite obligatoire)
  let qrData = null;
  try {
    const entityRow = await env.DB
      .prepare(`SELECT data FROM entities
                WHERE type = 'qr_codes' AND json_extract(data, '$.short_id') = ?
                AND deleted_at IS NULL LIMIT 1`)
      .bind(shortId)
      .first();
    if (entityRow?.data) qrData = JSON.parse(entityRow.data);
  } catch (e) {
    return err('Lookup entity échoué : ' + e.message, 500, origin);
  }
  if (!qrData) return err('QR introuvable', 404, origin);
  if (qrData.mode !== 'smart') return err('QR non Smart', 400, origin);
  if (qrData.template_id !== 'carte-fidelite') {
    return err('Template non-fidélité', 400, origin);
  }

  const td = qrData.template_data || {};
  const stampsTotalRaw = Number(td.nb_tampons_total);
  const stampsTotal = Number.isFinite(stampsTotalRaw) && stampsTotalRaw >= 3 && stampsTotalRaw <= 30
                    ? Math.floor(stampsTotalRaw) : 10;
  const validityDaysRaw = Number(td.validite_jours);
  const validityDays = Number.isFinite(validityDaysRaw) && validityDaysRaw > 0
                     ? Math.floor(validityDaysRaw) : 90;
  const rewardName = (td.nom_recompense || 'Récompense fidélité').toString().slice(0, 80);

  const deviceH = await _deviceHash(request);
  const nowIso  = new Date().toISOString();
  const nowMs   = Date.now();

  // Lit l'état actuel pour ce (short_id, device_hash)
  let row = null;
  try {
    row = await env.DB
      .prepare(`SELECT stamps_count, first_stamp_at, last_stamp_at, reward_code
                FROM smartqr_loyalty_stamps
                WHERE short_id = ? AND device_hash = ?`)
      .bind(shortId, deviceH)
      .first();
  } catch (e) {
    // Miss = on continue avec row=null (nouveau scanneur)
  }

  let stampsCount   = 0;
  let firstStampIso = nowIso;
  let lastStampIso  = nowIso;
  let rewardCode    = '';
  let stampsAdded   = 0;
  let cycleReset    = false;

  if (!row) {
    // 1er scan : insertion d'une ligne vierge à 1 tampon
    stampsCount = 1;
    stampsAdded = 1;
    try {
      await env.DB
        .prepare(`INSERT INTO smartqr_loyalty_stamps
                  (short_id, device_hash, stamps_count, first_stamp_at, last_stamp_at, reward_code)
                  VALUES (?, ?, 1, ?, ?, NULL)`)
        .bind(shortId, deviceH, nowIso, nowIso)
        .run();
    } catch (e) {
      console.warn('[smartqr] loyalty insert failed:', e.message);
    }
  } else {
    // Scan suivant : vérifie validité, anti-spam, incrément
    const firstAtMs = new Date(row.first_stamp_at).getTime();
    const lastAtMs  = new Date(row.last_stamp_at).getTime();
    const ageDays   = Number.isFinite(firstAtMs)
                    ? (nowMs - firstAtMs) / (24 * 3600 * 1000) : 0;
    const sinceLastMs = Number.isFinite(lastAtMs) ? (nowMs - lastAtMs) : Infinity;

    // Cas 1 : cycle expiré → reset (nouveau cycle à 1 tampon)
    if (ageDays > validityDays) {
      stampsCount = 1;
      stampsAdded = 1;
      cycleReset  = true;
      firstStampIso = nowIso;
      try {
        await env.DB
          .prepare(`UPDATE smartqr_loyalty_stamps
                    SET stamps_count = 1, first_stamp_at = ?, last_stamp_at = ?,
                        reward_code = NULL, redeemed_at = NULL
                    WHERE short_id = ? AND device_hash = ?`)
          .bind(nowIso, nowIso, shortId, deviceH)
          .run();
      } catch (e) { console.warn('[smartqr] loyalty reset failed:', e.message); }
    }
    // Cas 2 : cycle complet, récompense déjà débloquée → renvoie l'état
    else if (row.stamps_count >= stampsTotal && row.reward_code) {
      stampsCount   = row.stamps_count;
      stampsAdded   = 0;
      firstStampIso = row.first_stamp_at;
      lastStampIso  = row.last_stamp_at;
      rewardCode    = row.reward_code;
    }
    // Cas 3 : anti-spam, scan trop rapproché → renvoie état sans incrémenter
    else if (sinceLastMs < _LOYALTY_MIN_INTERVAL_MS) {
      stampsCount   = row.stamps_count;
      stampsAdded   = 0;
      firstStampIso = row.first_stamp_at;
      lastStampIso  = row.last_stamp_at;
      rewardCode    = row.reward_code || '';
    }
    // Cas 4 : incrément normal
    else {
      stampsCount   = row.stamps_count + 1;
      stampsAdded   = 1;
      firstStampIso = row.first_stamp_at;
      lastStampIso  = nowIso;

      // Génère le code de récompense si on atteint le seuil
      if (stampsCount >= stampsTotal && !row.reward_code) {
        rewardCode = await _generateWinCode(env, shortId, deviceH, nowMs.toString());
      } else {
        rewardCode = row.reward_code || '';
      }

      try {
        await env.DB
          .prepare(`UPDATE smartqr_loyalty_stamps
                    SET stamps_count = ?, last_stamp_at = ?, reward_code = ?
                    WHERE short_id = ? AND device_hash = ?`)
          .bind(stampsCount, nowIso, rewardCode || null, shortId, deviceH)
          .run();
      } catch (e) { console.warn('[smartqr] loyalty update failed:', e.message); }
    }
  }

  const rewardUnlocked = stampsCount >= stampsTotal && !!rewardCode;

  return json({
    stamps_count:    stampsCount,
    stamps_total:    stampsTotal,
    stamps_added:    stampsAdded,
    reward_unlocked: rewardUnlocked,
    reward_code:     rewardCode || '',
    reward_name:     rewardName,
    cycle_reset:     cycleReset,
    first_stamp_at:  firstStampIso,
  }, 200, origin);
}

// Template HTML interstitiel — chaque layout vit dans ./smart-templates/.
// Le dispatcher handleSmartQrInterstitial appelle template.renderHTML() depuis
// le registry. Pour ajouter un nouveau layout (menu, tombola, etc.), créer un
// nouveau template dans ./smart-templates/ — aucune modification de qr.js requise.

// ══════════════════════════════════════════════════════════════════
// Smart QR Concierge VEFA (2026-05-30, Sprint 2) — Chat live SSE
// ───────────────────────────────────────────────────────────────────
// Endpoint PUBLIC (visiteur anonyme qui scanne) : reçoit une QUESTION
// libre, charge le bloc de connaissance du programme (entities.data),
// construit le system prompt déterministe (buildConciergePrompt), appelle
// Mistral Small 3.1 24B en STREAM et relaie la réponse en SSE.
//
// L'IA n'intervient QUE sur la question libre (jugement requis) ; accueil,
// cartes et chiffres restent déterministes (renderHTML). Cohérent avec le
// principe directeur du brief (un appel LLM seulement si l'entrée est
// vraiment inconnue ET exige du jugement).
//
// Contrat : POST /api/smartqr/concierge { short_id, question, history? }
//   history? = [{ role:'user'|'assistant', content:string }, …] (capé)
//   SSE →  data: {"type":"start"}
//          data: {"type":"chunk","text":"…"}      (×N)
//          data: {"type":"done","full_text":"…"}
//          data: {"type":"error","message":"…"}   (en cas d'échec)
//
// Pas d'auth (comme game-play / loyalty-stamp) → garde-fou budget IA
// global (admin) pour protéger le wallet sur un endpoint ouvert.
// ══════════════════════════════════════════════════════════════════
const CONCIERGE_MIN_Q    = 2;
const CONCIERGE_MAX_Q    = 500;
const CONCIERGE_MAX_HIST = 8;
const CONCIERGE_MAX_TOK  = 600;

// Nettoie le bruit résiduel des modèles Workers AI en fin de génération.
// Deux motifs observés : (1) tokens de contrôle / fins de séquence qui fuient ;
// (2) « blob » alphanumérique parasite collé à la toute fin (ex : la réponse se
// termine par « …me contacter.yu80evzxv2 »), artefact de file d'attente du
// moteur. CONSERVATEUR : n'agit qu'en TOUTE fin, exige un mélange lettres+
// chiffres et un séparateur devant — un mot français n'a pas de chiffre, donc
// zéro risque de manger du texte utile (« 04 94 00 », « 2026 », « T3 » saufs).
export function stripModelNoise(s) {
  let t = String(s == null ? '' : s);
  // Motif 1 — tokens de contrôle résiduels en fin.
  t = t.replace(/\s*(?:<\/s>|<\|[^|>]*\|>|\[DONE\]|\[\/?[A-Za-z_]{2,}\])\s*$/g, '');
  // Motif 2 — blob alphanumérique parasite final (>= 6 car., lettres ET
  // chiffres mêlés), précédé d'un séparateur : on retire le blob et on garde
  // le séparateur (la phrase « …me contacter. » reste intacte).
  t = t.replace(/([\s.,;:!?…»")\]])(?=[a-z0-9]*[a-z])(?=[a-z0-9]*\d)[a-z0-9]{6,}\s*$/i, '$1');
  return t.trim();
}

export async function handleSmartQrConcierge(request, env) {
  const origin = '*'; // public, pas d'auth (visiteur anonyme)

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin':  origin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  const body     = await parseBody(request);
  const shortId  = (body?.short_id || '').toString().trim();
  const question = (body?.question || '').toString().trim();
  const histIn   = Array.isArray(body?.history) ? body.history : [];

  if (!shortId || shortId.length < 4 || shortId.length > 32) {
    return err('short_id invalide', 400, origin);
  }
  if (question.length < CONCIERGE_MIN_Q) {
    return err('Question trop courte', 400, origin);
  }
  if (question.length > CONCIERGE_MAX_Q) {
    return err(`Question trop longue (${CONCIERGE_MAX_Q} caractères max)`, 400, origin);
  }

  // Charge l'entité QR (mode smart + template concierge obligatoires)
  let qrData = null;
  // tenant_id du QR = lookup_hmac de la licence PROPRIÉTAIRE. Clé du
  // portefeuille de crédits débité (le visiteur est anonyme). Chantier B.
  let ownerKey = null;
  try {
    const entityRow = await env.DB
      .prepare(`SELECT data, tenant_id FROM entities
                WHERE type = 'qr_codes' AND json_extract(data, '$.short_id') = ?
                AND deleted_at IS NULL LIMIT 1`)
      .bind(shortId)
      .first();
    if (entityRow?.data)      qrData   = JSON.parse(entityRow.data);
    if (entityRow?.tenant_id) ownerKey = entityRow.tenant_id;
  } catch (e) {
    return err('Lookup entity échoué : ' + e.message, 500, origin);
  }
  if (!qrData) return err('QR introuvable', 404, origin);
  if (qrData.mode !== 'smart') return err('QR non Smart', 400, origin);
  if ((qrData.template_id || '') !== 'concierge') return err('Template non-concierge', 400, origin);

  if (!env.AI || typeof env.AI.run !== 'function') {
    return err('Workers AI non disponible (binding [ai] manquant)', 503, origin);
  }

  // Garde-fou budget IA global (admin) — endpoint public = protège le wallet.
  const throttled = await budgetGuard(env, origin);
  if (throttled) return throttled;

  // ── Crédits IA — débit du portefeuille du PROPRIÉTAIRE du QR ──────
  // (Chantier B · Sprint 2). Le visiteur est anonyme : on débite la
  // licence qui possède le QR (ownerKey = tenant_id), résolue serveur.
  // DORMANT : ne s'active que si la licence propriétaire porte le flag
  // enforce_ai_credits_v1 = 1. Sinon → comportement legacy (illimité),
  // zéro régression. Une question Concierge = 1 crédit (COST.concierge).
  if (ownerKey && await isEnforceEnabled(env, ownerKey)) {
    const ownerPlan = await resolvePlanByHmac(env, ownerKey);
    const credit = await consumeCredits(env, { bucketKey: ownerKey, plan: ownerPlan, tool: 'concierge' });
    if (!credit.ok && credit.blocked) {
      // Plafond mensuel atteint (inclus + packs épuisés). Message neutre
      // côté visiteur ; l'alarme « acheter un pack » s'affichera dans le
      // dashboard du PROPRIÉTAIRE (Sprint 4). Code stable pour le front.
      return json({
        error: 'Le concierge est momentanément indisponible. Merci de revenir un peu plus tard, ou de contacter directement le bureau de vente.',
        code : 'AI_CREDITS_EXHAUSTED',
      }, 429, origin);
    }
    // Débit best-effort : pas de revert si le stream échoue ensuite
    // (1 crédit, endpoint public, anti-abus — cf lib/ai-credits.js).
  }

  // System prompt déterministe (bloc + règles §3).
  const block        = qrData.template_data || {};
  const systemPrompt = buildConciergePrompt(block);

  // Repères chiffrés -> valeurs exactes, CÔTÉ SERVEUR : le modèle perd les
  // zeros des nombres, donc le prompt ne contient que des repères ({{Pa}}…).
  // On les reconvertit ici avant d'envoyer au navigateur : aucune dépendance
  // à la version de la page (une page ancienne affiche quand même les bons
  // chiffres). Repère inconnu -> retiré (jamais d'accolades chez le visiteur).
  const { map: tokenMap } = conciergeTokenMap(block.configurations);
  const subTokens = (str) => String(str).replace(
    /\{\{\s*([A-Za-z]{2,6})\s*\}\}/g,
    (m, k) => (Object.prototype.hasOwnProperty.call(tokenMap, k) ? tokenMap[k] : ''));

  // Historique : ne garde que les tours bien formés, capé + tronqué.
  const history = histIn
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-CONCIERGE_MAX_HIST)
    .map((m) => ({ role: m.role, content: m.content.slice(0, CONCIERGE_MAX_Q) }));

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: question },
  ];

  const encoder = new TextEncoder();
  const stream  = new ReadableStream({
    async start(controller) {
      const send = (obj) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)); }
        catch (e) { /* stream peut être fermé */ }
      };

      send({ type: 'start' });
      let fullText = '';
      let emitBuf  = '';   // tampon : retient un repère {{...}} en cours de formation

      try {
        let aiStream;
        try {
          aiStream = await env.AI.run(KS_AI_MODEL, {
            messages,
            stream:     true,
            max_tokens: CONCIERGE_MAX_TOK,
          });
        } catch (e) {
          send({ type: 'error', message: `AI run failed: ${e?.message || e}` });
          try { controller.close(); } catch (_) { /* déjà fermé */ }
          return;
        }

        // Consomme le stream Workers AI ligne par ligne. Fallback large sur
        // la forme du chunk (cf. brainstorming.js) pour absorber d'éventuels
        // changements de wrapping Cloudflare selon le modèle.
        const reader  = aiStream.getReader();
        const decoder = new TextDecoder('utf-8');
        let   buffer  = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              const chunk =
                parsed.response                     ??
                parsed.text                         ??
                parsed.choices?.[0]?.delta?.content ??
                parsed.delta?.text                  ??
                parsed.p                            ??
                '';
              if (chunk) {
                fullText += chunk;
                emitBuf  += chunk;
                // Flush en remplaçant les repères, mais en RETENANT un repère
                // potentiellement incomplet en fin de tampon ({, {{, {{Pa, {{Pa}).
                const hold = (emitBuf.match(/\{\{?[A-Za-z]{0,6}\}?$/) || [''])[0].length;
                if (emitBuf.length > hold) {
                  const out = subTokens(emitBuf.slice(0, emitBuf.length - hold));
                  emitBuf   = emitBuf.slice(emitBuf.length - hold);
                  if (out) send({ type: 'chunk', text: out });
                }
              }
            } catch (e) { /* ligne malformée ignorée */ }
          }
        }

        // Flush du reste du tampon (dernier repère éventuel) puis done.
        if (emitBuf) {
          const out = subTokens(emitBuf);
          if (out) send({ type: 'chunk', text: out });
          emitBuf = '';
        }
        const clean = subTokens(stripModelNoise(fullText));
        send({ type: 'done', full_text: clean });

        // Compteur budget IA (best-effort, 1 écriture).
        try {
          await recordUsage(env, 'smartqr-concierge', {
            inTokens:  estimateTokens(JSON.stringify(messages)),
            outTokens: estimateTokens(clean),
          });
        } catch (e) { /* non-critique */ }
      } catch (e) {
        send({ type: 'error', message: `Stream error: ${e?.message || e}` });
      } finally {
        try { controller.close(); } catch (e) { /* déjà fermé */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type':                'text/event-stream; charset=utf-8',
      'Cache-Control':               'no-cache',
      'Connection':                  'keep-alive',
      'Access-Control-Allow-Origin': origin,
    },
  });
}
