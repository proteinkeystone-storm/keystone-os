// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template · concierge · SCHÉMA & CONTRAT (Sprint 5)
// ───────────────────────────────────────────────────────────────────
// LE CONTRAT. Un seul schéma de bloc de connaissance, deux verticaux
// (immo | generic), trois sources de données qui produisent toutes ce
// MÊME bloc via un adaptateur pur :
//   · inlineToBlock      ← éditeur studio SDQR (saisie simple)          [S4]
//   · vefaProgramToBlock ← fenêtre Programme multi-lots de VEFA Studio  [S6]
//   · keyformToBlock     ← gabarit Keyform canonique (générique)        [S7]
//
// renderHTML + buildConciergePrompt (concierge.js) consomment LE BLOC,
// jamais une source directement. Geler ce schéma = découpler les UIs
// (S6/S7) du moteur déjà construit. Pur + déterministe = testable sans
// réseau ni DOM. Cf. BRIEF_CONCIERGE_VEFA.md.
// ══════════════════════════════════════════════════════════════════

// Verticaux supportés. Méta consommée par renderHTML/prompt en S8
// (libellés d'UI + cadrage du system prompt selon le métier).
export const VERTICALS = {
  immo: {
    id:            'immo',
    cards_heading: 'Les modèles du programme',
    subject:       'maisons',
    item_noun:     'configurations',
  },
  generic: {
    id:            'generic',
    cards_heading: 'Nos offres',
    subject:       'offres',
    item_noun:     'offres',
  },
};

const STATUTS = ['disponible', 'optionne', 'vendu'];
export function isValidStatut(s) { return STATUTS.includes(s); }

function asArray(v)  { return Array.isArray(v) ? v : []; }
function asObject(v) { return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}; }
function asString(v) { return v == null ? '' : String(v); }

// Coercition numérique DU CONTRAT : vide/illisible -> undefined (jamais 0).
// JSON.stringify laisse tomber les clés undefined sur le fil -> le moteur
// ne rend ni « 0 ch. » ni NaN, et affiche « Prix sur demande » si absent.
export function numOrUndef(v) {
  if (v === '' || v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// ── Normalisation ────────────────────────────────────────────────
// Garantit la FORME du bloc (types sûrs) sans dénaturer les données.
// Idempotent et non destructif (retourne un nouvel objet). Seul
// validate() + les adaptateurs s'en servent en S5 ; renderHTML/prompt
// lisent encore le template_data brut (vertical-awareness = S8).
export function normalizeBlock(raw) {
  const d = asObject(raw);
  const vertical = d.vertical === 'generic' ? 'generic' : 'immo';
  const prog = asObject(d.programme);
  const b    = asObject(d.branding);
  const c    = asObject(d.contact_humain);
  const p    = asObject(d.persona);

  return {
    vertical,
    qr_id:           asString(d.qr_id),
    destination_url: asString(d.destination_url),
    programme: {
      nom:              asString(prog.nom),
      promoteur:        asString(prog.promoteur),
      ville:            asString(prog.ville),
      livraison_prevue: asString(prog.livraison_prevue),
    },
    configurations: asArray(d.configurations).map(normalizeItem),
    faq_validee: asArray(d.faq_validee)
      .map((x) => ({ q: asString(asObject(x).q), r: asString(asObject(x).r) }))
      .filter((x) => x.q),
    questions_suggerees: asArray(d.questions_suggerees).map(asString).filter(Boolean),
    contact_humain: {
      nom:   asString(c.nom),
      tel:   asString(c.tel),
      email: asString(c.email),
    },
    disclaimer: asString(d.disclaimer),
    persona: {
      ton:               asString(p.ton) || 'professionnel et chaleureux',
      langue_par_defaut: asString(p.langue_par_defaut) || 'fr',
    },
    branding: {
      nom_agence:         asString(b.nom_agence),
      logo_url:           asString(b.logo_url),
      couleur_primaire:   asString(b.couleur_primaire),
      couleur_secondaire: asString(b.couleur_secondaire),
      fond:               asString(b.fond) || 'clair',
    },
  };
}

function normalizeItem(raw) {
  const c     = asObject(raw);
  const annex = asObject(c.surfaces_annexes);
  return {
    // Champs communs / immo
    reference:            asString(c.reference),
    type:                 asString(c.type),
    nb_chambres:          numOrUndef(c.nb_chambres),
    statut:               asString(c.statut),
    surface_habitable_m2: numOrUndef(c.surface_habitable_m2),
    surfaces_annexes: {
      jardin_m2: numOrUndef(annex.jardin_m2),
      garage:    annex.garage === true || annex.garage === 'true',
    },
    exposition:    asString(c.exposition),
    prix_ttc:      numOrUndef(c.prix_ttc),
    stationnement: asString(c.stationnement),
    prestations:   asArray(c.prestations).map(asString).filter(Boolean),
    // Champs génériques (option b : item = nom + 2-3 attributs libres)
    attributs: asArray(c.attributs)
      .map((a) => ({ label: asString(asObject(a).label), value: asString(asObject(a).value) }))
      .filter((a) => a.label || a.value),
    description: asString(c.description),
  };
}

// ── Validation (vertical-aware) ──────────────────────────────────
// Messages immo IDENTIQUES à l'historique (concierge.js) -> zéro
// régression sur le harnais existant. Generic = messages parallèles.
export function validateBlock(rawBlock) {
  const d = normalizeBlock(rawBlock);
  return d.vertical === 'generic' ? validateGeneric(d) : validateImmo(d);
}

function validateImmo(d) {
  const errors = [];
  if (!d.programme.nom.trim()) {
    errors.push('Le nom du programme est obligatoire.');
  }
  if (d.configurations.length === 0) {
    errors.push('Au moins une configuration est obligatoire.');
  } else {
    d.configurations.forEach((c, i) => {
      if (!c.reference.trim()) {
        errors.push(`Configuration #${i + 1} : référence manquante.`);
      }
      if (c.statut && !isValidStatut(c.statut)) {
        errors.push(`Configuration « ${c.reference || (i + 1)} » : statut invalide (disponible | optionne | vendu).`);
      }
    });
  }
  if (!d.branding.nom_agence.trim()) {
    errors.push('Le nom de l\'agence (branding) est obligatoire.');
  }
  return errors;
}

function validateGeneric(d) {
  const errors = [];
  if (!d.branding.nom_agence.trim()) {
    errors.push('Le nom de l\'enseigne (branding) est obligatoire.');
  }
  if (d.configurations.length === 0) {
    errors.push('Au moins une offre est obligatoire.');
  } else {
    d.configurations.forEach((c, i) => {
      if (!c.reference.trim()) {
        errors.push(`Offre #${i + 1} : intitulé manquant.`);
      }
    });
  }
  return errors;
}

// ── Adaptateurs (source -> bloc canonique) ───────────────────────
// Trois sources, un seul bloc. Purs et testables sur des mocks.

// Source 1 — éditeur studio SDQR (S4). La saisie produit déjà le bloc
// immo ; l'adaptateur = garantie de forme.
export function inlineToBlock(templateData) {
  return normalizeBlock(templateData);
}

// Source 2 — fenêtre Programme multi-lots de VEFA Studio (S6).
// Forme « à plat » naturelle de VEFA Studio (un champ simple par lot,
// comme les notices). FIGÉE ici pour que S6 produise exactement ça :
//   program = {
//     nom, promoteur, ville, livraison_prevue,
//     lots: [{ reference, type, nb_chambres, statut, surface_habitable_m2,
//              jardin_m2, garage, exposition, prix_ttc, stationnement, prestations[] }],
//     faq: [{q,r}], questions: [str],
//     contact: {nom,tel,email}, disclaimer,
//     agence: { nom, logo_url, couleur_primaire, couleur_secondaire },
//   }
export function vefaProgramToBlock(program) {
  const p  = asObject(program);
  const ag = asObject(p.agence);
  return normalizeBlock({
    vertical: 'immo',
    programme: {
      nom:              p.nom,
      promoteur:        p.promoteur,
      ville:            p.ville,
      livraison_prevue: p.livraison_prevue,
    },
    configurations: asArray(p.lots).map((l) => {
      const lot = asObject(l);
      return {
        reference:            lot.reference,
        type:                 lot.type,
        nb_chambres:          lot.nb_chambres,
        statut:               lot.statut,
        surface_habitable_m2: lot.surface_habitable_m2,
        surfaces_annexes:     { jardin_m2: lot.jardin_m2, garage: lot.garage },
        exposition:           lot.exposition,
        prix_ttc:             lot.prix_ttc,
        stationnement:        lot.stationnement,
        prestations:          lot.prestations,
      };
    }),
    faq_validee:         p.faq,
    questions_suggerees: p.questions,
    contact_humain:      p.contact,
    disclaimer:          p.disclaimer,
    branding: {
      nom_agence:         ag.nom,
      logo_url:           ag.logo_url,
      couleur_primaire:   ag.couleur_primaire,
      couleur_secondaire: ag.couleur_secondaire,
    },
  });
}

// Glue de SAUVEGARDE (S7) — adaptation source « vefa » -> bloc au save.
// Le front ne peut PAS importer ce module (backend-only) : c'est donc le
// Worker (qr.js) qui reçoit le programme « à plat » de VEFA Studio et en
// dérive le bloc canonique À LA SAUVEGARDE. Centralisé ici (avec
// vefaProgramToBlock + validateBlock) pour rester pur et testable hors
// réseau. Retourne { block } si valide, sinon { error } (1er message).
// Cap 32 KB = même garde-fou anti-abus que template_data côté qr.js.
export const CONCIERGE_BLOCK_MAX_BYTES = 32 * 1024;
export function buildConciergeBlockFromVefa(conciergePayload) {
  if (!conciergePayload || typeof conciergePayload !== 'object' || Array.isArray(conciergePayload)) {
    return { error: 'concierge_payload manquant pour la source VEFA.' };
  }
  const block = vefaProgramToBlock(conciergePayload);
  const errs  = validateBlock(block);
  if (errs.length) return { error: errs[0] };
  if (JSON.stringify(block).length > CONCIERGE_BLOCK_MAX_BYTES) {
    return { error: 'template_data trop volumineux (max 32 KB)' };
  }
  return { block };
}

// Source 3 — gabarit Keyform CANONIQUE (S7). IDs de champs FIGÉS : le
// gabarit S7 DOIT utiliser exactement ces ids pour un mapping fiable.
// Le pro remplit, ajuste libellés/branding, jamais le squelette.
export const KEYFORM_GABARIT_FIELDS = {
  nom_enseigne:       'cg_nom_enseigne',
  titre_offre:        'cg_titre_offre',
  ville:              'cg_ville',
  couleur_primaire:   'cg_couleur_primaire',
  couleur_secondaire: 'cg_couleur_secondaire',
  logo:               'cg_logo',
  items:              'cg_items',                                             // repeater
  item_nom:           'item_nom',
  item_attr_label:    ['item_attr1_label', 'item_attr2_label', 'item_attr3_label'],
  item_attr_value:    ['item_attr1_value', 'item_attr2_value', 'item_attr3_value'],
  item_prix:          'item_prix',
  item_desc:          'item_desc',
  faq:                'cg_faq',                                               // repeater {faq_q, faq_r}
  faq_q:              'faq_q',
  faq_r:              'faq_r',
  questions:          'cg_questions',                                         // repeater {cg_question} ou liste de strings
  question:           'cg_question',
  contact_nom:        'cg_contact_nom',
  contact_tel:        'cg_contact_tel',
  contact_email:      'cg_contact_email',
  disclaimer:         'cg_disclaimer',
};

export function keyformToBlock(submission) {
  const s = asObject(submission);
  const F = KEYFORM_GABARIT_FIELDS;

  const items = asArray(s[F.items]).map((row) => {
    const r = asObject(row);
    const attributs = [];
    for (let i = 0; i < F.item_attr_label.length; i++) {
      const label = asString(r[F.item_attr_label[i]]);
      const value = asString(r[F.item_attr_value[i]]);
      if (label || value) attributs.push({ label, value });
    }
    return {
      reference:   r[F.item_nom],
      attributs,
      prix_ttc:    r[F.item_prix],
      description: r[F.item_desc],
    };
  });

  const faq = asArray(s[F.faq]).map((row) => {
    const r = asObject(row);
    return { q: r[F.faq_q], r: r[F.faq_r] };
  });

  const questions = asArray(s[F.questions]).map((row) => {
    if (typeof row === 'string') return row;
    return asObject(row)[F.question] || '';
  });

  return normalizeBlock({
    vertical:   'generic',
    programme:  { nom: s[F.titre_offre], ville: s[F.ville] },
    configurations:      items,
    faq_validee:         faq,
    questions_suggerees: questions,
    contact_humain: {
      nom:   s[F.contact_nom],
      tel:   s[F.contact_tel],
      email: s[F.contact_email],
    },
    disclaimer: s[F.disclaimer],
    branding: {
      nom_agence:         s[F.nom_enseigne],
      logo_url:           s[F.logo],
      couleur_primaire:   s[F.couleur_primaire],
      couleur_secondaire: s[F.couleur_secondaire],
    },
  });
}

// Glue de SAUVEGARDE (S7.5) — adaptation source « keyform » -> bloc au save.
// Jumelle de buildConciergeBlockFromVefa : le Worker (qr.js) reçoit la
// submission générique à plat (keyée par KEYFORM_GABARIT_FIELDS) que le
// studio SDQR a assemblée, et en dérive le bloc canonique générique À LA
// SAUVEGARDE. Centralisé ici (avec keyformToBlock + validateBlock) pour
// rester pur et testable hors réseau. { block } si valide, sinon { error }
// (1er message). Même cap 32 KB que template_data côté qr.js.
export function buildConciergeBlockFromKeyform(submission) {
  if (!submission || typeof submission !== 'object' || Array.isArray(submission)) {
    return { error: 'concierge_payload manquant pour la source Keyform.' };
  }
  const block = keyformToBlock(submission);
  const errs  = validateBlock(block);
  if (errs.length) return { error: errs[0] };
  if (JSON.stringify(block).length > CONCIERGE_BLOCK_MAX_BYTES) {
    return { error: 'template_data trop volumineux (max 32 KB)' };
  }
  return { block };
}
