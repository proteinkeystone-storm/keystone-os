/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — GP-2 couche 2 · LE DICTIONNAIRE DE LA MAISON

   Ce que la rédaction apprend au correcteur — noms de personnes,
   d'unités, de projets — au lieu de rester dans le navigateur de
   celui qui l'a tapé.

   ── La portée : LA LICENCE (décision de Stéphane, 2026-08-20) ──
   `claims.sub` EST le `lookup_hmac` de la licence (cf. licence-public.js
   handleActivateV2) : identifiant stable, opaque, partagé par toutes les
   personnes rattachées à la même licence via `licence_emails`. C'est donc
   exactement le bon cloisonnement : ce qu'un membre apprend, les autres
   l'ont ; rien ne traverse vers un autre client.

   ⚠ Le partage MONDIAL a été explicitement écarté : le vocabulaire d'un
   client transparaîtrait dans le comportement de l'outil chez les autres,
   et la coquille d'un seul rendrait tout le monde aveugle à cette faute.
   Le vocabulaire GÉNÉRIQUE, lui, est livré avec l'outil et ne passe pas
   par ici (app/lib/proof-dico-base.js).

   ── Routes ─────────────────────────────────────────────────────
     GET  /api/proof/dico            → { words:[…], count, max }
     POST /api/proof/dico            body { add:[…], remove:[…] }
                                     → { words:[…], count, max, added, removed }

   Les deux exigent un JWT de licence. Pas d'IA, pas de crédit consommé :
   c'est du stockage, gratuit et déterministe.

   ── Garde-fous ─────────────────────────────────────────────────
   · un mot : 3 à 60 signes, lettres (accents compris), trait d'union et
     apostrophe. Rien d'autre — ni chiffre, ni espace, ni ponctuation.
     Les mots plus courts sont de toute façon écartés en amont par
     `minLetters` : les accepter ici ferait croire qu'ils servent.
   · 5 000 mots par licence, 500 par requête (la reprise du localStorage
     d'un ancien utilisateur passe en un envoi).
   · tout est stocké et comparé en MINUSCULES, comme le moteur compare.
   ═══════════════════════════════════════════════════════════════ */

import { json, err, parseBody, getAllowedOrigin } from '../lib/auth.js';
import { requireJWT } from '../lib/jwt.js';

const MAX_MOTS_LICENCE = 5000;
const MAX_PAR_REQUETE  = 500;
const MOT_MIN = 3;
const MOT_MAX = 60;

// Lettres (accents compris), trait d'union, apostrophe. Doit commencer et
// finir par une lettre — « -mot » ou « mot- » sont des fragments.
const RE_MOT = /^[a-zà-öø-ÿ]([a-zà-öø-ÿ'’-]*[a-zà-öø-ÿ])?$/;

let _schemaReady = false;
async function ensureSchema(env) {
  if (_schemaReady) return;
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS proof_dico (
      lookup_hmac TEXT NOT NULL,
      word        TEXT NOT NULL,
      added_at    TEXT NOT NULL DEFAULT (datetime('now')),
      added_by    TEXT,
      PRIMARY KEY (lookup_hmac, word)
    )
  `).run().catch(() => {});
  await env.DB.prepare(
    'CREATE INDEX IF NOT EXISTS idx_proof_dico_licence ON proof_dico(lookup_hmac)',
  ).run().catch(() => {});
  _schemaReady = true;
}

// Normalise et valide. Rend null si le mot n'a pas sa place dans le dico.
function normaliser(mot) {
  const w = String(mot == null ? '' : mot).trim().toLowerCase();
  if (w.length < MOT_MIN || w.length > MOT_MAX) return null;
  if (!RE_MOT.test(w)) return null;
  return w;
}

async function lireDico(env, lookupHmac) {
  const r = await env.DB
    .prepare('SELECT word FROM proof_dico WHERE lookup_hmac = ? ORDER BY word')
    .bind(lookupHmac).all().catch(() => null);
  return (r && r.results ? r.results : []).map((x) => x.word);
}

function payload(words, extra) {
  return Object.assign({ words, count: words.length, max: MAX_MOTS_LICENCE }, extra || {});
}

// ── GET : la liste de la licence ────────────────────────────────
export async function handleProofDicoGet(request, env) {
  const origin = getAllowedOrigin(env, request);
  const claims = await requireJWT(request, env);
  if (!claims) return err('Authentification requise (JWT licence)', 401, origin);
  const lookupHmac = claims.sub;
  if (!lookupHmac) return err('JWT incomplet (sub manquant) — re-login requis', 401, origin);

  await ensureSchema(env);
  return json(payload(await lireDico(env, lookupHmac)), 200, origin);
}

// ── POST : appliquer des ajouts et des retraits ─────────────────
// Deltas, pas remplacement : deux personnes qui apprennent un mot chacune
// de leur côté ne doivent pas s'effacer mutuellement.
export async function handleProofDicoPost(request, env) {
  const origin = getAllowedOrigin(env, request);
  const claims = await requireJWT(request, env);
  if (!claims) return err('Authentification requise (JWT licence)', 401, origin);
  const lookupHmac = claims.sub;
  if (!lookupHmac) return err('JWT incomplet (sub manquant) — re-login requis', 401, origin);

  const body   = await parseBody(request);
  const brutA  = Array.isArray(body && body.add) ? body.add : [];
  const brutR  = Array.isArray(body && body.remove) ? body.remove : [];
  if (brutA.length > MAX_PAR_REQUETE || brutR.length > MAX_PAR_REQUETE) {
    return err(`Trop de mots d'un coup (maximum ${MAX_PAR_REQUETE})`, 413, origin);
  }

  const aAjouter = Array.from(new Set(brutA.map(normaliser).filter(Boolean)));
  const aRetirer = Array.from(new Set(brutR.map(normaliser).filter(Boolean)));

  await ensureSchema(env);

  // Plafond par licence : on compte AVANT d'insérer, et on tronque plutôt
  // que de refuser tout l'envoi (une reprise de localStorage ne doit pas
  // échouer en bloc parce qu'elle dépasse de trois mots).
  let retenus = aAjouter;
  if (retenus.length) {
    const c = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM proof_dico WHERE lookup_hmac = ?')
      .bind(lookupHmac).first().catch(() => null);
    const place = Math.max(0, MAX_MOTS_LICENCE - ((c && c.n) || 0));
    retenus = retenus.slice(0, place);
  }

  const par = (claims.email || '').slice(0, 120) || null;
  const lots = [];
  for (const w of retenus) {
    lots.push(env.DB.prepare(
      'INSERT OR IGNORE INTO proof_dico (lookup_hmac, word, added_by) VALUES (?, ?, ?)',
    ).bind(lookupHmac, w, par));
  }
  for (const w of aRetirer) {
    lots.push(env.DB.prepare(
      'DELETE FROM proof_dico WHERE lookup_hmac = ? AND word = ?',
    ).bind(lookupHmac, w));
  }
  if (lots.length) await env.DB.batch(lots).catch(() => {});

  return json(payload(await lireDico(env, lookupHmac), {
    added: retenus.length, removed: aRetirer.length,
    tronque: retenus.length < aAjouter.length,
  }), 200, origin);
}

/* Exposés pour le banc (scripts/test-proof-dico.mjs) : la validation est la
   pièce qui décide ce qui entre en base, et elle doit être éprouvée à sec. */
export { normaliser as _normaliserMot, MAX_MOTS_LICENCE, MAX_PAR_REQUETE };
