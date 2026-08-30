/* ═══════════════════════════════════════════════════════════════
   desK — RÈGLES MÉTIER PURES (partagées desK ↔ Kora)
   ───────────────────────────────────────────────────────────────
   Né du sprint K-9 (20/07/2026) : Kora doit lire « qui relancer » et
   « quelle page » EXACTEMENT comme desK les affiche. Deux calculs
   recopiés = deux vérités qui divergent au premier correctif — donc
   une seule implémentation, ici, et desK comme Kora s'y branchent.

   CONTRAT : ce module est PUR.
   · zéro DOM, zéro fetch, zéro localStorage, zéro import ;
   · aucun état module — tout arrive en argument (dont `now`, pour
     que les tests n'aient pas à voyager dans le temps) ;
   · donc importable par Kora SANS réveiller le pad (app/desk.js
     pose des listeners au chargement et importe ghostwriter.js —
     il n'est PAS inerte, on ne l'importe pas pour un calcul).

   Ce qui vit ici = ce que les DEUX ont besoin de savoir.
   Ce qui reste dans desk.js = le rendu, les délais de pipeline
   (reluDays/maqDays), les couleurs — personne d'autre n'en a l'usage.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

const DAY = 86400000;

/* ── Statuts d'article ──
   `needsCopy` = la remise est encore attendue (c'est CE fait qui
   déclenche relance et marge de bouclage). Un statut inconnu est
   traité comme « proposé » : on préfère suggérer une relance de trop
   qu'en taire une (comportement historique de desk.js, préservé). */
export const DK_STATUS_LABEL = {
  propose: 'proposé', attendu: 'attendu', remis: 'remis', relu: 'relu',
  maquette: 'maquetté', publie: 'publié', abandonne: 'abandonné',
};
const NEEDS_COPY = {
  propose: true, attendu: true, remis: false, relu: false,
  maquette: false, publie: false, abandonne: false,
};
export function dkNeedsCopy(status) {
  return Object.prototype.hasOwnProperty.call(NEEDS_COPY, status) ? NEEDS_COPY[status] : NEEDS_COPY.propose;
}

/* ── Numérotation d'affichage (folio) ──
   L'ordre PHYSIQUE des pages (p.n) ne bouge JAMAIS : il pilote le
   drag, le move et la confrontation au PDF de pré-impression. Seul
   le folio AFFICHÉ est transformé. L'Épaulette : couverture hors
   numérotation, la page suivante démarre à 0 → le sommaire (3ᵉ page
   physique) porte le « 1 ».
   Deux étages depuis août 2026 (une revue = DEUX maquettes InDesign :
   le cahier de couverture C1-C4 s'ENROULE autour de l'intérieur — la
   3ᵉ/4ᵉ de couv sont les DERNIÈRES pages physiques, le réglage de
   publication seul ne tombait jamais juste) :
   · publication (cover_unnumbered / first_folio) = le socle ;
   · par page (dk_pages.folio_mode / folio_start), par-dessus :
     'hors'  = la page sort de la numérotation (2ᵉ/3ᵉ/4ᵉ de couv…) ;
               elle ne CONSOMME pas de numéro, comme la couverture ;
     'ancre' = la page porte folio_start et la SUITE recoule d'elle.
   ⚠ Kora DOIT passer par là — et fournir `pages` quand il les a : le
   worker ne renvoie que le physique, dire « page 3 » quand la
   rédactrice lit « page 1 » est un bug de conversation. */
export function dkNumOpt(pub) {
  return {
    cover: !!(pub && pub.cover_unnumbered),
    first: (pub && Number.isFinite(pub.first_folio)) ? pub.first_folio : 1,
  };
}
/* Carte n (physique) → folio affiché (entier) ou null (hors numérotation).
   `pages` = TOUTES les pages du numéro ({n, folio_mode, folio_start}) —
   un sous-ensemble fausserait le comptage. Une ancre sur la page 1 gagne
   sur cover_unnumbered (le réglage explicite bat le défaut). */
export function dkFolioMap(pages, pub) {
  const o = dkNumOpt(pub);
  const rows = (pages || [])
    .map(p => ({ n: p.n, mode: p.folio_mode || 'auto', start: p.folio_start }))
    .sort((a, b) => a.n - b.n);
  const map = new Map();
  let counter = o.first;
  for (const p of rows) {
    if (p.mode === 'hors' || (p.mode === 'auto' && o.cover && p.n === 1)) { map.set(p.n, null); continue; }
    // ⚠ Number(null) vaut 0 : une ancre sans numéro recalerait tout à zéro.
    // Données sales (mode 'ancre', start null) → on dégrade en automatique.
    const st = (p.mode === 'ancre' && p.start != null) ? Number(p.start) : NaN;
    if (Number.isFinite(st)) counter = st;
    map.set(p.n, counter); counter++;
  }
  return map;
}
/* Étiquette d'une page hors numérotation, déduite de sa POSITION physique
   (total = nombre de pages du numéro). Version longue pour les fiches… */
export function dkHorsNumLabel(n, total) {
  if (n === 1) return 'Couverture';
  if (total >= 2 && n === total) return '4ᵉ de couverture';
  if (n === 2) return '2ᵉ de couverture';
  if (total >= 3 && n === total - 1) return '3ᵉ de couverture';
  return 'Hors numérotation';
}
/* …et courte pour les planches et les phrases (« p. X ») de Kora. */
export function dkHorsNumShort(n, total) {
  if (n === 1) return 'couv.';
  if (total >= 2 && n === total) return '4ᵉ de couv.';
  if (n === 2) return '2ᵉ de couv.';
  if (total >= 3 && n === total - 1) return '3ᵉ de couv.';
  return 'hors num.';
}
export function dkFolio(n, pub, pages) {   // folio affiché ; null = hors numérotation
  if (pages && pages.length) {
    const map = dkFolioMap(pages, pub);
    if (map.has(n)) return map.get(n);
  }
  const o = dkNumOpt(pub);
  if (o.cover && n === 1) return null;
  return o.first + (n - (o.cover ? 2 : 1));
}
export function dkPn(n, pub, pages) {      // pour « p. X », toasts, phrases de Kora…
  const d = dkFolio(n, pub, pages);
  if (d !== null) return String(d);
  return (pages && pages.length) ? dkHorsNumShort(n, pages.length) : 'couv.';
}

/* ── Relances (§5.4) ──
   La relance À FAIRE se CALCULE, elle n'est jamais stockée :
   - contributeur fiable ou inconnu → relance DOUCE 2 j après l'échéance ;
   - retard moyen constaté > 5 j     → RAPPEL 3 j AVANT l'échéance ;
   - une relance envoyée < 7 j suspend la suggestion ;
   - le pointage (statut ≠ attendu) la fait disparaître d'elle-même.
   Seuls les ENVOIS sont journalisés (dk_relances). */
export function dkContribByName(name, contribs) {
  if (!name) return null;
  const n = String(name).trim().toLowerCase();
  return (contribs || []).find(c => (c.name || '').trim().toLowerCase() === n) || null;
}
export function dkRelancesOf(artId, relances) {
  return (relances || []).filter(r => r.art_id === artId);
}
/* sent_at SQLite = « YYYY-MM-DD HH:MM:SS » UTC sans Z (le Z suffixé
   le fait lire en UTC ; les ISO déjà suffixés passent inchangés) */
function _sentMs(sentAt) {
  return new Date(sentAt + (String(sentAt).endsWith('Z') ? '' : 'Z')).getTime();
}
export function dkRelanceInfo(a, ctx = {}) {
  if (!a || !dkNeedsCopy(a.status) || !a.due || !a.contrib) return null;
  const now = (ctx.now == null) ? Date.now() : ctx.now;
  const c = dkContribByName(a.contrib, ctx.contribs);
  const avg = (c && c.n_remises) ? c.total_delay / c.n_remises : null;
  const offset = (avg !== null && avg > 5) ? -3 : 2;
  const at = new Date(new Date(a.due + 'T12:00:00').getTime() + offset * DAY);
  if (now < at.getTime()) return null;
  const last = dkRelancesOf(a.id, ctx.relances)[0];
  if (last && (now - _sentMs(last.sent_at)) < 7 * DAY) return null;
  return { at, mode: offset < 0 ? 'avant' : 'apres', email: c ? c.email : null };
}
export function dkRelancesDues(articles, ctx = {}) {
  return (articles || []).filter(a =>
    !['publie', 'abandonne'].includes(a.status) && dkRelanceInfo(a, ctx));
}
/* Retard en jours pleins sur l'échéance (négatif = encore dans les temps) */
export function dkLateDays(a, now) {
  if (!a || !a.due) return 0;
  const t = (now == null) ? Date.now() : now;
  return Math.round((t - new Date(a.due + 'T12:00:00').getTime()) / DAY);
}
