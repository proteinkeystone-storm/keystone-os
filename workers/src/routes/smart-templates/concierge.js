// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template · concierge (VEFA Phase 1)
// ───────────────────────────────────────────────────────────────────
// Concierge immobilier VEFA white-label. 1 QR = 1 programme complet
// (toutes ses configurations). Au scan : fenêtre de dialogue brandée
// aux couleurs de l'AGENCE + accueil pré-généré DÉTERMINISTE + cartes
// de comparaison déterministes (chiffres canoniques) + chips questions
// + disclaimer permanent + CTA marque.
//
// Sprint 1 = shell déterministe SANS chat live (le chat SSE arrive au
// Sprint 3, l'endpoint /api/smartqr/concierge au Sprint 2). Aucun appel
// LLM ici : tout est rendu depuis le bloc de connaissance, jamais généré.
//
// Cf. BRIEF_CONCIERGE_VEFA.md (racine PROJET_KEYSTONE).
// ══════════════════════════════════════════════════════════════════

import { escHtml, safeUrl, safeColor, renderKeystoneFoot } from './_shared.js';
import { validateBlock, VERTICALS } from './concierge-schema.js';

// Auto-contraste : couleur de texte lisible POSÉE sur l'accent agence
// (l'agence peut fournir un accent clair OU foncé -> on s'adapte).
function pickTextColor(hex) {
  let h = String(hex || '').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6) return '#ffffff';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.62 ? '#0f172a' : '#ffffff';
}

// Formatage FR déterministe (sans Intl, identique Node/Workers).
// Séparateur de milliers + symboles via escapes explicites : ' '
// = espace ASCII (greppable + testable), '€' = euro, '²' = ².
// L'anti-retour-ligne est géré en CSS (white-space:nowrap), pas par un
// espace fine invisible (qui cassait les tests).
function frThousands(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return '';
  return String(Math.round(num)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
function fmtPrix(n)    { const s = frThousands(n); return s ? s + ' €' : ''; }
function fmtSurface(n) { const s = frThousands(n); return s ? s + ' m²' : ''; }

// Logo « Puce » Keystone (fond clair) — avatar du concierge dans le chat.
// Fills intrinsèques : or (#c9b48a) + bleu nuit (#0a2741). Conçu pour un fond
// CLAIR -> l'avatar est un cercle blanc (cf. .cg-avatar). Remplace l'ancien
// picto maison (2026-05-31, demande Stéphane).
const PUCE_SVG = '<svg viewBox="0 0 260.85 246.17" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
  + '<path fill="#c9b48a" d="M21,143.31c0-46.13,28.69-85.68,69.17-101.75l-7.72-19.53C34.2,41.19,0,88.33,0,143.31c0,41.61,19.59,78.73,50.03,102.63l12.94-16.52c-25.54-20.05-41.97-51.19-41.97-86.1Z"/>'
  + '<path fill="#c9b48a" d="M179.22,22.37l-7.86,19.47c40.11,16.24,68.48,55.6,68.48,101.47,0,35.02-16.54,66.25-42.22,86.29l12.9,16.56c30.61-23.89,50.32-61.11,50.32-102.85,0-54.67-33.82-101.58-81.63-120.94Z"/>'
  + '<path fill="#0a2741" d="M229.14,143.31c0-41.38-25.59-76.89-61.78-91.54l-5.62,13.92c30.69,12.43,52.4,42.52,52.4,77.62,0,26.79-12.67,50.67-32.31,66l9.23,11.85c23.16-18.08,38.09-46.25,38.09-77.85Z"/>'
  + '<path fill="#0a2741" d="M46.71,143.31c0-35.29,21.96-65.53,52.93-77.82l-5.53-13.97c-36.52,14.5-62.4,50.18-62.4,91.8,0,31.5,14.83,59.59,37.87,77.68l9.26-11.82c-19.54-15.34-32.13-39.15-32.13-65.86Z"/>'
  + '<circle fill="#0a2741" cx="130.42" cy="143.31" r="24.46"/>'
  + '<path fill="#c9b48a" d="M108.68,65.49h42.9l19.79-60.83c-27.22-6.17-54.28-6.24-81.19,0l18.51,60.83Z"/>'
  + '</svg>';

// Repères (placeholders) pour les chiffres confiés à l'IA.
// CONSTAT terrain : Mistral Small 3.1 perd les ZEROS des nombres qu'on lui
// demande de recopier (595000 -> « 595 », 105 -> « 15 », 110 -> « 11 »).
// Aucune consigne de prompt n'y change rien. On ne lui donne donc JAMAIS les
// chiffres : chaque montant/surface devient un repère SANS chiffre {{Pa}} /
// {{Sa}} / {{Ja}} (P=prix, S=surface, J=jardin ; suffixe = index config en
// lettres). Le modèle recopie le repère tel quel ; la page (VAL) le remplace
// par la valeur EXACTE formatée. Zéro chiffre ne transite par le modèle.
function _tokSuffix(i) {
  let s = '', n = i;
  do { s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}
export function conciergeTokenMap(configs, programme) {
  const map = {};   // repère -> valeur exacte formatée (ex : { Pa: '389 000 €' })
  const tok = [];   // par config : { prix?, surface?, jardin? } (repères)
  // Repère programme-level : la livraison contient une année (ex 2027) que
  // Mistral tronque (« 227 »). On la confie donc comme repère {{Liv}}, jamais
  // en clair — recopié tel quel par le modèle, converti à l'affichage.
  const prog = {};
  const liv  = String((programme && programme.livraison_prevue) || '').trim();
  if (liv) { prog.livraison = '{{Liv}}'; map['Liv'] = liv; }
  (Array.isArray(configs) ? configs : []).forEach((c, i) => {
    const suf = _tokSuffix(i);
    const ann = (c && c.surfaces_annexes) || {};
    const e   = {};
    // Prix : immo = nombre formaté (fmtPrix) ; generic = texte libre
    // (prix_label, ex « 6 € la partie »). Dans les 2 cas il devient un repère
    // {{Pa}} (l'IA ne voit jamais les chiffres -> ne les mange pas).
    const px = fmtPrix(c && c.prix_ttc) || ((c && c.prix_label) ? String(c.prix_label).slice(0, 60) : '');
    const sf = fmtSurface(c && c.surface_habitable_m2);
    const jd = fmtSurface(ann.jardin_m2);
    if (px) { e.prix    = '{{P' + suf + '}}'; map['P' + suf] = px; }
    if (sf) { e.surface = '{{S' + suf + '}}'; map['S' + suf] = sf; }
    if (jd) { e.jardin  = '{{J' + suf + '}}'; map['J' + suf] = jd; }
    tok[i] = e;
  });
  return { map, tok, prog };
}

const STATUT_META = {
  disponible: { label: 'Disponible', cls: 'is-dispo' },
  optionne:   { label: 'Optionné',   cls: 'is-opt'   },
  vendu:      { label: 'Vendu',      cls: 'is-vendu' },
};

const TEMPLATE = {
  id:            'concierge',
  label:         'Concierge immobilier (VEFA)',
  tier_required: 'pro',

  // Validation déléguée au CONTRAT (concierge-schema.js). vertical-aware :
  // immo (défaut) = messages IDENTIQUES à l'historique -> zéro régression ;
  // generic = messages parallèles. Cf. validateBlock.
  validate(template_data) {
    return validateBlock(template_data);
  },

  renderHTML(qrData, scanCtx) {
    const d         = qrData?.template_data || {};
    const safeShort = String(qrData?.short_id || '').replace(/[^a-zA-Z0-9]/g, '');
    const prog      = d.programme || {};
    const b         = d.branding || {};
    const contact   = d.contact_humain || {};

    // Vertical (S8) : immo (défaut) = rendu HISTORIQUE byte-identique ;
    // generic = cartes « offre » (intitulé + attributs libres) + libellés
    // parallèles. Le métier est porté par le BLOC (d.vertical), jamais par
    // le code appelant. Méta libellés = VERTICALS (contrat figé S5).
    const vertical = d.vertical === 'generic' ? 'generic' : 'immo';
    const V        = VERTICALS[vertical] || VERTICALS.immo;

    // Branding : couleurs agence + auto-contraste. Marque en ACCENT,
    // jamais en aplat plein écran ; canvas clair neutre, sobre.
    const accent   = safeColor(b.couleur_primaire,   '#7c8af9');
    const accent2  = safeColor(b.couleur_secondaire, '#c9a96e');
    const onAccent = pickTextColor(accent);

    const agence   = escHtml((b.nom_agence || '').toString().slice(0, 80));
    const logoUrl  = safeUrl(b.logo_url);
    const bannerUrl = safeUrl(b.banner_url);

    const progNom   = escHtml((prog.nom || '').toString().slice(0, 120));
    const progVille = escHtml((prog.ville || '').toString().slice(0, 80));
    const progLivr  = escHtml((prog.livraison_prevue || '').toString().slice(0, 80));

    const disclaimer = escHtml((d.disclaimer || '').toString().slice(0, 400));
    const contactNom = escHtml((contact.nom || '').toString().slice(0, 80));
    const contactTel = escHtml((contact.tel || '').toString().slice(0, 40));
    const telHref    = (contact.tel || '').toString().replace(/[^0-9+]/g, '').slice(0, 20);

    // Valeurs brutes pour le script chat (Sprint 3). jsInject = JSON.stringify
    // + neutralisation de '<' (empêche un </script> dans une donnée de casser
    // le script). Le texte est posé via textContent côté client = pas de XSS.
    const contactNomRaw = (contact.nom || '').toString().slice(0, 80);
    const jsInject = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

    // Langue de la dictee vocale (Web Speech API) — BCP-47 depuis la persona.
    const langDefault = (d.persona?.langue_par_defaut || 'fr').toString().toLowerCase();
    const speechLang  = ({ fr: 'fr-FR', en: 'en-US', es: 'es-ES', de: 'de-DE', it: 'it-IT', pt: 'pt-PT', nl: 'nl-NL' })[langDefault] || 'fr-FR';

    const configs     = Array.isArray(d.configurations) ? d.configurations : [];
    const suggestions = Array.isArray(d.questions_suggerees) ? d.questions_suggerees : [];
    // Repères chiffrés -> valeurs exactes, injectés côté page : le chat
    // remplace les {{Pa}}/{{Sa}}/{{Ja}} produits par l'IA (cf. conciergeTokenMap).
    const tokenValues = conciergeTokenMap(configs, d.programme).map;

    // Accueil DÉTERMINISTE — construit depuis le bloc, jamais généré par un LLM.
    // Immo = phrase HISTORIQUE inchangée ; generic = cadrage « offres ».
    const welcome = vertical === 'generic'
      ? 'Bonjour et bienvenue. Je suis le concierge' + (agence ? ' de ' + agence : '') +
        (progNom ? ' pour ' + progNom : '') + '. Posez-moi vos questions : ' +
        'je vous aide à découvrir nos offres et à choisir celle qui vous convient.'
      : 'Bonjour et bienvenue. Je suis le concierge' + (agence ? ' de ' + agence : '') +
        ' pour le programme ' + (progNom || 'immobilier') + '. Posez-moi vos questions : ' +
        'je vous aide à comparer les modèles et à choisir celui qui vous convient.';

    // Cartes de comparaison DÉTERMINISTES — les chiffres canoniques vivent ici.
    // Generic (S8) : carte « offre » = intitulé + attributs libres (label/value)
    // + description + prix. Réutilise .cg-card / .cg-specs ; la valeur peut
    // wrapper via .cg-card-gen (l'immo garde white-space:nowrap → zéro régression).
    const cardsHtml = vertical === 'generic'
      ? configs.map((c) => {
          const ref   = escHtml((c.reference || '').toString().slice(0, 60));
          const desc  = escHtml((c.description || '').toString().slice(0, 180));
          // Generic : prix en texte libre (prix_label) ; sinon nombre formaté.
          const prix  = fmtPrix(c.prix_ttc) || escHtml((c.prix_label || '').toString().slice(0, 60));
          const attrs = Array.isArray(c.attributs) ? c.attributs : [];
          const specs = attrs.slice(0, 6).map((a) => {
            const label = escHtml(((a && a.label) || '').toString().slice(0, 40));
            const value = escHtml(((a && a.value) || '').toString().slice(0, 80));
            return (label || value)
              ? `<div class="cg-spec"><dt>${label || '·'}</dt><dd>${value || '—'}</dd></div>`
              : '';
          }).filter(Boolean).join('');
          return `<article class="cg-card cg-card-gen">
        <header class="cg-card-h">
          <h3 class="cg-card-ref">${ref || 'Offre'}</h3>
        </header>
        ${desc ? `<p class="cg-card-type">${desc}</p>` : ''}
        ${specs ? `<dl class="cg-specs">${specs}</dl>` : ''}
        <div class="cg-card-price">${prix || 'Prix sur demande'}</div>
      </article>`;
        }).join('')
      : configs.map((c) => {
      const ref    = escHtml((c.reference || '').toString().slice(0, 60));
      const type   = escHtml((c.type || '').toString().slice(0, 24));
      const chamb  = Number(c.nb_chambres);
      const surf   = fmtSurface(c.surface_habitable_m2);
      const expo   = escHtml((c.exposition || '').toString().slice(0, 40));
      const prix   = fmtPrix(c.prix_ttc);
      const st     = STATUT_META[c.statut] || null;
      const annex  = c.surfaces_annexes || {};
      const jardin = fmtSurface(annex.jardin_m2);
      const garage = annex.garage === true || annex.garage === 'true';

      const specs = [
        surf  ? `<div class="cg-spec"><dt>Surface</dt><dd>${surf}</dd></div>` : '',
        Number.isFinite(chamb) ? `<div class="cg-spec"><dt>Chambres</dt><dd>${chamb}</dd></div>` : '',
        expo  ? `<div class="cg-spec"><dt>Exposition</dt><dd>${expo}</dd></div>` : '',
        jardin ? `<div class="cg-spec"><dt>Jardin</dt><dd>${jardin}</dd></div>` : '',
        garage ? `<div class="cg-spec"><dt>Garage</dt><dd>Oui</dd></div>` : '',
      ].filter(Boolean).join('');

      return `<article class="cg-card${st ? ' ' + st.cls : ''}">
        <header class="cg-card-h">
          <h3 class="cg-card-ref">${ref || 'Modèle'}</h3>
          ${st ? `<span class="cg-pill ${st.cls}">${st.label}</span>` : ''}
        </header>
        ${(type || Number.isFinite(chamb)) ? `<p class="cg-card-type">${type}${(type && Number.isFinite(chamb)) ? ' · ' : ''}${Number.isFinite(chamb) ? chamb + ' ch.' : ''}</p>` : ''}
        ${specs ? `<dl class="cg-specs">${specs}</dl>` : ''}
        <div class="cg-card-price">${prix || 'Prix sur demande'}</div>
      </article>`;
    }).join('');

    // Chips questions — visuelles au Sprint 1, câblées au chat au Sprint 3.
    const chipsHtml = suggestions.slice(0, 6).map((q) => {
      const txt = escHtml(String(q || '').slice(0, 120));
      return txt ? `<button class="cg-chip" type="button" data-q="${txt}">${txt}</button>` : '';
    }).filter(Boolean).join('');

    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${progNom || 'Programme'} · Concierge</title>
<style>
  :root {
    --acc: ${accent};
    --acc2: ${accent2};
    --on-acc: ${onAccent};
    --bg: #f6f7f9; --surface: #ffffff; --surface-2: #fbfcfd;
    --tx: #0f172a; --mut: #64748b; --bd: #e6e9ee; --bd-soft: #eef1f5;
  }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--tx);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    letter-spacing: -0.02em; min-height: 100vh; -webkit-font-smoothing: antialiased; }
  body { display: flex; justify-content: center;
    padding: 22px 16px calc(124px + env(safe-area-inset-bottom, 0px)); min-height: 100vh; }

  .cg-shell { width: 100%; max-width: 560px; position: relative; }

  .cg-window {
    background: var(--surface); border: 1px solid var(--bd);
    border-radius: 22px; overflow: hidden;
    box-shadow: 0 24px 60px rgba(15,23,42,.08), 0 2px 6px rgba(15,23,42,.04);
  }
  .cg-accentbar { height: 4px; background: linear-gradient(90deg, var(--acc), var(--acc2)); }

  /* Header agence */
  .cg-head { padding: 20px 22px 16px; border-bottom: 1px solid var(--bd-soft); }
  .cg-brandrow { display: flex; align-items: center; gap: 12px; }
  .cg-logo { width: 42px; height: 42px; border-radius: 10px; object-fit: contain;
    background: var(--surface-2); border: 1px solid var(--bd-soft); flex: 0 0 auto; }
  .cg-logo-fallback { width: 42px; height: 42px; border-radius: 10px; flex: 0 0 auto;
    display: flex; align-items: center; justify-content: center;
    background: var(--acc); color: var(--on-acc); font-weight: 800; font-size: 17px; }
  .cg-agence { font-size: 12px; letter-spacing: .04em; color: var(--mut);
    text-transform: uppercase; font-weight: 700; margin: 0 0 2px; }
  .cg-prog { font-size: 18px; font-weight: 800; margin: 0; line-height: 1.2; }
  .cg-sub { font-size: 12.5px; color: var(--mut); margin: 10px 0 0; }
  .cg-sub b { color: var(--tx); font-weight: 600; }

  /* Cover facon reseau social — visuel large en haut, logo en chevauchement */
  .cg-cover { width: 100%; aspect-ratio: 16 / 6; max-height: 190px; overflow: hidden;
    background: var(--surface-2); }
  .cg-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .cg-head--cover { padding-top: 12px; }
  .cg-head--cover .cg-brandrow { align-items: flex-end; }
  .cg-head--cover .cg-logo,
  .cg-head--cover .cg-logo-fallback {
    width: 64px; height: 64px; margin-top: -44px; border-radius: 15px;
    border: 3px solid var(--surface); box-shadow: 0 6px 18px rgba(15,23,42,.22); }

  /* Zone de dialogue */
  .cg-dialog { padding: 18px 18px 8px; }
  .cg-bubble { display: flex; gap: 10px; align-items: flex-start; }
  .cg-avatar { width: 30px; height: 30px; border-radius: 50%; flex: 0 0 auto;
    background: #fff; border: 1px solid rgba(10,39,65,.12);
    box-shadow: 0 1px 3px rgba(0,0,0,.12);
    display: flex; align-items: center; justify-content: center; }
  .cg-avatar svg { width: 20px; height: 20px; display: block; }
  .cg-msg { background: var(--surface-2); border: 1px solid var(--bd-soft);
    border-radius: 4px 14px 14px 14px; padding: 12px 14px;
    font-size: 14.5px; line-height: 1.5; color: var(--tx); }

  /* Cartes de comparaison */
  .cg-cards-h { font-size: 11.5px; letter-spacing: .12em; text-transform: uppercase;
    color: var(--mut); font-weight: 700; margin: 22px 4px 10px; }
  /* Carrousel horizontal — slide lateral au doigt, snap par carte, bleed
     jusqu'aux bords de la fenetre, peek de la carte suivante (signal scroll). */
  .cg-cards { display: flex; gap: 12px; overflow-x: auto; overflow-y: hidden;
    scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch;
    margin: 0 -18px; padding: 4px 18px 12px; scroll-padding-left: 18px;
    scrollbar-width: none; }
  .cg-cards::-webkit-scrollbar { display: none; }
  .cg-card { flex: 0 0 80%; max-width: 264px; scroll-snap-align: start;
    display: flex; flex-direction: column;
    border: 1px solid var(--bd); border-radius: 14px; padding: 14px 14px 12px;
    background: var(--surface); transition: border-color .15s ease, transform .15s ease; }
  @media (min-width: 460px) { .cg-card { flex-basis: 244px; } }
  .cg-card.is-vendu { opacity: .56; }
  .cg-card-h { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .cg-card-ref { font-size: 15.5px; font-weight: 800; margin: 0; letter-spacing: -.01em; }
  .cg-card-type { font-size: 12.5px; color: var(--mut); margin: 4px 0 0; font-weight: 600; }
  .cg-pill { font-size: 10px; letter-spacing: .06em; text-transform: uppercase;
    font-weight: 800; padding: 3px 8px; border-radius: 999px; white-space: nowrap; }
  .cg-pill.is-dispo { background: rgba(16,185,129,.12); color: #047857; }
  .cg-pill.is-opt   { background: rgba(245,158,11,.14); color: #b45309; }
  .cg-pill.is-vendu { background: rgba(100,116,139,.14); color: #475569; }
  .cg-specs { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px;
    margin: 12px 0 12px; padding: 0; }
  .cg-spec { margin: 0; }
  .cg-spec dt { font-size: 10.5px; letter-spacing: .04em; text-transform: uppercase;
    color: var(--mut); font-weight: 700; }
  .cg-spec dd { margin: 1px 0 0; font-size: 13.5px; font-weight: 600; color: var(--tx);
    white-space: nowrap; }
  .cg-card-price { font-size: 17px; font-weight: 800; color: var(--acc);
    letter-spacing: -.01em; margin-top: auto; padding-top: 2px; white-space: nowrap; }
  .cg-card.is-vendu .cg-card-price { color: var(--mut); }
  /* Generic (S8) : la valeur d'un attribut libre peut être longue → wrap autorisé. */
  .cg-card-gen .cg-spec dd { white-space: normal; }

  /* Chips questions */
  .cg-chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 20px 4px 6px; }
  .cg-chip { font-family: inherit; font-size: 13px; font-weight: 600; letter-spacing: -.01em;
    color: var(--tx); background: var(--surface); cursor: pointer;
    border: 1px solid var(--bd); border-radius: 999px; padding: 9px 14px;
    transition: border-color .15s ease, background .15s ease, transform .12s ease; }
  .cg-chip:hover { border-color: var(--acc); background: var(--surface-2); }
  .cg-chip:active { transform: scale(.97); }

  /* Disclaimer permanent + contact */
  .cg-foot { padding: 14px 20px 18px; border-top: 1px solid var(--bd-soft); margin-top: 18px; }
  .cg-disclaimer { font-size: 11.5px; line-height: 1.5; color: var(--mut); margin: 0; }
  .cg-contact { font-size: 12.5px; color: var(--tx); margin: 10px 0 0; }
  .cg-contact a { color: var(--acc); text-decoration: none; font-weight: 700; }

  /* CTA marque */
  .cg-cta-wrap { padding: 0 18px; margin-top: 14px; }
  .cg-cta { display: flex; align-items: center; justify-content: center; gap: 8px;
    width: 100%; padding: 14px 20px; border-radius: 13px; border: 0;
    background: var(--acc); color: var(--on-acc); font-size: 15px; font-weight: 700;
    font-family: inherit; letter-spacing: -.01em; text-decoration: none; cursor: pointer;
    box-shadow: 0 10px 24px ${accent}33; transition: transform .14s ease, box-shadow .14s ease; }
  .cg-cta:hover { transform: translateY(-1px); box-shadow: 0 14px 30px ${accent}40; }
  .cg-cta:active { transform: scale(.99); }
  .cg-cta svg { width: 16px; height: 16px; stroke: var(--on-acc); }

  .cg-keyfoot { margin-top: 18px; text-align: center; }
  .cg-keyfoot .sq-foot { margin: 0; color: var(--mut); font-size: 10.5px; line-height: 1.45; opacity: .68; }
  .cg-keyfoot .sq-foot a { color: var(--mut); text-decoration: none; font-weight: 600; }

  /* ── Chat live (Sprint 3) ────────────────────────────────── */
  .cg-thread { display: flex; flex-direction: column; gap: 12px; margin: 16px 0 2px; }
  .cg-thread:empty { margin: 0; }
  .cg-row { display: flex; gap: 10px; align-items: flex-start; }
  .cg-row-user { justify-content: flex-end; }
  .cg-b { font-size: 14.5px; line-height: 1.5; padding: 11px 14px; border-radius: 14px;
    max-width: 84%; white-space: pre-wrap; overflow-wrap: anywhere; }
  .cg-b-ai { background: var(--surface-2); border: 1px solid var(--bd-soft);
    border-radius: 4px 14px 14px 14px; color: var(--tx); }
  .cg-b-user { background: var(--acc); color: var(--on-acc);
    border-radius: 14px 14px 4px 14px; font-weight: 500; }

  /* Pulse « réflexion » — orbe qui respire, teinté couleur agence.
     Masque la latence du 1er token Mistral (~1-2 s). */
  .cg-pulse { display: inline-block; width: 18px; height: 18px; border-radius: 50%;
    background: radial-gradient(circle at 34% 32%, var(--acc), var(--acc2));
    animation: cg-breathe 1.4s ease-in-out infinite; vertical-align: middle; }
  @keyframes cg-breathe {
    0%, 100% { transform: scale(.78); opacity: .55; box-shadow: 0 0 0 0 var(--acc); }
    50%      { transform: scale(1.06); opacity: 1;  box-shadow: 0 0 0 7px transparent; }
  }

  /* Dock de saisie — barre sticky en bas d'ecran, TOUJOURS visible. Centree
     sur la largeur de la fenetre, fond degrade pour la detacher du contenu. */
  .cg-dock { position: fixed; left: 0; right: 0; bottom: 0; z-index: 60;
    display: flex; justify-content: center; pointer-events: none;
    padding: 26px 16px calc(16px + env(safe-area-inset-bottom, 0px));
    background: linear-gradient(to top,
      ${accent}b3 0%, ${accent}80 20%, ${accent}40 44%, ${accent}1a 68%, ${accent}00 100%); }
  .cg-dock-inner { width: 100%; max-width: 560px; pointer-events: auto; }

  /* Barre de saisie — flashy : bord accent agence, halo colore, elevation */
  .cg-inputbar { display: flex; gap: 8px; align-items: center;
    background: var(--surface); border: 1.5px solid ${accent}55; border-radius: 16px;
    padding: 6px 6px 6px 16px;
    box-shadow: 0 12px 36px rgba(15,23,42,.18), 0 0 0 4px ${accent}14;
    transition: border-color .18s ease, box-shadow .18s ease; }
  .cg-inputbar:focus-within { border-color: var(--acc);
    box-shadow: 0 16px 44px ${accent}3a, 0 0 0 4px ${accent}2a; }
  .cg-input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent;
    font-family: inherit; font-size: 15px; color: var(--tx); letter-spacing: -.01em; padding: 10px 0; }
  .cg-input::placeholder { color: var(--mut); }
  .cg-send { flex: 0 0 auto; width: 44px; height: 44px; border: 0; border-radius: 13px;
    cursor: pointer; color: var(--on-acc);
    background: linear-gradient(135deg, var(--acc), var(--acc2));
    box-shadow: 0 6px 16px ${accent}55;
    display: flex; align-items: center; justify-content: center;
    transition: opacity .15s ease, transform .12s ease, box-shadow .15s ease; }
  .cg-send:not(:disabled):hover { transform: translateY(-1px); box-shadow: 0 9px 22px ${accent}66; }
  .cg-send:disabled { opacity: .45; cursor: default; box-shadow: none; }
  .cg-send:not(:disabled):active { transform: scale(.94); }
  .cg-send svg { width: 18px; height: 18px; stroke: var(--on-acc); }

  /* Bouton micro — dictee vocale (Web Speech API), masque si non supporte */
  .cg-mic { flex: 0 0 auto; width: 40px; height: 40px; border: 0; border-radius: 12px;
    cursor: pointer; background: transparent; color: var(--mut);
    display: flex; align-items: center; justify-content: center;
    transition: color .15s ease, background .15s ease, transform .12s ease; }
  .cg-mic:hover { color: var(--acc); background: ${accent}14; }
  .cg-mic:active { transform: scale(.94); }
  .cg-mic svg { width: 20px; height: 20px; stroke: currentColor; }
  .cg-mic.is-listening { color: #fff; background: #e5484d; }
  .cg-mic.is-listening { animation: cg-miclisten 1.2s ease-in-out infinite; }
  @keyframes cg-miclisten {
    0%, 100% { box-shadow: 0 0 0 0 rgba(229,72,77,.5); }
    50%      { box-shadow: 0 0 0 7px rgba(229,72,77,0); }
  }

  /* CTA chauffé sur intention (après 2 questions / sujet prix-dispo) */
  .cg-cta.cg-cta-hot { animation: cg-glow 1.7s ease-in-out infinite; }
  @keyframes cg-glow {
    0%, 100% { box-shadow: 0 10px 24px ${accent}33; }
    50%      { box-shadow: 0 12px 30px ${accent}66; }
  }

  /* Accessibilité : respecte prefers-reduced-motion (pulse + glow figés) */
  @media (prefers-reduced-motion: reduce) {
    .cg-pulse { animation: none; opacity: .82; }
    .cg-cta.cg-cta-hot { animation: none; box-shadow: 0 12px 30px ${accent}55; }
    .cg-chip:active, .cg-send:not(:disabled):active, .cg-cta:active { transform: none; }
  }
</style>
</head>
<body>
<div class="cg-shell">
  <div class="cg-window">
    ${bannerUrl
      ? `<div class="cg-cover"><img src="${bannerUrl}" alt="${agence}" loading="eager"></div>`
      : '<div class="cg-accentbar" aria-hidden="true"></div>'}

    <header class="cg-head${bannerUrl ? ' cg-head--cover' : ''}">
      <div class="cg-brandrow">
        ${logoUrl
          ? `<img class="cg-logo" src="${logoUrl}" alt="${agence}" loading="eager">`
          : `<div class="cg-logo-fallback" aria-hidden="true">${(agence || 'A').slice(0, 1)}</div>`}
        <div>
          ${agence ? `<p class="cg-agence">${agence}</p>` : ''}
          <h1 class="cg-prog">${progNom || 'Programme immobilier'}</h1>
        </div>
      </div>
      ${(progVille || progLivr) ? `<p class="cg-sub">${progVille ? progVille : ''}${(progVille && progLivr) ? ' · ' : ''}${progLivr ? `Livraison <b>${progLivr}</b>` : ''}</p>` : ''}
    </header>

    <section class="cg-dialog">
      <div class="cg-bubble">
        <div class="cg-avatar" aria-hidden="true">${PUCE_SVG}</div>
        <div class="cg-msg">${welcome}</div>
      </div>

      ${cardsHtml ? `<p class="cg-cards-h">${V.cards_heading}</p>
      <div class="cg-cards">${cardsHtml}</div>` : ''}

      ${chipsHtml ? `<div class="cg-chips">${chipsHtml}</div>` : ''}

      <div class="cg-thread" id="cg-thread" aria-live="polite"></div>
    </section>

    <div class="cg-cta-wrap">
      <a class="cg-cta" id="cg-cta" href="/r/${safeShort}?direct=1">
        Découvrir le programme
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
      </a>
    </div>

    <footer class="cg-foot">
      ${disclaimer ? `<p class="cg-disclaimer">${disclaimer}</p>` : ''}
      ${(contactNom || contactTel) ? `<p class="cg-contact">Votre conseiller : <b>${contactNom || ''}</b>${(contactNom && contactTel) ? ' — ' : ''}${contactTel ? `<a href="tel:${telHref}">${contactTel}</a>` : ''}</p>` : ''}
    </footer>
  </div>

  <div class="cg-keyfoot">${renderKeystoneFoot()}</div>
</div>

<div class="cg-dock" id="cg-dock">
  <div class="cg-dock-inner">
    <div class="cg-inputbar">
      <input class="cg-input" id="cg-input" type="text" autocomplete="off" enterkeyhint="send"
             maxlength="500" placeholder="Posez votre question…" aria-label="Votre question">
      <button class="cg-mic" id="cg-mic" type="button" aria-label="Dicter votre question" hidden>
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
      </button>
      <button class="cg-send" id="cg-send" type="button" aria-label="Envoyer la question">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      </button>
    </div>
  </div>
</div>

<script>
(function () {
  var SHORT = ${jsInject(safeShort)};
  var CNAME = ${jsInject(contactNomRaw)};
  var CTEL  = ${jsInject(telHref)};
  var LANG  = ${jsInject(speechLang)};
  var VAL   = ${jsInject(tokenValues)};
  var API   = '/api/smartqr/concierge';
  var AISVG = ${JSON.stringify(PUCE_SVG)};
  var INTENT_RE = /(prix|tarif|budget|co[uû]te|cout|dispo|disponib|r[ée]serv|acheter|visite|rendez|financ|pr[êe]t)/i;

  var thread = document.getElementById('cg-thread');
  var input  = document.getElementById('cg-input');
  var sendBtn = document.getElementById('cg-send');
  var cta    = document.getElementById('cg-cta');
  if (!thread || !input || !sendBtn) return;

  var history = [];
  var asking  = false;
  var nbAsked = 0;

  function el(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }
  // Rendu Markdown minimal des reponses IA : **gras** -> <strong>, et on
  // n'affiche JAMAIS les marqueurs ** / __ en clair. esc() AVANT toute
  // injection HTML (le texte du modele est non fiable).
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function md(s) {
    var h = esc(s);
    // Repères chiffrés {{Pa}}/{{Sa}}/{{Ja}} -> valeur exacte (le modèle perd
    // les zeros des nombres, donc il n'a jamais vu les chiffres). Repère
    // inconnu -> retiré (jamais d'accolades affichées au visiteur).
    h = h.replace(/\\{\\{\\s*([A-Za-z]{2,6})\\s*\\}\\}/g, function (mm, k) {
      return Object.prototype.hasOwnProperty.call(VAL, k) ? esc(VAL[k]) : '';
    });
    h = h.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
    h = h.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    h = h.replace(/\\*\\*/g, '').replace(/__/g, '');
    // Puces : tiret / asterisque en debut de ligne -> vraie puce (lisibilite).
    h = h.replace(/(^|\\n)[ \\t]*[-*]\\s+/g, '$1• ');
    // Milliers : Mistral renvoie un nombre contigu (389000 €). On le rend
    // lisible cote affichage : 389000 € -> 389 000 €, 1180 m² -> 1 180 m².
    h = h.replace(/(\\d[\\d ]*\\d)\\s*(€|m²|euros?)/g, function (mm, num, unit) {
      var raw = num.replace(/\\s+/g, '');
      var g = raw.length < 4 ? raw : raw.replace(/\\B(?=(\\d{3})+(?!\\d))/g, ' ');
      return g + ' ' + unit;
    });
    return h;
  }
  var dock = document.getElementById('cg-dock');
  // Dock sticky en bas : on garde le dernier message AU-DESSUS du dock. Le fil
  // n'est pas le dernier element du body (CTA + footer sont dessous), donc on
  // vise le bas du dernier message + la hauteur du dock, pas le bas de page.
  function down() {
    try {
      var clear = (dock ? dock.offsetHeight : 84) + 14;
      var last = thread.lastElementChild;
      if (last) {
        var bottom = last.getBoundingClientRect().bottom + window.scrollY;
        var target = bottom - window.innerHeight + clear;
        if (target > window.scrollY) window.scrollTo(0, target);
      } else {
        window.scrollTo(0, document.body.scrollHeight);
      }
    } catch (e) {}
  }

  function addUser(text) {
    var row = el('div', 'cg-row cg-row-user');
    var b = el('div', 'cg-b cg-b-user'); b.textContent = text;
    row.appendChild(b); thread.appendChild(row); down();
  }
  function addAi() {
    var row = el('div', 'cg-row cg-row-ai');
    var av = el('div', 'cg-avatar'); av.setAttribute('aria-hidden', 'true'); av.innerHTML = AISVG;
    var b = el('div', 'cg-b cg-b-ai');
    var orb = el('span', 'cg-pulse'); orb.setAttribute('aria-label', 'Réflexion en cours');
    b.appendChild(orb);
    row.appendChild(av); row.appendChild(b); thread.appendChild(row); down();
    return b;
  }

  function ask(question) {
    question = (question || '').trim();
    if (asking || question.length < 2) return;
    asking = true; sendBtn.disabled = true; input.value = '';
    addUser(question);
    var bubble = addAi();

    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ short_id: SHORT, question: question, history: history })
    }).then(function (resp) {
      if (!resp.ok || !resp.body) throw new Error('net');
      var reader = resp.body.getReader();
      var dec = new TextDecoder('utf-8');
      var buf = '', full = '', started = false, errored = false;

      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return;
          buf += dec.decode(r.value, { stream: true });
          var lines = buf.split('\\n'); buf = lines.pop() || '';
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (line.indexOf('data:') !== 0) continue;
            var data = line.slice(5).trim();
            if (!data) continue;
            var ev; try { ev = JSON.parse(data); } catch (e) { continue; }
            if (ev.type === 'chunk' && ev.text) {
              if (!started) { bubble.textContent = ''; started = true; }
              full += ev.text; bubble.innerHTML = md(full); down();
            } else if (ev.type === 'done') {
              if (ev.full_text) { full = ev.full_text; bubble.innerHTML = md(full); }
            } else if (ev.type === 'error') {
              errored = true;
            }
          }
          return pump();
        });
      }

      return pump().then(function () {
        if (errored || !full) throw new Error('empty');
        history.push({ role: 'user', content: question });
        history.push({ role: 'assistant', content: full });
        if (history.length > 16) history = history.slice(-16);
      });
    }).catch(function () {
      var fb = 'Je ne parviens pas à répondre pour le moment.';
      if (CNAME) fb += ' Contactez ' + CNAME + (CTEL ? ' (' + CTEL + ')' : '') + '.';
      bubble.textContent = fb;
    }).then(function () {
      asking = false; sendBtn.disabled = false; nbAsked++;
      if (cta && (nbAsked >= 2 || INTENT_RE.test(question))) cta.classList.add('cg-cta-hot');
      down();
    });
  }

  var chips = document.querySelectorAll('.cg-chip');
  for (var i = 0; i < chips.length; i++) {
    chips[i].addEventListener('click', function () { ask(this.getAttribute('data-q')); });
  }
  sendBtn.addEventListener('click', function () { ask(input.value); });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); ask(input.value); }
  });

  // Dictee vocale (Web Speech API) — bouton micro optionnel. On ne le revele
  // que si le navigateur sait reconnaitre la parole (sinon il reste masque).
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var micBtn = document.getElementById('cg-mic');
  if (SR && micBtn) {
    micBtn.hidden = false;
    var rec = null, listening = false;
    function stopMic() {
      listening = false;
      micBtn.classList.remove('is-listening');
      input.placeholder = 'Posez votre question…';
    }
    micBtn.addEventListener('click', function () {
      if (listening) { try { rec && rec.stop(); } catch (e) {} return; }
      try {
        rec = new SR();
        rec.lang = LANG || 'fr-FR';
        rec.interimResults = true;
        rec.continuous = false;
        rec.maxAlternatives = 1;
        var base = (input.value || '').trim();
        rec.onstart = function () { listening = true; micBtn.classList.add('is-listening'); input.placeholder = 'Parlez…'; };
        rec.onresult = function (e) {
          var txt = '';
          for (var k = 0; k < e.results.length; k++) txt += e.results[k][0].transcript;
          input.value = (base ? base + ' ' : '') + txt;
        };
        rec.onerror = function () { stopMic(); };
        rec.onend = function () { stopMic(); input.focus(); };
        rec.start();
      } catch (e) { stopMic(); }
    });
  }
})();
</script>
</body>
</html>`;
  },
};

export default TEMPLATE;

// ══════════════════════════════════════════════════════════════════
// Sprint 2 — System prompt du concierge (consommé par l'endpoint live
// POST /api/smartqr/concierge dans qr.js). Pur + déterministe = testable
// sans réseau. Reproduit MOT POUR MOT les règles §3 du brief et injecte
// le bloc de connaissance en DONNÉES JSON (chiffres EXACTS, jamais
// retapés par le modèle). Le statut « vendu » reste DANS les données
// (le modèle doit le voir pour l'exclure), la règle lui interdit de le
// proposer. Cf. BRIEF_CONCIERGE_VEFA.md §3.
// ══════════════════════════════════════════════════════════════════
export function buildConciergePrompt(block) {
  const d       = block || {};
  const prog    = d.programme || {};
  const b       = d.branding || {};
  const persona = d.persona || {};
  const contact = d.contact_humain || {};

  const agence  = String(b.nom_agence || '').trim() || 'l\'agence';
  const progNom = String(prog.nom || '').trim() || 'le programme';
  const ton     = String(persona.ton || '').trim() || 'professionnel et chaleureux';
  const langue  = String(persona.langue_par_defaut || '').trim() || 'fr';

  const contactNom = String(contact.nom || '').trim() || 'votre conseiller';
  const contactTel = String(contact.tel || '').trim();
  // Le numéro de téléphone n'est JAMAIS confié au modèle — NI en chiffres (il
  // perd les zéros) NI en repère {{Tel}} (Mistral mangle aussi le repère, vu
  // en prod : « au .sgemm »). Le modèle renvoie vers les coordonnées affichées
  // en bas de page (footer déterministe + lien tel:), toujours exactes.
  const contactRef = contactNom;

  // Generic (S8) : cadrage « enseigne / offres » + DONNÉES qui incluent les
  // attributs libres et la description (le coeur du contenu generic, qu'il
  // FAUT fournir à l'IA pour qu'elle puisse répondre/comparer). L'immo garde
  // son prompt HISTORIQUE mot pour mot ci-dessous (zéro régression).
  if (d.vertical === 'generic') {
    return buildGenericPrompt(d, { agence, ton, langue, contactRef });
  }

  // Bloc DONNÉES curé : uniquement ce qui sert à répondre/comparer.
  // On exclut branding (UI), questions_suggerees (UI), destination_url.
  // Chiffres : remplacés par des repères {{...}} (cf. conciergeTokenMap) car
  // Mistral perd les zeros des nombres. Le modèle recopie le repère, la page
  // le convertit en valeur exacte. ZERO chiffre ne transite par le modèle.
  const { tok, prog: progTok } = conciergeTokenMap(d.configurations, prog);
  const donnees = {
    programme: {
      nom:              prog.nom || '',
      promoteur:        prog.promoteur || '',
      ville:            prog.ville || '',
      adresse:          prog.adresse || '',
      livraison_prevue: progTok.livraison || prog.livraison_prevue || '',
    },
    configurations: (Array.isArray(d.configurations) ? d.configurations : []).map((c, i) => {
      const ann = c?.surfaces_annexes || {};
      const t   = tok[i] || {};
      return {
        reference:     c?.reference || '',
        type:          c?.type || '',
        nb_chambres:   c?.nb_chambres,
        statut:        c?.statut || '',
        // Repères sans chiffre — recopiés tels quels par le modèle, convertis
        // à l'affichage (anti perte-de-zeros Mistral). Cf. conciergeTokenMap.
        surface:       t.surface || 'non communiquée',
        prix:          t.prix    || 'non communiqué',
        jardin:        t.jardin  || 'aucun',
        garage:        ann.garage === true ? 'oui' : (ann.garage === false ? 'non' : 'non précisé'),
        exposition:    c?.exposition || '',
        stationnement: c?.stationnement || '',
        prestations:   Array.isArray(c?.prestations) ? c.prestations : [],
      };
    }),
    faq_validee:    Array.isArray(d.faq_validee) ? d.faq_validee : [],
    contact_humain: { nom: contact.nom || '', tel: contact.tel ? 'affiché en bas de page' : '', email: contact.email || '' },
    disclaimer:     d.disclaimer || '',
  };

  return [
    `Tu es le concierge de ${agence} pour le programme ${progNom}.`,
    'Ce programme propose plusieurs configurations de maisons (voir DONNÉES).',
    'Tu réponds aux questions d\'un visiteur à partir des SEULES informations ci-dessous,',
    'et tu l\'aides à comparer les modèles et à choisir.',
    '',
    'DONNÉES :',
    JSON.stringify(donnees, null, 2),
    '',
    'RÈGLES :',
    '- Réponds uniquement à partir des données fournies.',
    '- Compare les configurations et oriente selon le besoin (taille de famille, budget, exposition…), mais UNIQUEMENT à partir des champs fournis — jamais de justification par une donnée absente.',
    '- Ne propose jamais une configuration dont le statut = vendu.',
    `- Si l'information n'y figure pas : « Je n'ai pas cette information, contactez ${contactRef}. » Ne jamais inventer.`,
    '- Les montants, surfaces ET la date de livraison sont des REPÈRES entre doubles accolades (ex : {{Pa}} pour un prix, {{Sa}} pour une surface, {{Ja}} pour un jardin, {{Liv}} pour la date de livraison du programme). Recopie le repère EXACTEMENT tel quel, sans rien changer, et n\'écris JAMAIS de chiffre ni de date à la place : il est converti automatiquement en valeur exacte. Utilise le repère du bon lot.',
    `- Ne donne JAMAIS de numéro de téléphone toi-même (tu inventerais un faux numéro). Pour appeler ou réserver par téléphone, réponds : « Contactez ${contactRef} — ses coordonnées sont affichées en bas de cette page. »`,
    '- Question contractuelle/juridique : rappelle le disclaimer et renvoie vers l\'interlocuteur de l\'agence.',
    `- Réponses courtes, ton ${ton}, langue ${langue} (ou langue du visiteur si détectée).`,
  ].join('\n');
}

// System prompt GENERIC (S8) — jumeau parallèle de l'immo, cadré « enseigne /
// offres ». DONNÉES curées : intitulé + attributs libres + description + prix
// (numérique EXACT) — c'est le contenu que l'IA doit pouvoir citer. Aucune
// notion de « statut/vendu » ici (les offres n'ont pas d'inventaire). Pur +
// déterministe = testable sans réseau, comme buildConciergePrompt.
function buildGenericPrompt(d, ctx) {
  const { agence, ton, langue, contactRef } = ctx;
  const contact = d.contact_humain || {};

  const prog    = d.programme || {};
  const { tok } = conciergeTokenMap(d.configurations);
  const donnees = {
    enseigne: agence,
    lieu: { ville: prog.ville || '', adresse: prog.adresse || '' },
    offres: (Array.isArray(d.configurations) ? d.configurations : []).map((c, i) => ({
      intitule:    c?.reference || '',
      attributs:   (Array.isArray(c?.attributs) ? c.attributs : [])
        .map((a) => ({ label: a?.label || '', value: a?.value || '' })),
      prix:        (tok[i] || {}).prix || 'non communiqué',
      description: c?.description || '',
    })),
    faq_validee:    Array.isArray(d.faq_validee) ? d.faq_validee : [],
    contact_humain: { nom: contact.nom || '', tel: contact.tel ? 'affiché en bas de page' : '', email: contact.email || '' },
    disclaimer:     d.disclaimer || '',
  };

  return [
    `Tu es le concierge de ${agence}.`,
    'Cette enseigne propose plusieurs offres (voir DONNÉES).',
    'Tu réponds aux questions d\'un visiteur à partir des SEULES informations ci-dessous,',
    'et tu l\'aides à comparer les offres et à choisir celle qui lui convient.',
    '',
    'DONNÉES :',
    JSON.stringify(donnees, null, 2),
    '',
    'RÈGLES :',
    '- Réponds uniquement à partir des données fournies.',
    '- Compare les offres et oriente selon le besoin exprimé, mais UNIQUEMENT à partir des champs fournis (intitulé, attributs, prix, description) — jamais de justification par une donnée absente.',
    '- Si on demande où se situe l\'établissement / l\'adresse / la ville, réponds avec le champ « lieu » (ville et adresse) s\'il est renseigné.',
    `- Si l'information n'y figure pas : « Je n'ai pas cette information, contactez ${contactRef}. » Ne jamais inventer.`,
    '- Les prix sont des REPÈRES entre doubles accolades (ex : {{Pa}}). Recopie le repère EXACTEMENT tel quel, sans rien changer, et n\'écris JAMAIS de chiffre à la place : il est converti automatiquement en prix exact. Utilise le repère de la bonne offre.',
    `- Ne donne JAMAIS de numéro de téléphone toi-même (tu inventerais un faux numéro). Pour appeler ou réserver par téléphone, réponds : « Contactez ${contactRef} — ses coordonnées sont affichées en bas de cette page. »`,
    '- Question contractuelle/juridique : rappelle le disclaimer et renvoie vers l\'interlocuteur de l\'enseigne.',
    `- Réponses courtes, ton ${ton}, langue ${langue} (ou langue du visiteur si détectée).`,
  ].join('\n');
}
