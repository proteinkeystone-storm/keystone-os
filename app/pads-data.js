/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Pads Data Module (canonique embarqué)
   Source de vérité unique pour le mode démo et le fallback offline.
   Synchronisé avec K_STORE_ASSETS/PADS/*.json
   ═══════════════════════════════════════════════════════════════ */

export const PADS_DATA = {

    A1: {
        id: 'O-IMM-001', padKey: 'A1',
        // ── Sprint VEFA-Studio-1 — Pad remplacé par O-IMM-010 (VEFA Studio).
        //    Conservé pour compat utilisateurs ayant déjà acheté/initié des
        //    brouillons. Filtré du dashboard et du K-Store via replacedBy.
        replacedBy: 'O-IMM-010',
        title: 'Notices VEFA',
        subtitle: 'Notice descriptive conforme RE 2020 — 2026',
        ai_optimized: 'Claude', icon: 'vefa',
        notice: `1. Remplissez chaque champ avec précision — les données saisies sont substituées dans le template print-ready.\n2. Le champ "Spécificités & équipements" accepte un appel IA (✦) pour rédiger un paragraphe sur mesure.\n3. Cliquez sur "Notice PDF" : le document s'ouvre dans une nouvelle fenêtre, prêt à imprimer ou exporter en PDF.\n4. Génération 100 % déterministe — clauses techniques canoniques en bibliothèque (admin), aucun LLM dans le rendu juridique.`,
        fields: [
            { id: 'nom_programme', label: 'Nom du programme',           type: 'text',     placeholder: 'ex: Les Jardins du Midi',            required: true, span: 'full' },
            { id: 'type_logement', label: 'Type de logement',           type: 'select',   options: ['T2','T3','T4','T5','Villa','Penthouse'], required: true },
            { id: 'surface',       label: 'Surface habitable (m²)',     type: 'number',   placeholder: 'ex: 75',                              required: true },
            { id: 'etage',         label: 'Étage / Situation',          type: 'text',     placeholder: 'ex: 3ème étage, vue dégagée' },
            { id: 'orientation',   label: 'Orientation principale',     type: 'select',   options: ['Sud','Sud-Est','Sud-Ouest','Est','Ouest','Nord-Est','Nord-Ouest','Nord'] },
            { id: 'sols',          label: 'Revêtements sols',           type: 'select',   options: ['Carrelage grand format','Parquet chêne naturel','Béton ciré','Marbre','Travertin'] },
            { id: 'cuisine',       label: 'Cuisine',                    type: 'select',   options: ['Entièrement équipée','Partiellement équipée (attentes)','Non équipée'] },
            { id: 'chauffage',     label: 'Mode de chauffage',          type: 'select',   options: ['PAC collective','PAC individuelle','Réseau de chaleur urbain (CPCU)','Plancher chauffant électrique','Pompe à chaleur air/air'], required: true },
            { id: 're2020',        label: 'Conformité RE 2020',         type: 'select',   options: ['Seuil 2025 (IC construction ≤ 490 kgCO₂eq/m²)','Seuil 2028 (IC construction ≤ 415 kgCO₂eq/m²)','Seuil 2031 (Objectif bas carbone)'], required: true },
            { id: 'confort_ete',   label: 'Confort d\'été',             type: 'select',   options: ['Brise-soleil orientables (BSO)','Volets roulants motorisés','Double vitrage à contrôle solaire','BSO + Volets motorisés','Sans dispositif spécifique'] },
            { id: 'isolation',     label: 'Type d\'isolation',          type: 'select',   options: ['Biosourcée (laine de bois, chanvre, ouate)','Synthétique (PSE, laine de verre)','Mixte biosourcée + synthétique','ITI béton banché renforcé'] },
            { id: 'annexes',       label: 'Annexes incluses',           type: 'select',   options: ['Cave + Parking standard','Cave + Parking IRVE (borne de recharge)','Parking IRVE seul','Cave seule','Local vélo sécurisé','Aucune annexe'] },
            // ── Sprint 1.2 — champs consommés par DocEngine (notice PDF print-ready).
            // Ne sont PAS référencés dans system_prompt pour ne pas modifier le
            // comportement copie-colle existant. Apparaîtront dans le formulaire
            // et seront utilisés par VEFA Studio v2 (Phase P4).
            { id: 'ville',         label: 'Ville',                      type: 'text',     placeholder: 'ex: Bandol' },
            { id: 'departement',   label: 'Département',                type: 'text',     placeholder: 'ex: Var (83)' },
            { id: 'region',        label: 'Région',                     type: 'select',   options: ['Provence-Alpes-Côte d\'Azur','Occitanie','Nouvelle-Aquitaine','Île-de-France','Auvergne-Rhône-Alpes','Bretagne','Pays de la Loire','Hauts-de-France','Grand Est','Bourgogne-Franche-Comté','Normandie','Centre-Val de Loire','Corse','DOM-TOM'] },
            { id: 'vendeur',       label: 'Vendeur (raison sociale + SIREN)', type: 'text', placeholder: 'ex: SCCV Les Jardins du Midi — SIREN 123 456 789' },
            { id: 'notaire',       label: 'Notaire instrumentaire',     type: 'text',     placeholder: 'ex: Étude Maître Dupont, Toulon' },
            { id: 'permis',        label: 'Permis de construire',       type: 'text',     placeholder: 'ex: PC 083 020 25 H 0042 — délivré le 12/03/2025' },
            { id: 'livraison',     label: 'Date de livraison prévisionnelle', type: 'text', placeholder: 'ex: T4 2027' },
            { id: 'specificites',  label: 'Spécificités & équipements', type: 'textarea', placeholder: 'Terrasse, domotique, VMC double flux, loggia...', span: 'full',
              // Sprint P3 — AI Assist : génère le paragraphe depuis les autres champs
              // du formulaire + les mots-clés saisis ici. cf. ui-renderer._handleAIAssist().
              ai_assist: {
                task: 'redact-section',
                label: 'Générer avec IA',
                topic: 'Les spécificités et équipements d\'un {type_logement} VEFA "{nom_programme}" situé à {ville}',
                include_fields: ['nom_programme', 'type_logement', 'surface', 'etage', 'orientation',
                                 'sols', 'cuisine', 'chauffage', 're2020', 'confort_ete', 'isolation',
                                 'annexes', 'ville', 'departement', 'region', 'livraison'],
              }
            },
        ],
        system_prompt: `Rôle : Designer de documents print et Expert VEFA.
Mission : Générer le code HTML/CSS d'une notice VEFA 2026 formatée pour une impression multi-pages A4.

DONNÉES DU PROGRAMME :
- Programme : {{nom_programme}} | Lot : {{type_logement}} | Surface : {{surface}} m²
- Situation : {{etage}} — Orientation {{orientation}}
- Norme : {{re2020}}
- Énergie : Chauffage décarboné — {{chauffage}}
- Performance : Classe A
- Confort d'été : {{confort_ete}}
- Isolation : {{isolation}}
- Sols : {{sols}}
- Cuisine : {{cuisine}}
- Annexes : {{annexes}}
- Spécificités : {{specificites}}

CONSIGNES DE FORMATAGE "PRINT" :
- Sauts de page : utilise la propriété CSS \`break-before: page;\` sur chaque titre de section (H2) pour forcer le début d'une nouvelle page.
- Format A4 : définis le corps du document à \`width: 210mm;\` avec des marges de 20mm.
- Style moderne : fond blanc, typographie sans-serif (ex : 'Inter' ou 'Helvetica'), et une couleur d'accent (Bleu nuit ou Vert canard) pour les bandeaux de titres.
- Pied de page fixe : ajoute un pied de page sur chaque page avec : "Notice Descriptive Contractuelle - {{nom_programme}} - Page X/N".

CONTENU À RÉDIGER (6 SECTIONS DISTINCTES) :
- Page 1 : Couverture & Synthèse RE 2020 (Inclure les indicateurs IC Construction et Confort d'été DH < 1250h).
- Page 2 : Structure & Enveloppe (Béton bas carbone, isolation biosourcée, menuiseries alu).
- Page 3 : Équipements Techniques (Réseau de chaleur, VMC double-flux, domotique).
- Page 4 : Finitions Intérieures (Carrelage 120x60, Parquet, Peinture lisse).
- Page 5 : Annexes & Mobilité (Parking pré-équipé IRVE, Cave).
- Page 6 : Mentions Légales & Signatures (Garanties et Art. R*261-25).

SORTIE : donne-moi un seul bloc de code HTML (incluant le CSS dans une balise \`<style>\`).

COMMENT GÉRER L'IMPRESSION MULTI-PAGES (instructions à inclure en commentaire HTML en fin de document) :
1. Copiez le code généré.
2. Collez-le dans un éditeur (CodePen ou un fichier .html sur le bureau).
3. Faites Ctrl + P (ou Cmd + P).
4. TRÈS IMPORTANT — dans les paramètres d'impression du navigateur :
   - Activez "Graphiques d'arrière-plan" (pour voir les couleurs et bandeaux).
   - Désactivez "En-têtes et pieds de page" du navigateur (pour ne pas voir l'URL du site en haut de page).
   - Vérifiez que l'échelle est bien à 100 %.`,
        // Sprint C — VEFA Studio v3 : génération PDF directe via DocEngine.
        // Pas d'appel LLM, juste substitution template + clauses partagées.
        // Le bouton "Notice PDF" apparaît à côté de "Générer avec [Moteur]".
        // Variables non mappées (DATE_EDITION, IC_CONSTRUCTION_MAX, REF_DOCUMENT,
        // VERSION_DOC) sont calculées au runtime par _handleDocExport.
        doc_export: {
            templateId: 'vefa-notice-v1',
            label: 'Notice PDF',
            variable_map: {
                PROGRAMME        : 'nom_programme',
                TYPE_LOT         : 'type_logement',
                SURFACE          : 'surface',
                ETAGE            : 'etage',
                ORIENTATION      : 'orientation',
                SOLS             : 'sols',
                CUISINE          : 'cuisine',
                CHAUFFAGE        : 'chauffage',
                CONFORT_ETE      : 'confort_ete',
                ISOLATION        : 'isolation',
                ANNEXES          : 'annexes',
                DEPARTEMENT      : 'departement',
                REGION           : 'region',
                VENDEUR          : 'vendeur',
                NOTAIRE          : 'notaire',
                PERMIS           : 'permis',
                LIVRAISON        : 'livraison',
                SPECIFICITES_BLOC: 'specificites',
            },
        },
    },

    A2: {
        id: 'O-IMM-002', padKey: 'A2',
        title: 'Annonces Immo',
        subtitle: 'SeLoger · LeBonCoin · Bien\'ici · Logic-Immo · Figaro Immo',
        ai_optimized: 'ChatGPT', icon: 'multiportails',
        notice: `1. Renseignez le programme, la ville, le prix et les atouts.\n2. Cochez les portails cibles — l'IA génère une variante par portail respectant titre / description / ton spécifiques.\n3. Le champ "Atouts" accepte un appel IA (✦) pour pré-rédiger un paragraphe.\n4. Le résultat affiche un bloc par portail, prêt à copier-coller dans l'admin du site.`,
        fields: [
            { id: 'nom_programme', label: 'Nom du programme',   type: 'text',   placeholder: 'ex: Résidence Azur', required: true },
            { id: 'ville',         label: 'Ville / Quartier',   type: 'text',   placeholder: 'ex: Marseille 8ème', required: true },
            { id: 'type_bien',     label: 'Type de bien',       type: 'select', options: ['Appartement T2','Appartement T3','Appartement T4','T5 et plus','Villa','Penthouse'] },
            { id: 'surface',       label: 'Surface (m²)',       type: 'number', placeholder: 'ex: 68' },
            { id: 'prix',          label: 'Prix (€)',           type: 'number', placeholder: 'ex: 245000' },
            { id: 'dispositif',    label: 'Dispositif fiscal',  type: 'select', options: ['Aucun','Pinel','Pinel+','LMNP','Déficit foncier','Malraux'] },
            { id: 'ton_global',    label: 'Ton dominant souhaité', type: 'select', options: ['Équilibré (auto-adapté par portail)','Premium / Prestige','Investisseur / ROI','Lifestyle / Émotion','Familial / Primo-accédant'] },
            // Sprint 5 — Multi-select portails cibles. Le LLM reçoit la liste
            // CSV dans {{portails}} et applique les contraintes ci-dessous.
            { id: 'portails',      label: 'Portails cibles',    type: 'multiselect',
              options: ['SeLoger','LeBonCoin','Bien\'ici','Logic-Immo','Figaro Immo','Avendrealouer'],
              default: ['SeLoger','LeBonCoin','Bien\'ici'],
              required: true, span: 'full' },
            { id: 'atouts',        label: 'Atouts & points forts', type: 'textarea', placeholder: 'Vue mer, terrasse, parking, livraison T4 2026...', span: 'full',
              // Phase 3 — Ghost Writer Pad-Aware natif. Unifie l'ancien
              // ai_assist (rédige depuis les autres champs) et la reformulation
              // 3 variantes en un seul bouton intelligent :
              //   - Champ vide → Ghost Writer lit include_fields, construit
              //     un texte source minimal et le réécrit en atouts vendeur.
              //   - Champ rempli → Ghost Writer reformule ce qu'on lui donne.
              // Plus de double bouton qui paralysait l'user.
              ghostwriter: {
                label         : 'Rédiger les atouts avec l\'IA',
                mode          : 'marketing',
                audience      : 'client',
                action        : 'rewrite',
                tone          : 'persuasif vendeur',
                lengthTarget  : 'keep',
                context       : 'Atouts du bien',
                include_fields: ['nom_programme', 'ville', 'type_bien', 'surface', 'prix', 'dispositif'],
              },
            },
        ],
        system_prompt: `Tu es un copywriter expert en immobilier neuf, spécialisé en diffusion multi-portails. Rédige une annonce optimisée pour CHAQUE portail coché dans la liste, en respectant STRICTEMENT ses contraintes propres.

BIEN À DIFFUSER :
- Programme : {{nom_programme}} — {{ville}}
- Type : {{type_bien}} de {{surface}} m² — {{prix}} €
- Dispositif fiscal : {{dispositif}}
- Atouts : {{atouts}}
- Ton dominant souhaité : {{ton_global}}

PORTAILS CIBLES : {{portails}}

CONTRAINTES PAR PORTAIL — à respecter à la lettre :
| Portail        | Titre max | Description max | Ton                | Format       |
|----------------|-----------|------------------|---------------------|--------------|
| SeLoger        | 60 car.   | 4000 car.        | Pro/qualifié        | HTML allégé  |
| LeBonCoin      | 100 car.  | 5000 car.        | Populaire/direct    | Plain text   |
| Bien'ici       | 80 car.   | 3000 car.        | Vert/RE2020 mis en avant | Plain text |
| Logic-Immo     | 70 car.   | 4000 car.        | SEO (mots-clés répétés) | Plain text |
| Figaro Immo    | 60 car.   | 3500 car.        | Premium/luxe        | HTML allégé  |
| Avendrealouer  | 80 car.   | 4000 car.        | Neutre/factuel      | Plain text   |

INSTRUCTIONS :
- Ne génère QUE les blocs des portails effectivement cochés (ignore les autres).
- Si "Ton dominant" est "Équilibré", adapte naturellement le ton à chaque portail.
- Si un autre ton est précisé (Premium, Investisseur, Lifestyle, Familial), garde la cohérence ce ton tout en respectant le format/contrainte du portail.
- Chaque description doit être autonome (lisible sans contexte externe) et inclure 1 call-to-action en fin.
- HTML allégé autorisé = balises <strong>, <em>, <br>, <ul><li> uniquement (jamais <div>, <span>, <style>).

FORMAT DE SORTIE — strictement ce gabarit en markdown :
## [Nom du portail]
**Titre** (X car.) : ...
**Description** (Y car.) :
...

Répète ce bloc pour chaque portail coché. Comptes les caractères réels dans les parenthèses.`,
    },

    // ── Pads A3-A8 retirés le 2026-05-22 (Sprint cleanup-1) ──
    //   6 outils non livrés / abandonnés :
    //     - O-IMM-003 (A3) Emails Acquéreurs
    //     - O-MKT-001 (A4) Posts Réseaux Sociaux
    //     - O-ANL-001 (A5) CR Chantier
    //     - O-ANL-002 (A6) Analyste Foncier
    //     - O-ADM-001 (A7) Objections Acquéreurs
    //     - O-MKT-002 (A8) Brief Photo / 3D
    //   Code retiré pour ne plus exposer de coquilles vides au K-Store.

        // ── Sprint 4 — Contrat de Réservation VEFA (Art. L.261-15 CCH) ──
    // Modèle indicatif à valider par notaire. Bouton "Contrat PDF" via
    // doc_export → template vefa-contrat-v1.html. Pas d'appel LLM par défaut
    // hors AI Assist sur le champ clauses_particulieres.
    A9: {
        id: 'O-IMM-009', padKey: 'A9',
        // ── Sprint VEFA-Studio-1 — Pad remplacé par O-IMM-010 (VEFA Studio).
        //    Conservé pour compat utilisateurs ayant déjà acheté/initié des
        //    brouillons. Filtré du dashboard et du K-Store via replacedBy.
        replacedBy: 'O-IMM-010',
        title: 'Contrat de Réservation VEFA',
        subtitle: 'Contrat préliminaire — Art. L.261-15 CCH',
        ai_optimized: 'Claude', icon: 'vefa',
        notice: `1. Remplissez les sections Vendeur, Acquéreur, Bien et Prix — chaque champ est obligatoire pour un document juridiquement complet.\n2. Le dépôt de garantie est plafonné par la loi : 5 % si livraison < 1 an, 2 % < 2 ans, 0 % au-delà (Art. R.261-28).\n3. Le champ "Clauses particulières" accepte un appel IA (✦) pour rédiger un paragraphe sur mesure depuis vos notes.\n4. Document indicatif : validation notariale impérative avant toute signature.`,
        fields: [
            // ── Identification du bien ──────────────────────────
            { id: 'nom_programme',     label: 'Nom du programme',        type: 'text',   placeholder: 'ex: Les Jardins du Midi', required: true, span: 'full' },
            { id: 'adresse_programme', label: 'Adresse du programme',    type: 'text',   placeholder: 'ex: 12 avenue des Lauriers, 83110 Sanary', span: 'full' },
            { id: 'lot_numero',        label: 'Numéro de lot',           type: 'text',   placeholder: 'ex: A-203', required: true },
            { id: 'type_logement',     label: 'Type de logement',        type: 'select', options: ['T2','T3','T4','T5','Villa','Penthouse'], required: true },
            { id: 'surface',           label: 'Surface habitable (m²)',  type: 'number', placeholder: 'ex: 75', required: true },
            { id: 'surface_carrez',    label: 'Surface Loi Carrez (m²)', type: 'number', placeholder: 'ex: 72.4', required: true },
            { id: 'etage',             label: 'Étage / Situation',       type: 'text',   placeholder: 'ex: 3ème étage' },
            { id: 'orientation',       label: 'Orientation',             type: 'select', options: ['Sud','Sud-Est','Sud-Ouest','Est','Ouest','Nord-Est','Nord-Ouest','Nord'] },
            { id: 'annexes',           label: 'Annexes',                 type: 'text',   placeholder: 'ex: Cave n°14 + Parking IRVE n°22' },
            { id: 'cadastre',          label: 'Référence cadastrale',    type: 'text',   placeholder: 'ex: Section AB n°123' },
            { id: 'quote_parts',       label: 'Quote-parts copropriété', type: 'text',   placeholder: 'ex: 285 / 10 000' },
            { id: 'ville',             label: 'Ville',                   type: 'text',   placeholder: 'ex: Sanary' },
            { id: 'departement',       label: 'Département',             type: 'text',   placeholder: 'ex: Var (83)' },
            { id: 'region',            label: 'Région',                  type: 'select', options: ['Provence-Alpes-Côte d\'Azur','Occitanie','Nouvelle-Aquitaine','Île-de-France','Auvergne-Rhône-Alpes','Bretagne','Pays de la Loire','Hauts-de-France','Grand Est','Bourgogne-Franche-Comté','Normandie','Centre-Val de Loire','Corse','DOM-TOM'] },

            // ── Vendeur (Réservant) ─────────────────────────────
            { id: 'vendeur_nom',          label: 'Vendeur — Raison sociale', type: 'text', placeholder: 'ex: SCCV Les Jardins du Midi', required: true, span: 'full' },
            { id: 'vendeur_siren',        label: 'SIREN',                    type: 'text', placeholder: 'ex: 123 456 789' },
            { id: 'vendeur_rcs',          label: 'RCS',                      type: 'text', placeholder: 'ex: Toulon B 123 456 789' },
            { id: 'vendeur_capital',      label: 'Capital social',           type: 'text', placeholder: 'ex: 1 000 €' },
            { id: 'vendeur_siege',        label: 'Siège social',             type: 'text', placeholder: 'ex: 5 rue Hoche, 83000 Toulon', span: 'full' },
            { id: 'vendeur_representant', label: 'Représenté par',           type: 'text', placeholder: 'ex: M. Jean DUPONT, gérant' },

            // ── Acquéreur (Réservataire) ────────────────────────
            { id: 'acquereur_nom',            label: 'Acquéreur — Nom & prénom', type: 'text', placeholder: 'ex: Mme Sophie MARTIN', required: true, span: 'full' },
            { id: 'acquereur_civilite',       label: 'Civilité / Profession',    type: 'text', placeholder: 'ex: Mme, cadre' },
            { id: 'acquereur_naissance',      label: 'Date de naissance',        type: 'text', placeholder: 'ex: 14/03/1985' },
            { id: 'acquereur_lieu_naissance', label: 'Lieu de naissance',        type: 'text', placeholder: 'ex: Marseille (13)' },
            { id: 'acquereur_adresse',        label: 'Adresse',                  type: 'text', placeholder: 'ex: 22 rue de la République, 13001 Marseille', span: 'full' },
            { id: 'acquereur_regime',         label: 'Régime matrimonial',       type: 'select', options: ['Célibataire','Marié(e) — communauté légale','Marié(e) — séparation de biens','Marié(e) — participation aux acquêts','Pacsé(e) — indivision','Pacsé(e) — séparation','Divorcé(e)','Veuf / Veuve'] },

            // ── Prix & TVA ──────────────────────────────────────
            { id: 'prix_ht',             label: 'Prix HT (€)',         type: 'number', placeholder: 'ex: 233333', required: true },
            { id: 'prix_ttc',            label: 'Prix TTC (€)',        type: 'number', placeholder: 'ex: 280000', required: true },
            { id: 'tva_taux',            label: 'Taux de TVA',         type: 'select', options: ['20 %','5,5 % (zone ANRU / PSLA)','10 %'] },
            { id: 'tva_montant',         label: 'Montant TVA (€)',     type: 'number', placeholder: 'ex: 46667' },
            { id: 'repartition_foncier_bati', label: 'Répartition foncier / bâti', type: 'text', placeholder: 'ex: 25 % foncier — 75 % bâti', span: 'full' },
            // Échéancier (montants TTC à chaque palier R.261-14)
            { id: 'ech_fondations',  label: 'Échéance — Fondations (35 %)', type: 'number', placeholder: 'ex: 98000' },
            { id: 'ech_hors_eau',    label: 'Échéance — Hors d\'eau (70 %)', type: 'number', placeholder: 'ex: 196000' },
            { id: 'ech_achevement',  label: 'Échéance — Achèvement (95 %)', type: 'number', placeholder: 'ex: 266000' },

            // ── Dépôt de garantie ───────────────────────────────
            { id: 'depot_montant',         label: 'Dépôt — Montant (€)',         type: 'number', placeholder: 'ex: 14000', required: true },
            { id: 'depot_montant_lettres', label: 'Dépôt — Montant en lettres',  type: 'text',   placeholder: 'ex: quatorze mille euros' },
            { id: 'depot_pourcentage',     label: 'Dépôt — Pourcentage',         type: 'select', options: ['5 % (livraison < 1 an)','2 % (livraison < 2 ans)','0 % (livraison > 2 ans)'], required: true },
            { id: 'depot_plafond_legal',   label: 'Plafond légal applicable',    type: 'text',   placeholder: 'ex: Art. R.261-28 CCH — 5 % max si livraison < 1 an' },
            { id: 'depot_mode_versement',  label: 'Mode de versement',           type: 'select', options: ['Virement bancaire','Chèque de banque'] },
            { id: 'sequestre_etablissement', label: 'Séquestre — Établissement', type: 'text', placeholder: 'ex: Étude Maître Dupont, Toulon' },
            { id: 'sequestre_compte',      label: 'Séquestre — Référence compte', type: 'text', placeholder: 'ex: Compte CARPA n°...' },

            // ── Conditions suspensives ──────────────────────────
            { id: 'pret_montant',   label: 'Prêt — Montant sollicité (€)',  type: 'number', placeholder: 'ex: 224000' },
            { id: 'pret_taux_max',  label: 'Prêt — Taux maximum (%)',       type: 'number', placeholder: 'ex: 4.5' },
            { id: 'pret_duree_max', label: 'Prêt — Durée maximum (ans)',    type: 'number', placeholder: 'ex: 25' },
            { id: 'pret_delai',     label: 'Prêt — Délai d\'obtention (jours)', type: 'number', placeholder: 'ex: 45' },

            // ── Livraison + signature ──────────────────────────
            { id: 'livraison',              label: 'Date de livraison prévisionnelle', type: 'text', placeholder: 'ex: T4 2027' },
            { id: 'date_acte_authentique',  label: 'Date prévue acte authentique',     type: 'text', placeholder: 'ex: 30/09/2026' },
            { id: 'penalites_retard',       label: 'Pénalités de retard',              type: 'text', placeholder: 'ex: 1/3000ème du prix par jour de retard', span: 'full' },
            { id: 'notaire',                label: 'Notaire instrumentaire',           type: 'text', placeholder: 'ex: Étude Maître Dupont, Toulon', span: 'full' },
            { id: 'lieu_signature',         label: 'Lieu de signature',                type: 'text', placeholder: 'ex: Toulon' },
            { id: 'date_signature',         label: 'Date de signature',                type: 'text', placeholder: 'ex: 11/05/2026' },
            { id: 'nb_exemplaires',         label: 'Nombre d\'exemplaires',            type: 'number', placeholder: 'ex: 3' },

            // ── Clauses particulières (AI Assist) ───────────────
            { id: 'clauses_particulieres', label: 'Clauses particulières & adaptations', type: 'textarea',
              placeholder: 'Modifications spécifiques au cas d\'espèce, options retenues, prestations sur mesure, conditions négociées...', span: 'full',
              ai_assist: {
                task: 'redact-section',
                label: 'Rédiger avec IA',
                topic: 'Les clauses particulières d\'un contrat de réservation VEFA pour le lot {lot_numero} ({type_logement}) du programme "{nom_programme}" entre {vendeur_nom} et {acquereur_nom}',
                include_fields: ['nom_programme','lot_numero','type_logement','surface_carrez',
                                 'vendeur_nom','acquereur_nom','prix_ttc','depot_montant',
                                 'livraison','date_acte_authentique','annexes'],
              }
            },
        ],
        // Pad piloté entièrement par DocEngine — aucun system_prompt
        // (pas de chemin LLM principal). AI Assist scoped sur le champ
        // clauses_particulieres uniquement (rédaction d'un paragraphe).
        //
        // ── Sprint 4.2 — Auto-calculs déclaratifs ─────────────────
        // Le moteur form-computed.js applique chaque règle dès qu'un
        // champ `from` change. Last-write-wins : l'utilisateur peut
        // toujours surcharger une valeur calculée en l'éditant après.
        computed_fields: [
            // ── TVA bidirectionnelle ────────────────────────────
            { to: 'prix_ttc',    recipe: 'tva-multiply', from: ['prix_ht',  'tva_taux'] },
            { to: 'prix_ht',     recipe: 'tva-divide',   from: ['prix_ttc', 'tva_taux'] },
            { to: 'tva_montant', recipe: 'tva-amount',   from: ['prix_ht',  'tva_taux'] },

            // ── Échéancier R.261-14 depuis prix TTC ─────────────
            { to: 'ech_fondations', recipe: 'percent', from: ['prix_ttc'], factor: 0.35 },
            { to: 'ech_hors_eau',   recipe: 'percent', from: ['prix_ttc'], factor: 0.70 },
            { to: 'ech_achevement', recipe: 'percent', from: ['prix_ttc'], factor: 0.95 },

            // ── Dépôt de garantie depuis prix TTC + pourcentage ─
            { to: 'depot_montant', recipe: 'percent-from-select', from: ['prix_ttc', 'depot_pourcentage'] },

            // ── Montant en lettres ──────────────────────────────
            { to: 'depot_montant_lettres', recipe: 'number-to-french-words-eur', from: ['depot_montant'] },
        ],
        doc_export: {
            templateId: 'vefa-contrat-v1',
            label: 'Contrat PDF',
            variable_map: {
                // Identification bien
                PROGRAMME              : 'nom_programme',
                ADRESSE_PROGRAMME      : 'adresse_programme',
                LOT_NUMERO             : 'lot_numero',
                TYPE_LOT               : 'type_logement',
                SURFACE                : 'surface',
                SURFACE_CARREZ         : 'surface_carrez',
                ETAGE                  : 'etage',
                ORIENTATION            : 'orientation',
                ANNEXES                : 'annexes',
                CADASTRE               : 'cadastre',
                QUOTE_PARTS            : 'quote_parts',
                DEPARTEMENT            : 'departement',
                REGION                 : 'region',
                NOTAIRE                : 'notaire',
                LIVRAISON              : 'livraison',
                DATE_ACTE_AUTHENTIQUE  : 'date_acte_authentique',
                // Vendeur
                VENDEUR_NOM            : 'vendeur_nom',
                VENDEUR_SIREN          : 'vendeur_siren',
                VENDEUR_RCS            : 'vendeur_rcs',
                VENDEUR_CAPITAL        : 'vendeur_capital',
                VENDEUR_SIEGE          : 'vendeur_siege',
                VENDEUR_REPRESENTANT   : 'vendeur_representant',
                // Acquéreur
                ACQUEREUR_NOM          : 'acquereur_nom',
                ACQUEREUR_CIVILITE     : 'acquereur_civilite',
                ACQUEREUR_NAISSANCE    : 'acquereur_naissance',
                ACQUEREUR_LIEU_NAISSANCE: 'acquereur_lieu_naissance',
                ACQUEREUR_ADRESSE      : 'acquereur_adresse',
                ACQUEREUR_REGIME       : 'acquereur_regime',
                // Prix
                PRIX_HT                : 'prix_ht',
                PRIX_TTC               : 'prix_ttc',
                TVA_TAUX               : 'tva_taux',
                TVA_MONTANT            : 'tva_montant',
                REPARTITION_FONCIER_BATI: 'repartition_foncier_bati',
                ECH_FONDATIONS         : 'ech_fondations',
                ECH_HORS_EAU           : 'ech_hors_eau',
                ECH_ACHEVEMENT         : 'ech_achevement',
                // Dépôt + séquestre
                DEPOT_MONTANT          : 'depot_montant',
                DEPOT_MONTANT_LETTRES  : 'depot_montant_lettres',
                DEPOT_POURCENTAGE      : 'depot_pourcentage',
                DEPOT_PLAFOND_LEGAL    : 'depot_plafond_legal',
                DEPOT_MODE_VERSEMENT   : 'depot_mode_versement',
                SEQUESTRE_ETABLISSEMENT: 'sequestre_etablissement',
                SEQUESTRE_COMPTE       : 'sequestre_compte',
                // Prêt
                PRET_MONTANT           : 'pret_montant',
                PRET_TAUX_MAX          : 'pret_taux_max',
                PRET_DUREE_MAX         : 'pret_duree_max',
                PRET_DELAI             : 'pret_delai',
                // Livraison + signature
                PENALITES_RETARD       : 'penalites_retard',
                LIEU_SIGNATURE         : 'lieu_signature',
                DATE_SIGNATURE         : 'date_signature',
                NB_EXEMPLAIRES         : 'nb_exemplaires',
                // Bloc libre
                CLAUSES_PARTICULIERES_BLOC: 'clauses_particulieres',
            },
        },
    },
};

// ═══════════════════════════════════════════════════════════════
// CATALOGUE EMBARQUÉ — outils + artefacts (mode démo / fallback)
// ═══════════════════════════════════════════════════════════════
export const CATALOG_DATA = {
    version: '2.0',
    updatedAt: '2026-04-29',
    tools: [
        // ── 8 OUTILS PRINCIPAUX ────────────────────────────────────
        { id:'O-IMM-001', padKey:'A1', title:'Notices VEFA',          subtitle:'Générez vos notices descriptives en 15 sec',     category:'IMM', plan:'STARTER', price:29, lifetimePrice:149, icon:'vefa',    ai_optimized:'Claude',  isNew:false, published:false, replacedBy:'O-IMM-010', timeSaved:25, tags:['immobilier','vefa','notice','juridique','contrat'],
          longDesc:"Générez des notices descriptives VEFA conformes RE 2020 en quelques secondes. L'IA produit un document structuré, prêt à intégrer dans vos contrats. Gagne 45 à 90 minutes par dossier." },
        { id:'O-IMM-002', padKey:'A2', title:'Annonces Immo', subtitle:'SeLoger · LeBonCoin · Bien\'ici · Logic-Immo · Figaro Immo', category:'IMM', plan:'STARTER', price:29, lifetimePrice:149, icon:'multiportails', ai_optimized:'ChatGPT', isNew:true, published:true, timeSaved:30, tags:['immobilier','annonce','seloger','leboncoin','bienici','diffusion','portails','copywriting'],
          longDesc:"Générez vos annonces immobilières pour 6 portails majeurs (SeLoger, LeBonCoin, Bien'ici, Logic-Immo, Figaro Immo, Avendrealouer) en une seule saisie. L'IA produit une variante par portail respectant titre, description et ton spécifiques. Diffusion multi-canal en 2 minutes au lieu de 30." },
        { id:'O-IMM-009', padKey:'A9', title:'Contrat Réservation VEFA', subtitle:'Contrat préliminaire Art. L.261-15 — PDF prêt notaire', category:'IMM', plan:'STARTER', price:29, lifetimePrice:149, icon:'vefa', ai_optimized:'Claude', isNew:false, published:false, replacedBy:'O-IMM-010', timeSaved:30, tags:['immobilier','vefa','contrat','réservation','juridique','notaire'],
          longDesc:"Générez un contrat préliminaire de réservation VEFA conforme aux articles L.261-15 et R.261-25-1 du CCH. Document indicatif à transmettre au notaire pour validation, prêt à signer en 5 minutes. Réutilise les données du programme déjà saisies." },

        // ── ARTEFACTS livrés (workspace fullscreen) ────────────────
        // ── Sprint VEFA-Studio-1 — Fusion Notice + Contrat (O-IMM-001 + O-IMM-009) ──
        { id:'O-IMM-010', padKey:null, title:'VEFA Studio', subtitle:'Notice + Contrat — un seul lot, deux livrables', category:'IMM', plan:'STARTER', price:49, lifetimePrice:199, icon:'vefa', ai_optimized:'Claude', isNew:true, published:true, timeSaved:55, tags:['artefact','immobilier','vefa','notice','contrat','réservation','juridique','notaire','re2020'],
          longDesc:"VEFA Studio fusionne la notice descriptive RE 2020 et le contrat de réservation Art. L.261-15 CCH dans un seul espace de travail. Hero à onglets pill : bascule entre les deux documents sans perdre vos saisies. Le bloc Programme (nom, type, surface, étage, orientation, annexes) est saisi UNE seule fois et alimente les deux livrables. Côté contrat : auto-calculs HT/TTC selon TVA, échéancier R.261-14 (35/70/95 %), dépôt plafonné par la loi, conversion montant en lettres. Génération 100 % déterministe (clauses canoniques en bibliothèque). Document indicatif — validation notariale impérative." },
        // Sprint SDQR-1 — Artefact à workspace fullscreen ──
        { id:'A-COM-001', padKey:null, title:'Smart Dynamic QR', subtitle:'QR codes dynamiques · stats souveraines · RGPD', category:'COM', plan:'PRO', price:49, lifetimePrice:199, icon:'sdqr', ai_optimized:'Claude', isNew:true, published:true, timeSaved:10, tags:['artefact','qr','marketing','tracking','vcard','wifi','sovereign','rgpd'],
          longDesc:"Générez des QR codes statiques (URL, VCard, Wi-Fi, iCal, texte) et dynamiques (URL modifiable après impression). Chaque scan est tracké de façon souveraine — aucune donnée tierce, RGPD natif. Studio de design pour brander vos QRs (Sprint SDQR-3). Dashboard stats (SDQR-4)." },
        // ── Sprint Kodex-1 — Artefact à workspace fullscreen ──
        { id:'A-COM-002', padKey:null, title:'Brief Prod', subtitle:'Le brief print/digital infaillible · calculateur d\'échelle', category:'COM', plan:'STARTER', price:49, lifetimePrice:199, icon:'kodex', ai_optimized:'Claude', isNew:true, published:true, timeSaved:30, tags:['artefact','print','digital','brief','communication','production'],
          longDesc:"Transforme une intention client en cahier des charges technique infaillible. Entonnoir guidé (imprimeur, réseaux sociaux, presse), saisie sectorisée, coffre-fort de vos assets, calculateur d'échelle automatique pour les grands formats (bâche, 4x3). Sortie : un brief PDF prêt à envoyer à votre graphiste ou imprimeur." },
        // ── Sprint Brainstorming V2 — AI War Room (multi-agent) ──
        { id:'A-COM-003', padKey:null, title:'Brainstorming', subtitle:'Votre boardroom IA stratégique · 9 personnalités débattent en direct', category:'COM', plan:'STARTER', price:49, lifetimePrice:199, icon:'muse', ai_optimized:'Claude + Gemma 4', isNew:true, published:true, timeSaved:30, tags:['artefact','strategie','boardroom','multi-agent','synthese-executive','decision','marketing','war-room'],
          longDesc:"Brainstorming AI War Room est un environnement de pensée stratégique multi-agent. Vous entrez un brief, choisissez un mode cognitif (Exploration, Launch, Crisis…) et 9 personnalités IA débattent en direct : Strategic Lead coordonne, Creative Director provoque, Growth Hacker pragmatise, Consumer Psychologist révèle les motivations, Brand Guardian discipline, Cultural Analyst détecte les signaux, Data Analyst valide, Devil's Advocate challenge, Synthesizer conclut. Vous intervenez à la volée (« Plus premium », « Ignore TikTok »). Synthèse exécutive + plan d'actions exportable PDF. Le produit n'est pas la réponse — c'est la réflexion collective." },
        // ── Sprint Pulsa-1 — Artefact à workspace fullscreen ──
        { id:'A-COM-004', padKey:null, title:'Key Form', subtitle:'Le formulaire intelligent · URL partageable · notif direction', category:'COM', plan:'STARTER', price:49, lifetimePrice:199, icon:'pulsa', ai_optimized:'Claude', isNew:true, published:true, timeSaved:20, tags:['artefact','formulaire','questionnaire','diagnostic','onboarding','collecte','communication','pulsa'],
          longDesc:"Key Form transforme votre besoin de collecte d'informations en un formulaire intelligent, prêt à partager. Builder en 4 étapes : structurez vos sections et champs (texte court/long avec compteur strict, chips, tool cards, upload, rank, signature, date, montant, téléphone), personnalisez l'apparence aux couleurs de votre marque, configurez les destinataires direction qui recevront les réponses, puis publiez à une URL partageable type keystone.app/f/votre-slug. Mobile-first, signature anonyme garantie. Cas d'usage : diagnostic opérationnel, audit interne, onboarding fournisseur, candidature artistique, qualification prospect, pré-brief client." },
        // ── Sprint GW-2 — Artefact Ghost Writer (workspace + service système) ──
        { id:'A-COM-005', padKey:null, title:'Ghost Writer', subtitle:'Réécrire vos emails et textes · 3 variantes calibrées · Gemma 4', category:'COM', plan:'STARTER', price:49, lifetimePrice:199, icon:'ghostwriter', ai_optimized:'Gemma 4', isNew:true, published:true, timeSaved:15, tags:['artefact','reecriture','copywriting','email','communication','ghostwriter','gemma'],
          longDesc:"Ghost Writer transforme vos textes (emails clients, communications internes, copy marketing, articles longs) en 3 variantes calibrées. Onglets pré-réglés par contexte d'usage, 5 critères affinables (action, ton, public, intention, longueur). Backend Gemma 4 sur Cloudflare Workers AI — quasi-gratuit, sans clé API à configurer. Bibliothèque persistante de vos 50 dernières réécritures. Service système accessible aussi en raccourci global Cmd+Shift+G partout dans l'OS." },
    ],
};
