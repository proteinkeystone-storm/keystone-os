/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Recharge automatique · endpoints (Sprint P3)
   ─────────────────────────────────────────────────────────────
   La DÉCISION vit dans lib/auto-reload.js (pure, 35 tests). Ici :
   la couche HTTP, l'enregistrement de la carte et le consentement.

   Routes :
     GET  /api/ai-credits/auto-reload         → état + le TEXTE de
            consentement à afficher. Le serveur est propriétaire de ce
            texte : le front ne fait que l'afficher.
     POST /api/ai-credits/auto-reload         → réglages (seuil, pack,
            plafond, on/off). N'ENREGISTRE AUCUNE CARTE.
     POST /api/ai-credits/auto-reload/setup   → consentement + session
            Stripe `mode:'setup'` pour enregistrer une carte SANS DÉBIT.
     POST /api/ai-credits/auto-reload/resume  → sortir de pause.

   AUCUNE de ces routes ne déplace d'argent. Un `SetupIntent` autorise
   des débits FUTURS, il ne prélève rien — c'est justement pourquoi le
   consentement doit être explicite et horodaté ICI.

   POURQUOI LE TEXTE DE CONSENTEMENT VIENT DU SERVEUR
   ─────────────────────────────────────────────────────────────
   On stocke la VERSION du texte accepté. Si le front portait sa propre
   copie, les deux pourraient dériver et on stockerait « v1 » en ayant
   affiché autre chose — une trace de consentement fausse est pire que
   pas de trace. Le serveur envoie le texte ET sa version ; le front
   affiche ce qu'il reçoit.
   ═══════════════════════════════════════════════════════════════ */

import { json, err, getAllowedOrigin, parseBody } from '../lib/auth.js';
import { requireJWT }                             from '../lib/jwt.js';
import {
  ensureAutoReloadSchema, readConfig, resumeReload,
  remainingCapCents, currentMonthUtc,
  PACK_PRICE_CENTS, DEFAULT_CAP_EUR, DEFAULT_THRESHOLD,
} from '../lib/auto-reload.js';
import { PACK_LOOKUP_TO_CONVERSATIONS } from '../lib/stripe-catalog.js';

const SITE = 'https://protein-keystone.com';

// ── Le texte que le client accepte. Toute modification de FOND doit
//    incrémenter la version : une trace qui pointe une version périmée
//    ne prouve pas ce que la personne a réellement lu.
export const CONSENT_VERSION = '2026-07-25.v1';
export function consentText({ capEur, packLabel, threshold }) {
  return [
    `J'autorise Keystone à débiter ma carte enregistrée pour ${packLabel}`,
    `lorsqu'il me reste moins de ${threshold} conversations, sans que j'aie à intervenir.`,
    `Ces débits s'arrêtent automatiquement dès que ${capEur} € ont été prélevés sur le mois en cours.`,
    `Je peux désactiver cette recharge ou changer ce plafond à tout moment depuis mes réglages.`,
  ].join(' ');
}

function packLabel(lookup) {
  const n = PACK_LOOKUP_TO_CONVERSATIONS[lookup] || 0;
  const c = PACK_PRICE_CENTS[lookup] || 0;
  return `un pack de ${n.toLocaleString('fr-FR')} conversations à ${(c / 100).toFixed(0)} €`;
}

async function _stripe(env, path, { method = 'GET', body, idempotencyKey } = {}) {
  const enc = (o, p = '') => Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => {
      const key = p ? `${p}[${k}]` : k;
      return (typeof v === 'object' && !Array.isArray(v))
        ? enc(v, key)
        : `${encodeURIComponent(key)}=${encodeURIComponent(v)}`;
    }).join('&');
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.KS_STRIPE_SECRET}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    ...(body ? { body: enc(body) } : {}),
  });
  const out = await res.json();
  if (!res.ok) throw new Error(out?.error?.message || `Stripe HTTP ${res.status}`);
  return out;
}

// Forme exposée au front. On ne renvoie JAMAIS l'identifiant du moyen
// de paiement — le front n'en a aucun usage et c'est une donnée de
// paiement. Juste « une carte est enregistrée : oui/non ».
function publicShape(cfg) {
  const month = currentMonthUtc();
  const pack  = (cfg?.pack_lookup && PACK_PRICE_CENTS[cfg.pack_lookup]) ? cfg.pack_lookup : 'ks_pack_1000';
  return {
    enabled:      cfg?.enabled === 1,
    threshold:    Number(cfg?.threshold) || DEFAULT_THRESHOLD,
    pack:         pack,
    packConversations: PACK_LOOKUP_TO_CONVERSATIONS[pack] || 0,
    packPriceEur: (PACK_PRICE_CENTS[pack] || 0) / 100,
    capEur:       (Number(cfg?.cap_cents) || DEFAULT_CAP_EUR * 100) / 100,
    spentEur:     ((cfg?.spent_month === month ? Number(cfg.spent_cents) : 0) || 0) / 100,
    remainingEur: cfg ? remainingCapCents(cfg, month) / 100 : DEFAULT_CAP_EUR,
    cardOnFile:   !!(cfg?.stripe_customer && cfg?.payment_method),
    consentAt:    cfg?.consent_at || null,
    consentVersion: cfg?.consent_version || null,
    paused:       !!cfg?.paused_at,
    pausedReason: cfg?.paused_reason || null,
    lastReloadAt: cfg?.last_reload_at || null,
    month,
  };
}

// ═══════════════════════════════════════════════════════════════
// GET /api/ai-credits/auto-reload
// ═══════════════════════════════════════════════════════════════
export async function handleAutoReloadGet(request, env) {
  const origin = getAllowedOrigin(env, request);
  const claims = await requireJWT(request, env);
  if (!claims?.sub) return err('Authentification requise (JWT licence)', 401, origin);

  const cfg = await readConfig(env, claims.sub);
  const shape = publicShape(cfg);
  return json({
    ...shape,
    // Le texte à afficher, calculé sur les réglages COURANTS : ce que le
    // client lit correspond exactement à ce qu'il va autoriser.
    consent: {
      version: CONSENT_VERSION,
      text: consentText({
        capEur: shape.capEur, threshold: shape.threshold, packLabel: packLabel(shape.pack),
      }),
    },
    packs: Object.keys(PACK_PRICE_CENTS).map(id => ({
      id, conversations: PACK_LOOKUP_TO_CONVERSATIONS[id], priceEur: PACK_PRICE_CENTS[id] / 100,
    })),
  }, 200, origin);
}

// ═══════════════════════════════════════════════════════════════
// POST /api/ai-credits/auto-reload   { enabled?, threshold?, pack?, capEur? }
// ───────────────────────────────────────────────────────────────
// Règle non négociable : on ne peut PAS activer sans carte enregistrée
// ni sans consentement. Sinon on promettrait une protection qui ne
// fonctionnerait pas — le client croirait son agent couvert.
// ═══════════════════════════════════════════════════════════════
export async function handleAutoReloadSave(request, env) {
  const origin = getAllowedOrigin(env, request);
  const claims = await requireJWT(request, env);
  if (!claims?.sub) return err('Authentification requise (JWT licence)', 401, origin);

  const body = await parseBody(request) || {};
  await ensureAutoReloadSchema(env);
  const cfg = await readConfig(env, claims.sub);

  // Bornes. Le plafond a un MINIMUM égal au prix du pack choisi : un
  // plafond inférieur rendrait la recharge structurellement impossible
  // et le client attendrait en vain un filet qui ne se déclenche jamais.
  const pack = (body.pack && PACK_PRICE_CENTS[body.pack]) ? body.pack : (cfg?.pack_lookup || 'ks_pack_1000');
  const minCents = PACK_PRICE_CENTS[pack];
  let capCents = body.capEur !== undefined
    ? Math.round(Number(body.capEur) * 100)
    : (Number(cfg?.cap_cents) || DEFAULT_CAP_EUR * 100);
  if (!Number.isFinite(capCents)) capCents = DEFAULT_CAP_EUR * 100;
  capCents = Math.max(minCents, Math.min(capCents, 50000));   // 500 € de garde absolu

  let threshold = body.threshold !== undefined
    ? Math.round(Number(body.threshold))
    : (Number(cfg?.threshold) || DEFAULT_THRESHOLD);
  if (!Number.isFinite(threshold)) threshold = DEFAULT_THRESHOLD;
  threshold = Math.max(5, Math.min(threshold, 2000));

  const wantEnabled = body.enabled === undefined ? (cfg?.enabled === 1) : !!body.enabled;
  const hasCard  = !!(cfg?.stripe_customer && cfg?.payment_method);
  const hasConsent = !!cfg?.consent_at;
  if (wantEnabled && !(hasCard && hasConsent)) {
    return err('Enregistrez d’abord une carte et acceptez les conditions de recharge.', 409, origin);
  }

  await env.DB.prepare(`
    INSERT INTO ai_auto_reload (lookup_hmac, enabled, threshold, pack_lookup, cap_cents, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(lookup_hmac) DO UPDATE SET
      enabled = ?, threshold = ?, pack_lookup = ?, cap_cents = ?, updated_at = datetime('now')
  `).bind(
    claims.sub, wantEnabled ? 1 : 0, threshold, pack, capCents,
    wantEnabled ? 1 : 0, threshold, pack, capCents,
  ).run();

  return json(publicShape(await readConfig(env, claims.sub)), 200, origin);
}

// ═══════════════════════════════════════════════════════════════
// POST /api/ai-credits/auto-reload/setup   { consentVersion }
// ───────────────────────────────────────────────────────────────
// Enregistre le CONSENTEMENT puis ouvre une session Stripe
// `mode:'setup'` — une carte est mémorisée, RIEN n'est débité.
// ═══════════════════════════════════════════════════════════════
export async function handleAutoReloadSetup(request, env) {
  const origin = getAllowedOrigin(env, request);
  if (request.method === 'OPTIONS') return json({ ok: true }, 200, origin);
  if (!env.KS_STRIPE_SECRET) return err('Paiement indisponible (clé serveur manquante)', 500, origin);

  const claims = await requireJWT(request, env);
  if (!claims?.sub) return err('Authentification requise (JWT licence)', 401, origin);

  const body = await parseBody(request) || {};
  // Le front doit renvoyer la version qu'il a AFFICHÉE. Si elle ne
  // correspond plus (déploiement entre l'affichage et le clic), on
  // refuse : mieux vaut lui redemander que d'enregistrer un
  // consentement pour un texte qu'il n'a pas lu.
  if (String(body.consentVersion || '') !== CONSENT_VERSION) {
    return err('Les conditions ont changé. Rechargez la page et relisez-les.', 409, origin);
  }

  await ensureAutoReloadSchema(env);
  const cfg = await readConfig(env, claims.sub);

  // Client Stripe : on réutilise celui de la licence s'il existe (un
  // client qui a déjà payé une app en a un), sinon on en crée un.
  let customer = cfg?.stripe_customer || null;
  let email = claims.email || claims.owner || null;
  if (!customer) {
    try {
      const row = await env.DB
        .prepare('SELECT stripe_customer_id, customer_email FROM licences WHERE lookup_hmac = ? LIMIT 1')
        .bind(claims.sub).first();
      customer = row?.stripe_customer_id || null;
      email    = row?.customer_email || email;
    } catch (_) { /* base muette → on créera un client */ }
  }
  try {
    if (!customer) {
      const c = await _stripe(env, '/customers', {
        method: 'POST',
        body: { ...(email ? { email } : {}), metadata: { ks_licence: claims.sub } },
        idempotencyKey: `arl_cus_${claims.sub}`,
      });
      customer = c.id;
    }

    const session = await _stripe(env, '/checkout/sessions', {
      method: 'POST',
      body: {
        mode: 'setup',                     // ← AUCUN débit
        customer,
        currency: 'eur',
        'payment_method_types[0]': 'card',
        success_url: `${SITE}/app.html?recharge=ok`,
        cancel_url:  `${SITE}/app.html?recharge=annule`,
        client_reference_id: claims.sub,
        'metadata[ks_purpose]': 'auto_reload_setup',
        'metadata[ks_licence]': claims.sub,
      },
    });

    // Consentement enregistré MAINTENANT : la personne a lu le texte et
    // cliqué. Si elle abandonne la page Stripe, il n'y aura pas de carte
    // — et sans carte, shouldReload() refuse (verrou NO_CARD). Un
    // consentement sans carte ne déclenche donc aucun débit.
    const ip = request.headers.get('CF-Connecting-IP') || '';
    await env.DB.prepare(`
      INSERT INTO ai_auto_reload (lookup_hmac, stripe_customer, consent_at, consent_ip, consent_version, updated_at)
      VALUES (?, ?, datetime('now'), ?, ?, datetime('now'))
      ON CONFLICT(lookup_hmac) DO UPDATE SET
        stripe_customer = ?, consent_at = datetime('now'), consent_ip = ?,
        consent_version = ?, updated_at = datetime('now')
    `).bind(claims.sub, customer, ip, CONSENT_VERSION, customer, ip, CONSENT_VERSION).run();

    return json({ url: session.url }, 200, origin);
  } catch (e) {
    console.error('[auto-reload setup]', e.message);
    return err('Impossible d’ouvrir l’enregistrement de carte pour le moment.', 502, origin);
  }
}

// ═══════════════════════════════════════════════════════════════
// POST /api/ai-credits/auto-reload/resume
// Sortie de pause, à la main. Volontairement une action EXPLICITE :
// après un refus de carte, seul le client sait s'il a corrigé.
// ═══════════════════════════════════════════════════════════════
export async function handleAutoReloadResume(request, env) {
  const origin = getAllowedOrigin(env, request);
  const claims = await requireJWT(request, env);
  if (!claims?.sub) return err('Authentification requise (JWT licence)', 401, origin);
  await resumeReload(env, claims.sub);
  return json(publicShape(await readConfig(env, claims.sub)), 200, origin);
}
