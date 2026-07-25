/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Recharge automatique · le balayage qui DÉBITE (P3)
   ─────────────────────────────────────────────────────────────
   ⚠️⚠️ SEUL MODULE DU PROJET QUI PRÉLÈVE DE L'ARGENT SANS QUE LE
   CLIENT SOIT DEVANT SON ÉCRAN. À lire en entier avant d'y toucher.

   POURQUOI UN CRON, ET PAS LE CHEMIN DE L'IA
   ─────────────────────────────────────────────────────────────
   Le déclencheur naturel semblait être `consumeCredits()` : on débite,
   on voit qu'il reste peu, on recharge. Deux raisons de ne PAS le faire :
     1. ça ajoute ~1 s de latence Stripe à une requête utilisateur ;
     2. ça déplace de l'argent À L'INTÉRIEUR d'un appel d'IA — si la
        requête est annulée à mi-chemin, l'état devient ambigu.
   Le balayage tourne donc toutes les 5 minutes, hors de tout chemin
   utilisateur. Le seuil (50 par défaut) est un TAMPON dimensionné pour
   couvrir cet intervalle : l'agent ne tombe pas à sec entre deux passages.

   IDEMPOTENCE — la protection qui compte le plus
   ─────────────────────────────────────────────────────────────
   Deux balayages peuvent se chevaucher (un tick qui déborde, un retry
   Cloudflare). Trois filets, dans cet ordre :
     · `shouldReload` refuse si la dernière recharge a moins de 10 min
       (MIN_INTERVAL_MS > pas du cron) ;
     · l'`Idempotency-Key` envoyée à Stripe est dérivée de la licence ET
       de la fenêtre de 10 minutes → deux appels concurrents produisent
       le MÊME PaymentIntent côté Stripe, pas deux débits ;
     · le journal a `payment_intent` en clé primaire → un même
       prélèvement ne peut pas créditer deux fois.

   ORDRE DES OPÉRATIONS — débiter d'abord, créditer ensuite
   ─────────────────────────────────────────────────────────────
   On ne crédite JAMAIS avant que Stripe ait confirmé. Créditer d'abord
   « pour ne pas couper le client » puis découvrir que la carte refuse,
   c'est offrir des conversations et devoir les reprendre. L'inverse (le
   débit passe, le crédit échoue) est réparable : le PaymentIntent est
   journalisé, on peut recréditer à la main — et le client a payé pour
   quelque chose qu'on lui doit, pas l'inverse.

   ÉCHEC = PAUSE, jamais de nouvelle tentative en boucle
   ─────────────────────────────────────────────────────────────
   Carte refusée ou 3DS exigé hors session → pause collante + e-mail.
   Réessayer toutes les 5 minutes sur une carte refusée est le meilleur
   moyen de se faire signaler par la banque du client.
   ═══════════════════════════════════════════════════════════════ */

import {
  listArmed, shouldReload, recordCharge, pauseReload, alreadyCredited,
  ensureAutoReloadSchema, MIN_INTERVAL_MS, PAUSE,
} from '../lib/auto-reload.js';
import {
  resolveQuota, resolveLicenceByHmac, readMonthUsed, readPackBalance, addPackCredits,
} from '../lib/ai-credits.js';
import { sendEmail } from '../lib/email-resend.js';

// Borne par tick : au-delà, on remet au balayage suivant. Un lot non
// borné pourrait épuiser le temps CPU du Worker et laisser des débits
// à moitié traités.
const MAX_PAR_TICK = 10;

async function _stripePost(env, path, body, idempotencyKey) {
  const enc = (o, p = '') => Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => {
      const key = p ? `${p}[${k}]` : k;
      return (typeof v === 'object' && !Array.isArray(v))
        ? enc(v, key)
        : `${encodeURIComponent(key)}=${encodeURIComponent(v)}`;
    }).join('&');
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.KS_STRIPE_SECRET}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: enc(body),
  });
  const out = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data: out };
}

/** Conversations restantes d'une licence : inclus − consommé + packs. */
async function _remainingFor(env, lookupHmac) {
  const { plan, ownedAssets } = await resolveLicenceByHmac(env, lookupHmac);
  const quota = resolveQuota(env, plan, ownedAssets);
  if (quota === null) return null;                    // illimité
  const used = await readMonthUsed(env, lookupHmac);
  const pack = await readPackBalance(env, lookupHmac);
  return Math.max(0, quota - used) + pack;
}

/** Adresse du titulaire, pour les e-mails de pause. */
async function _emailFor(env, lookupHmac) {
  try {
    const row = await env.DB
      .prepare('SELECT COALESCE(customer_email, owner) AS mail FROM licences WHERE lookup_hmac = ? LIMIT 1')
      .bind(lookupHmac).first();
    const m = row?.mail || '';
    return /@/.test(m) ? m : null;
  } catch (_) { return null; }
}

async function _prevenir(env, lookupHmac, sujet, corps) {
  const to = await _emailFor(env, lookupHmac);
  if (!to) return;
  try {
    await sendEmail(env, {
      to, replyTo: 'protein.keystone@gmail.com', subject: sujet,
      html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;line-height:1.6;color:#111">
        <p>${corps}</p>
        <p style="color:#666;font-size:13px">Vous pouvez ajuster ou désactiver la recharge automatique
        dans Keystone → Réglages → Conversations.</p></div>`,
    });
  } catch (e) { console.warn('[P3 sweep] e-mail KO :', e.message); }
}

/**
 * Un passage de balayage. Retourne un compte-rendu (journalisé par le
 * cron) : ce qui a été examiné, rechargé, refusé et pourquoi.
 */
export async function runAutoReloadSweep(env, { now = Date.now() } = {}) {
  const bilan = { examinees: 0, rechargees: 0, pausees: 0, ignorees: 0, details: [] };
  if (!env.KS_STRIPE_SECRET) { bilan.details.push('pas de clé Stripe'); return bilan; }

  await ensureAutoReloadSchema(env);
  const armees = await listArmed(env);

  for (const cfg of armees.slice(0, MAX_PAR_TICK)) {
    bilan.examinees++;
    const hmac = cfg.lookup_hmac;

    const restant = await _remainingFor(env, hmac);
    const verdict = shouldReload(cfg, restant, now);
    if (!verdict.ok) {
      bilan.ignorees++;
      bilan.details.push(`${hmac.slice(0, 8)} : ${verdict.reason}`);
      // Le plafond atteint n'est pas une anomalie mais un ARRÊT : on le
      // rend visible (pause + e-mail) au lieu de le répéter en silence
      // toutes les 5 minutes.
      if (verdict.reason === PAUSE.CAP) {
        await pauseReload(env, hmac, PAUSE.CAP);
        bilan.pausees++;
        await _prevenir(env, hmac,
          'Votre plafond de recharge mensuel est atteint',
          `Le plafond que vous avez fixé pour la recharge automatique est atteint pour ce mois-ci.
           Vos conversations incluses continuent normalement, mais aucune recharge ne sera prélevée
           jusqu'au 1<sup>er</sup> du mois prochain. Relevez le plafond si vous souhaitez poursuivre.`);
      }
      continue;
    }

    // Fenêtre d'idempotence alignée sur l'anti-rafale : deux appels dans
    // la même fenêtre de 10 min = un seul PaymentIntent chez Stripe.
    const fenetre = Math.floor(now / MIN_INTERVAL_MS);
    const cle     = `arl_${hmac}_${fenetre}`;

    const r = await _stripePost(env, '/payment_intents', {
      amount: verdict.amountCents,
      currency: 'eur',
      customer: cfg.stripe_customer,
      payment_method: cfg.payment_method,
      off_session: true,          // le client n'est pas là
      confirm: true,              // on confirme tout de suite
      description: `Keystone — recharge automatique (${verdict.conversations} conversations)`,
      'metadata[ks_licence]': hmac,
      'metadata[ks_pack]': verdict.packLookup,
      'metadata[ks_purpose]': 'auto_reload',
    }, cle);

    const pi = r.data?.id || r.data?.error?.payment_intent?.id || null;

    if (r.ok && r.data?.status === 'succeeded') {
      // Double sécurité : si ce PaymentIntent a déjà crédité (retry),
      // on ne recrédite pas.
      if (await alreadyCredited(env, pi)) {
        bilan.ignorees++;
        bilan.details.push(`${hmac.slice(0, 8)} : déjà crédité (${pi})`);
        continue;
      }
      await addPackCredits(env, hmac, verdict.conversations);
      await recordCharge(env, hmac, {
        paymentIntent: pi, packLookup: verdict.packLookup,
        amountCents: verdict.amountCents, conversations: verdict.conversations,
      });
      bilan.rechargees++;
      bilan.details.push(`${hmac.slice(0, 8)} : +${verdict.conversations} (${verdict.amountCents}c)`);
      continue;
    }

    // ── Échec ─────────────────────────────────────────────────────
    const code = r.data?.error?.code || r.data?.status || `http_${r.status}`;
    // 3DS hors session : Stripe ne peut pas authentifier sans le client.
    // Ce n'est pas une carte invalide — le message doit le dire, sinon on
    // inquiète pour rien quelqu'un dont la carte va très bien.
    const auth = code === 'authentication_required' || r.data?.status === 'requires_action';
    const raison = auth ? PAUSE.AUTH : PAUSE.PAYMENT;
    await pauseReload(env, hmac, raison, code);
    bilan.pausees++;
    bilan.details.push(`${hmac.slice(0, 8)} : PAUSE ${raison} (${code})`);

    await _prevenir(env, hmac,
      auth ? 'Votre banque demande une confirmation' : 'La recharge automatique n’a pas pu être prélevée',
      auth
        ? `Votre banque exige une confirmation de votre part pour ce prélèvement, ce qui est impossible
           en votre absence. <strong>Votre carte n'est pas en cause.</strong> La recharge automatique est
           en pause : réenregistrez votre carte depuis vos réglages pour la réactiver.`
        : `Le prélèvement de la recharge automatique a été refusé (${code}). La recharge est en pause
           pour éviter de représenter le paiement en boucle. Mettez à jour votre carte dans vos réglages,
           puis réactivez-la.`);
  }

  if (armees.length > MAX_PAR_TICK) {
    bilan.details.push(`${armees.length - MAX_PAR_TICK} licence(s) reportée(s) au prochain passage`);
  }
  return bilan;
}
