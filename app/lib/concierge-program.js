// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Concierge · Fenêtre Programme (VEFA Studio) · Sprint 6
// ───────────────────────────────────────────────────────────────────
// Helpers PURS de la « forme à plat » programme que VEFA Studio saisit
// et envoie au moteur Concierge. SOURCE DE VÉRITÉ UNIQUE de cette forme :
// elle DOIT rester alignée avec vefaProgramToBlock (concierge-schema.js,
// côté Worker) — d'où le test de parité de clés dans test-templates.mjs.
//
// Pur (aucune dépendance DOM/navigateur) => importable côté front
// (vefa-studio.js) ET côté Node (harnais de test). Geler ces fonctions
// découple la saisie (S6) du moteur déjà construit (S5).
//
// La validation MÉTIER complète reste côté moteur (validateBlock) ;
// ici, juste un garde-fou léger avant l'envoi vers Smart Dynamic QR.
// ══════════════════════════════════════════════════════════════════

// Clé localStorage du relais VEFA Studio -> SDQR (consommée en S7 par le
// sélecteur de source). Gelée ici pour que les deux bouts s'accordent.
export const PROGRAM_STORAGE_KEY = 'ks_concierge_source_vefa_v1';

// Statuts d'un lot. Doivent être un sous-ensemble des statuts du contrat
// (isValidStatut) — vérifié par recoupement dans le harnais de test.
export const LOT_STATUTS = ['disponible', 'optionne', 'vendu'];

function str(v) { return v == null ? '' : String(v); }

// Un lot VIDE. Les 11 clés == exactement ce que vefaProgramToBlock lit
// sur chaque lot (reference, type, nb_chambres, statut,
// surface_habitable_m2, jardin_m2, garage, exposition, prix_ttc,
// stationnement, prestations). Numériques en string : la saisie DOM rend
// des strings, le moteur (numOrUndef) coerce. garage en bool, prestations
// en array.
export function blankLot() {
  return {
    reference:            '',
    type:                 '',
    nb_chambres:          '',
    statut:               'disponible',
    surface_habitable_m2: '',
    jardin_m2:            '',
    garage:               false,
    exposition:           '',
    prix_ttc:             '',
    stationnement:        '',
    prestations:          [],
  };
}

// Un programme VIDE. Les 10 clés == exactement ce que vefaProgramToBlock
// lit à plat (nom, promoteur, ville, livraison_prevue, lots, faq,
// questions, contact, disclaimer, agence). Couleurs par défaut = charte
// premium par défaut (modifiable par le pro, branding white-label).
export function blankProgram() {
  return {
    nom:              '',
    promoteur:        '',
    ville:            '',
    livraison_prevue: '',
    lots:             [blankLot()],
    faq:              [],
    questions:        [],
    contact:          { nom: '', tel: '', email: '' },
    disclaimer:       '',
    agence: {
      nom:                '',
      logo_url:           '',
      couleur_primaire:   '#2563eb',
      couleur_secondaire: '#c9a96e',
    },
  };
}

function coerceLot(raw) {
  const l = (raw && typeof raw === 'object') ? raw : {};
  return {
    reference:            str(l.reference),
    type:                 str(l.type),
    nb_chambres:          str(l.nb_chambres),
    statut:               LOT_STATUTS.includes(l.statut) ? l.statut : 'disponible',
    surface_habitable_m2: str(l.surface_habitable_m2),
    jardin_m2:            str(l.jardin_m2),
    garage:               l.garage === true || l.garage === 'true',
    exposition:           str(l.exposition),
    prix_ttc:             str(l.prix_ttc),
    stationnement:        str(l.stationnement),
    prestations:          Array.isArray(l.prestations) ? l.prestations.map(str).filter(Boolean) : [],
  };
}

// Restaure un brouillon programme en GARANTISSANT la forme (types sûrs,
// objets/arrays imbriqués présents, défauts). Idempotent et non
// destructif. Utilisé au chargement du brouillon localStorage.
export function coerceProgram(raw) {
  const p = (raw && typeof raw === 'object') ? raw : {};
  const c = (p.contact && typeof p.contact === 'object') ? p.contact : {};
  const a = (p.agence  && typeof p.agence  === 'object') ? p.agence  : {};
  const lots = Array.isArray(p.lots) && p.lots.length ? p.lots.map(coerceLot) : [blankLot()];
  return {
    nom:              str(p.nom),
    promoteur:        str(p.promoteur),
    ville:            str(p.ville),
    livraison_prevue: str(p.livraison_prevue),
    lots,
    faq: Array.isArray(p.faq)
      ? p.faq.map((x) => ({ q: str(x && x.q), r: str(x && x.r) })).filter((x) => x.q || x.r)
      : [],
    questions: Array.isArray(p.questions) ? p.questions.map(str) : [],
    contact: { nom: str(c.nom), tel: str(c.tel), email: str(c.email) },
    disclaimer: str(p.disclaimer),
    agence: {
      nom:                str(a.nom),
      logo_url:           str(a.logo_url),
      couleur_primaire:   str(a.couleur_primaire)   || '#2563eb',
      couleur_secondaire: str(a.couleur_secondaire) || '#c9a96e',
    },
  };
}

// Garde-fou LÉGER avant l'envoi vers SDQR (≠ validation métier complète,
// faite côté moteur par validateBlock). Juste de quoi éviter d'envoyer un
// programme vide : un nom + au moins un lot avec référence.
export function validateProgramLight(program) {
  const p = (program && typeof program === 'object') ? program : {};
  const errors = [];
  if (!str(p.nom).trim()) {
    errors.push('Le nom du programme est obligatoire.');
  }
  const lots = Array.isArray(p.lots) ? p.lots : [];
  const withRef = lots.filter((l) => l && str(l.reference).trim());
  if (withRef.length === 0) {
    errors.push('Au moins un lot avec une référence est obligatoire.');
  }
  return errors;
}

// Identifiant du template Concierge dans le registre SDQR (./sdqr-templates).
// Gelé ici pour que le miroir ci-dessous et la liste SDQR s'accordent.
export const CONCIERGE_TEMPLATE_ID = 'concierge';

// Miroir « Concierge » (S7) — projection PURE sur la flotte de QR : ne garde
// que les objets QR dont le template est le concierge. Source de vérité du
// filtre, consommée par la liste SDQR (badge) ET la vue filtrée VEFA Studio.
// Pure (aucun DOM/réseau) => testable dans le harnais Node.
export function listConciergeQRs(qrs) {
  return (Array.isArray(qrs) ? qrs : []).filter((q) => q && q.template_id === CONCIERGE_TEMPLATE_ID);
}

// ── Source GÉNÉRIQUE « gabarit » (S7.5) ───────────────────────────
// Saisie directe DANS le studio SDQR (décision Option B 2026-05-30) — pas
// le builder Key Form, pas le formulaire Biennale live. Le studio assemble
// une SUBMISSION à plat keyée par les ids FIGÉS de KEYFORM_GABARIT_FIELDS
// (concierge-schema.js), que le Worker passe à keyformToBlock au save.
// Ces helpers sont la forme front de cette submission ; un test de PARITÉ
// (blankKeyform/blankKeyformItem ⇄ KEYFORM_GABARIT_FIELDS) casse avant toute
// dérive silencieuse — comme la parité des clés lot en S6 (VEFA).
// Numériques (item_prix) en string : la saisie DOM rend des strings, le
// moteur (numOrUndef) coerce. Couleurs par défaut = charte premium.

export function blankKeyformItem() {
  return {
    item_nom:         '',
    item_attr1_label: '', item_attr1_value: '',
    item_attr2_label: '', item_attr2_value: '',
    item_attr3_label: '', item_attr3_value: '',
    item_prix:        '',
    item_desc:        '',
  };
}

export function blankKeyform() {
  return {
    cg_nom_enseigne:       '',
    cg_titre_offre:        '',
    cg_ville:              '',
    cg_couleur_primaire:   '#2563eb',
    cg_couleur_secondaire: '#c9a96e',
    cg_logo:               '',
    cg_items:              [blankKeyformItem()],
    cg_faq:                [],
    cg_questions:          [],
    cg_contact_nom:        '',
    cg_contact_tel:        '',
    cg_contact_email:      '',
    cg_disclaimer:         '',
  };
}

function coerceKeyformItem(raw) {
  const r = (raw && typeof raw === 'object') ? raw : {};
  return {
    item_nom:         str(r.item_nom),
    item_attr1_label: str(r.item_attr1_label), item_attr1_value: str(r.item_attr1_value),
    item_attr2_label: str(r.item_attr2_label), item_attr2_value: str(r.item_attr2_value),
    item_attr3_label: str(r.item_attr3_label), item_attr3_value: str(r.item_attr3_value),
    item_prix:        str(r.item_prix),
    item_desc:        str(r.item_desc),
  };
}

// Restaure une submission générique en GARANTISSANT la forme (types sûrs,
// items/faq/questions présents, défauts). Idempotent et non destructif.
// Questions normalisées en strings (keyformToBlock accepte string ou
// { cg_question }) ; faq filtrée si q ET r vides.
export function coerceKeyform(raw) {
  const s = (raw && typeof raw === 'object') ? raw : {};
  const items = Array.isArray(s.cg_items) && s.cg_items.length ? s.cg_items.map(coerceKeyformItem) : [blankKeyformItem()];
  const faq = Array.isArray(s.cg_faq)
    ? s.cg_faq.map((x) => ({ faq_q: str(x && x.faq_q), faq_r: str(x && x.faq_r) })).filter((x) => x.faq_q || x.faq_r)
    : [];
  const questions = Array.isArray(s.cg_questions)
    ? s.cg_questions.map((x) => (typeof x === 'string' ? x : str(x && x.cg_question))).filter(Boolean)
    : [];
  return {
    cg_nom_enseigne:       str(s.cg_nom_enseigne),
    cg_titre_offre:        str(s.cg_titre_offre),
    cg_ville:              str(s.cg_ville),
    cg_couleur_primaire:   str(s.cg_couleur_primaire)   || '#2563eb',
    cg_couleur_secondaire: str(s.cg_couleur_secondaire) || '#c9a96e',
    cg_logo:               str(s.cg_logo),
    cg_items:              items,
    cg_faq:                faq,
    cg_questions:          questions,
    cg_contact_nom:        str(s.cg_contact_nom),
    cg_contact_tel:        str(s.cg_contact_tel),
    cg_contact_email:      str(s.cg_contact_email),
    cg_disclaimer:         str(s.cg_disclaimer),
  };
}

// Garde-fou LÉGER avant l'envoi (≠ validateBlock generic côté moteur, qui
// fait foi). Juste de quoi éviter d'envoyer un gabarit vide : une enseigne
// + au moins une offre avec un intitulé.
export function validateKeyformLight(submission) {
  const s = (submission && typeof submission === 'object') ? submission : {};
  const errors = [];
  if (!str(s.cg_nom_enseigne).trim()) {
    errors.push('Le nom de l\'enseigne est obligatoire.');
  }
  const items = Array.isArray(s.cg_items) ? s.cg_items : [];
  const withNom = items.filter((it) => it && str(it.item_nom).trim());
  if (withNom.length === 0) {
    errors.push('Au moins une offre avec un intitulé est obligatoire.');
  }
  return errors;
}
