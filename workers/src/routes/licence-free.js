/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Licence GRATUITE en self-service
   ─────────────────────────────────────────────────────────────
   POURQUOI cette route
   ─────────────────────────────────────────────────────────────
   La landing vend un palier gratuit (Missive · booK · Keynapse,
   « sans carte bancaire, sans limite de durée ») mais aucun chemin
   ne permettait de l'obtenir : le bouton « Commencer gratuitement »
   pointait vers /app, dont la garde d'authentification renvoyait le
   visiteur en haut de la landing. On vendait ce qu'on ne livrait pas.

   Ici : e-mail → licence à SAC VIDE → clé, envoyée par e-mail et
   rendue à l'appelant pour enchaîner l'activation sans friction.

   ⚠️ LE POINT QUI DÉCIDE DE TOUT — `owned_assets` est un TABLEAU,
   JAMAIS `null`. Un sac NULL est la sentinelle historique « accès
   TOTAL » (cf. lib/app-access.js §2) : une licence gratuite créée
   avec null ouvrirait les 14 applications. Vérifié au banc
   (scripts/test-licence-free.mjs) :
     sac garni → Missive/booK/Keynapse ouverts, tout le reste FERMÉ,
                 0 conversation incluse, dictée Keynapse refusée ;
     sac null  → Ghost Writer et Smart Agent ouverts. Le piège.

   Le sac porte EXPLICITEMENT les 3 identifiants gratuits plutôt
   qu'un tableau vide. Fonctionnellement c'est équivalent — les apps
   gratuites sont ouvertes inconditionnellement, et leur palier vaut
   0 conversation — mais un sac vide se LIT « cette licence n'a
   rien », ce qui est faux et s'affiche tel quel dans l'admin. La
   liste est dérivée de la grille (APP_TIER), pas recopiée : si une
   app change de palier, le sac suit sans qu'on y pense.

   Le palier gratuit ne déclenche donc AUCUN coût : les 3 apps
   n'appellent aucune IA, et le quota per-app renvoie 0 (§9 bis du
   handoff pricing : « Gratuit, cœur seul »).

   Plan technique : on réutilise `technicalPlanFor()`, la fonction du
   chemin Stripe, plutôt que d'écrire une valeur en dur — une seule
   règle pour les deux portes d'entrée. Elle rend 'PRO' ici, soit
   3 appareils (_devicesMaxForPlan). ⚠️ Ne PAS inventer un plan
   'FREE' : `_devicesMaxForPlan` renvoie `null` = appareils
   ILLIMITÉS pour tout plan qu'il ne connaît pas — un palier gratuit
   plus permissif que l'OS complet, et personne ne le verrait.

   Idempotence : un e-mail déjà porteur d'une licence NE crée PAS une
   deuxième clé. Même principe que le webhook Stripe (« une personne,
   une licence »). Si la licence existante est une gratuite, on lui
   renvoie sa clé ; si elle est payante, on refuse poliment plutôt
   que de laisser croire à une dégradation.
   ═══════════════════════════════════════════════════════════════ */

import { json, err, getAllowedOrigin }   from '../lib/auth.js';
import { generateLicenceKey }            from '../lib/keygen.js';
import { blindIndex, hashKey }           from '../lib/kdf.js';
import { sendEmail, tplFreeKey }         from '../lib/email-resend.js';
import { APP_TIER, TIER }                from '../lib/pricing-grid.js';
import { technicalPlanFor }              from '../lib/stripe-catalog.js';

// Le sac d'une licence gratuite = les applications que la grille range
// au palier FREE. Dérivé, jamais recopié : la grille reste la seule
// source de vérité (cf. le filet anti-dérive de scripts/test-pricing-*).
function sacGratuit() {
  return Object.keys(APP_TIER).filter(id => APP_TIER[id] === TIER.FREE);
}

const ACTIVATE_BASE = 'https://protein-keystone.com/?ks_key=';
const EMAIL_RE      = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

// Anti-abus : une IP ne peut pas fabriquer des licences en boucle.
// Volontairement doux — le palier gratuit ne coûte rien (aucune IA,
// aucun stockage lourd), le risque est le bruit en base, pas la
// dépense. Réutilise `activation_attempts`, déjà créée et purgée.
const FREE_MAX_PER_IP = 5;
const FREE_WINDOW_MS  = 24 * 60 * 60 * 1000;

async function _ipThrottled(env, ip) {
  if (!ip) return false;
  const bucket = `free:${ip}`;
  try {
    const row = await env.DB
      .prepare('SELECT attempts, last_attempt FROM activation_attempts WHERE fingerprint = ?')
      .bind(bucket).first();
    const now = Date.now();
    const fresh = row && (now - (row.last_attempt || 0)) < FREE_WINDOW_MS;
    const n = fresh ? (row.attempts || 0) : 0;
    if (n >= FREE_MAX_PER_IP) return true;
    await env.DB.prepare(`
      INSERT INTO activation_attempts (fingerprint, attempts, last_attempt, blocked_until)
      VALUES (?, ?, ?, 0)
      ON CONFLICT(fingerprint) DO UPDATE SET attempts = ?, last_attempt = ?
    `).bind(bucket, n + 1, now, n + 1, now).run();
    return false;
  } catch (_) {
    return false;   // base muette → on ne bloque pas un visiteur légitime
  }
}

// ═══════════════════════════════════════════════════════════════
// POST /api/licence/free  { email }
//   200 { ok, key, activateUrl, created }  — created=false si renvoi
//   409 { error }                          — e-mail déjà sur une licence payante
//   429 { error }                          — trop de créations depuis cette IP
// ═══════════════════════════════════════════════════════════════
export async function handleLicenceFree(request, env) {
  const origin = getAllowedOrigin(env, request);

  let body = {};
  try { body = await request.json(); } catch (_) { /* corps vide → 400 plus bas */ }
  const email = String(body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return err('Adresse e-mail invalide.', 400, origin);
  }

  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (await _ipThrottled(env, ip)) {
    return err('Trop de créations depuis cette connexion. Réessayez demain.', 429, origin);
  }

  // ── Déjà connu ? On ne fabrique jamais une 2e clé pour un e-mail ──
  const known = await env.DB
    .prepare(`SELECT key, owned_assets, is_active FROM licences
               WHERE lower(COALESCE(customer_email, owner)) = ? LIMIT 1`)
    .bind(email).first()
    .catch(() => null);

  if (known && known.is_active === 1) {
    let bag = null;
    try { bag = JSON.parse(known.owned_assets || 'null'); } catch (_) { /* illisible */ }
    // Gratuite = un sac qui ne contient QUE des apps du palier FREE.
    // Couvre aussi les licences créées avant ce changement (sac vide).
    const estGratuite = Array.isArray(bag)
      && bag.every(id => APP_TIER[id] === TIER.FREE);
    if (!estGratuite) {
      // Licence payante (ou legacy « tout ouvert ») : lui donner une
      // gratuite serait au mieux inutile, au pire déroutant.
      return err(
        'Cette adresse a déjà un accès Keystone. Utilisez votre clé pour vous connecter.',
        409, origin,
      );
    }
    return json({
      ok: true, created: false, key: known.key,
      activateUrl: ACTIVATE_BASE + encodeURIComponent(known.key),
    }, 200, origin);
  }

  // ── Création — sac GARNI des 3 gratuites (cf. tête de fichier) ──
  const bag   = sacGratuit();
  const key   = generateLicenceKey();
  const hmac  = await blindIndex(key, env.KS_LOOKUP_PEPPER);
  const kh    = await hashKey(key);
  await env.DB.prepare(`
    INSERT INTO licences (
      key, tenant_id, owner, plan, is_active, owned_assets, customer_email,
      lookup_hmac, key_hash, salt, created_at
    ) VALUES (?, 'default', ?, ?, 1, ?, ?, ?, ?, ?, datetime('now'))
  `).bind(
    key, email.split('@')[0], technicalPlanFor(bag), JSON.stringify(bag),
    email, hmac, kh.hash, kh.salt,
  ).run();

  // L'e-mail n'est PAS bloquant : la clé est déjà rendue dans la
  // réponse, le visiteur entre tout de suite. Le courrier ne sert
  // qu'à lui permettre de revenir depuis un autre appareil.
  try {
    await sendEmail(env, {
      to:      email,
      replyTo: 'protein.keystone@gmail.com',
      subject: 'Votre accès gratuit Keystone OS',
      html:    tplFreeKey({
        ownerName:   email.split('@')[0],
        key,
        activateUrl: ACTIVATE_BASE + encodeURIComponent(key),
      }),
    });
  } catch (e) {
    console.error('[licence/free] Resend KO :', e.message);
  }

  return json({
    ok: true, created: true, key,
    activateUrl: ACTIVATE_BASE + encodeURIComponent(key),
  }, 200, origin);
}
