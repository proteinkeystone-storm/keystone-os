/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Pads Data Module (canonique embarqué)
   Source de vérité unique pour le mode démo et le fallback offline.
   Synchronisé avec K_STORE_ASSETS/PADS/*.json
   ═══════════════════════════════════════════════════════════════ */

export const PADS_DATA = {

    A1: {
        id: 'O-IMM-001', padKey: 'A1',
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
        title: 'Annonces Multi-Portails',
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
              ai_assist: {
                task: 'redact-section',
                label: 'Polir les atouts',
                topic: 'Les atouts et points forts d\'un {type_bien} neuf VEFA "{nom_programme}" à {ville}',
                include_fields: ['nom_programme', 'ville', 'type_bien', 'surface', 'prix', 'dispositif'],
              }
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

    A3: {
        id: 'O-IMM-003', padKey: 'A3',
        title: 'Emails Acquéreurs',
        subtitle: 'Communication chantier personnalisée',
        ai_optimized: 'Claude', icon: 'mail',
        notice: `1. Le prénom du client est important — l'IA l'utilisera pour personnaliser le ton.\n2. Soyez précis dans "Informations à transmettre" : montants, dates, pièces demandées.\n3. Vous obtiendrez 2 variantes : formelle et chaleureuse. Choisissez selon le profil client.\n4. Après génération, relisez et ajoutez les éléments contractuels spécifiques à votre dossier.`,
        fields: [
            { id: 'nom_client',     label: 'Prénom du client',        type: 'text',   placeholder: 'ex: Marie', required: true },
            { id: 'nom_programme',  label: 'Programme',               type: 'text',   placeholder: 'ex: Les Jardins du Midi', required: true },
            { id: 'type_info',      label: 'Objet de l\'email',       type: 'select', options: ['Avancement chantier','Date de livraison confirmée','Visite cloisons','Demande pièces','Appel de fonds','Remise clés','Relance sans réponse'], required: true },
            { id: 'date_evenement', label: 'Date / Échéance',         type: 'text',   placeholder: 'ex: 15 mai 2026' },
            { id: 'infos_chantier', label: 'Informations à transmettre', type: 'textarea', placeholder: 'Détails, avancement %, montant, pièces demandées...', span: 'full',
              ai_assist: {
                task: 'redact-section',
                label: 'Formuler proprement',
                topic: 'Les informations à transmettre à {nom_client} concernant "{type_info}" pour le programme "{nom_programme}", échéance {date_evenement}',
                include_fields: ['nom_client', 'nom_programme', 'type_info', 'date_evenement'],
              }
            },
        ],
        system_prompt: `Tu es un conseiller clientèle expert en promotion immobilière.

Email pour :
- Client : {{nom_client}}
- Programme : {{nom_programme}}
- Objet : {{type_info}}
- Date / Échéance : {{date_evenement}}
- Informations : {{infos_chantier}}

Produis 2 variantes :
1. FORMELLE — ton corporate, structuré
2. CHALEUREUSE — ton humain, empathique

Chaque email : introduction personnalisée, corps structuré, clôture soignée.`,
    },

    A4: {
        id: 'O-MKT-001', padKey: 'A4',
        title: 'Posts Réseaux Sociaux',
        subtitle: 'Facebook · Instagram · LinkedIn',
        ai_optimized: 'Gemini', icon: 'social',
        notice: `1. Sélectionnez "Les 3 réseaux" pour obtenir une version adaptée à chaque plateforme.\n2. Décrivez le visuel avec précision — l'IA adapte le texte à l'image suggérée.\n3. Gemini est recommandé pour ce type de contenu créatif multiplateforme.\n4. Fréquence conseillée : 2-3 posts/semaine. Sauvegardez en bibliothèque pour créer votre calendrier éditorial.`,
        fields: [
            { id: 'nom_programme', label: 'Programme',          type: 'text',   placeholder: 'ex: Résidence Azur', required: true },
            { id: 'reseau',        label: 'Réseau(x) cible(s)', type: 'select', options: ['Facebook uniquement','Instagram uniquement','LinkedIn uniquement','Facebook + Instagram','Les 3 réseaux'], required: true },
            { id: 'type_post',     label: 'Type de contenu',    type: 'select', options: ['Lancement programme','Avancement chantier','Témoignage client','Conseil investissement','Portes ouvertes','Livraison / Remise clés'] },
            { id: 'ton',           label: 'Ton / Ambiance',     type: 'select', options: ['Professionnel & Expert','Humain & Proche','Inspirant & Premium','Éducatif & Pédagogique'] },
            { id: 'visuel',        label: 'Description du visuel', type: 'text', placeholder: 'ex: Vue terrasse avec mer en fond' },
            { id: 'accroche',      label: 'Message clé & infos', type: 'textarea', placeholder: 'Chiffres, date, prix, avancement...', span: 'full',
              ai_assist: {
                task: 'redact-section',
                label: 'Polir le message clé',
                topic: 'Le message clé et les informations à mettre en avant pour un post {type_post} sur {reseau} concernant "{nom_programme}", ton {ton}',
                include_fields: ['nom_programme', 'reseau', 'type_post', 'ton', 'visuel'],
              }
            },
        ],
        system_prompt: `Tu es un expert en marketing digital immobilier et social media.

Posts pour :
- Programme : {{nom_programme}}
- Réseau(x) : {{reseau}}
- Contenu : {{type_post}}
- Ton : {{ton}}
- Visuel : {{visuel}}
- Message clé : {{accroche}}

Pour chaque réseau : post adapté + hashtags (5-15) + suggestion emoji + variante story.`,
    },

    A5: {
        id: 'O-ANL-001', padKey: 'A5',
        title: 'CR Chantier',
        subtitle: 'Notes terrain → CR professionnel',
        ai_optimized: 'Claude', icon: 'site',
        notice: `1. Collez vos notes brutes telles quelles — abréviations, fautes, raccourcis acceptés.\n2. Plus vos notes sont détaillées, plus le CR sera précis et exploitable.\n3. Le CR généré inclut un tableau d'actions avec responsables et délais.\n4. Après génération, complétez le tableau des actions et envoyez directement depuis votre messagerie.`,
        fields: [
            { id: 'nom_programme',  label: 'Programme',           type: 'text',   placeholder: 'ex: Résidence Azur', required: true },
            { id: 'date_visite',    label: 'Date de visite',      type: 'text',   placeholder: 'ex: 23 Avril 2026', required: true },
            { id: 'stade_chantier', label: 'Stade du chantier',   type: 'select', options: ['Terrassement','Fondations','Structure béton','Maçonnerie','Cloisons','Second œuvre','Finitions','Livraison imminente'] },
            { id: 'participants',   label: 'Participants présents',type: 'text',   placeholder: 'ex: Conducteur travaux, Architecte' },
            { id: 'notes_brutes',   label: 'Notes terrain brutes', type: 'textarea', placeholder: 'Collez ici vos notes, même non structurées...', span: 'full', required: true },
        ],
        system_prompt: `Tu es un conducteur de travaux senior. Transforme ces notes en CR de visite chantier professionnel.

Contexte :
- Programme : {{nom_programme}} — {{date_visite}}
- Stade : {{stade_chantier}}
- Participants : {{participants}}

Notes brutes :
{{notes_brutes}}

Structure le CR : En-tête → Avancement (%) → Points positifs → Réserves → Actions (tableau ACTION | RESPONSABLE | DÉLAI) → Prochaine réunion.`,
    },

    A6: {
        id: 'O-ANL-002', padKey: 'A6',
        title: 'Analyste Foncier',
        subtitle: 'Dossier foncier complet en 5 minutes',
        ai_optimized: 'Claude', icon: 'foncier',
        notice: `1. Vérifiez le zonage PLU avant toute analyse — c'est le point bloquant n°1.\n2. Renseignez le prix même approximatif : l'analyse de charge foncière est la plus-value principale.\n3. L'IA produit une recommandation GO/NO-GO — à compléter avec votre expertise terrain.\n4. Utilisez le résultat comme base de note interne ou de présentation aux associés.`,
        fields: [
            { id: 'commune',        label: 'Commune / Secteur',        type: 'text',   placeholder: 'ex: Ollioules, Var (83)', required: true },
            { id: 'surface_terrain',label: 'Surface terrain (m²)',     type: 'number', placeholder: 'ex: 1500', required: true },
            { id: 'plu',            label: 'Zone PLU',                 type: 'select', options: ['UA (Centre-ville)','UB (Pavillonnaire)','UC (Résidentiel)','UD (Mixte)','AU (À urbaniser)','N (Naturelle)','A (Agricole)','Inconnue'] },
            { id: 'prix_foncier',   label: 'Prix du terrain (€)',      type: 'number', placeholder: 'ex: 350000' },
            { id: 'ces',            label: 'CES / Gabarit connu',      type: 'text',   placeholder: 'ex: CES 0.5, R+3 max, recul 5m' },
            { id: 'contexte',       label: 'Contexte & Observations',  type: 'textarea', placeholder: 'Environnement, servitudes, risques, accès...', span: 'full',
              ai_assist: {
                task: 'redact-section',
                label: 'Structurer les observations',
                topic: 'Le contexte et les observations terrain pour un foncier à {commune}, zone PLU {plu}, surface {surface_terrain} m²',
                include_fields: ['commune', 'surface_terrain', 'plu', 'prix_foncier', 'ces'],
              }
            },
        ],
        system_prompt: `Tu es un analyste foncier expert en promotion immobilière dans le Sud de la France.

Foncier :
- Commune : {{commune}}
- Surface : {{surface_terrain}} m²
- Zone PLU : {{plu}}
- Prix : {{prix_foncier}} €
- Gabarit : {{ces}}
- Contexte : {{contexte}}

Analyse : 1) Potentiel constructible estimé 2) Faisabilité réglementaire 3) Analyse financière (charge foncière / m² SHAB) 4) Risques identifiés 5) Recommandation GO / NO-GO argumentée.`,
    },

    A7: {
        id: 'O-ADM-001', padKey: 'A7',
        title: 'Objections Acquéreurs',
        subtitle: '3 réponses graduées par objection',
        ai_optimized: 'Claude', icon: 'chat',
        notice: `1. Citez l'objection mot pour mot, telle qu'elle a été formulée par le client.\n2. Le profil de l'acquéreur influence fortement le ton des réponses — renseignez-le.\n3. Vous obtenez 3 réponses (Douce, Argumentée, Engageante) — adaptez selon l'atmosphère du rendez-vous.\n4. Entraînez-vous à l'oral avant le prochain contact client pour gagner en fluidité.`,
        fields: [
            { id: 'nom_programme',    label: 'Programme concerné',    type: 'text',   placeholder: 'ex: Résidence Azur' },
            { id: 'type_bien',        label: 'Type de bien',          type: 'text',   placeholder: 'ex: T3 de 72m², 2ème étage' },
            { id: 'profil_acquereur', label: 'Profil de l\'acquéreur',type: 'select', options: ['Primo-accédant','Investisseur Pinel','Investisseur LMNP','Résidence principale','Résidence secondaire','Retraité / Senior'] },
            { id: 'objection',        label: 'Objection formulée',    type: 'textarea', placeholder: 'ex: "C\'est trop cher pour un bien que je ne vois pas encore..."', span: 'full', required: true },
        ],
        system_prompt: `Tu es un négociateur immobilier senior expert en traitement des objections.

Contexte :
- Programme : {{nom_programme}} — {{type_bien}}
- Profil : {{profil_acquereur}}
- Objection : "{{objection}}"

3 réponses graduées :
1. DOUCE 🌿 — Empathique, valide le ressenti, reformulation positive
2. ARGUMENTÉE 📊 — Données chiffrées, comparatifs, garanties VEFA
3. ENGAGEANTE 🎯 — Technique de closing, proposition d'étape concrète

Chaque réponse : naturelle, orale, adaptée au profil, actionnable en rendez-vous.`,
    },

    A8: {
        id: 'O-MKT-002', padKey: 'A8',
        title: 'Brief Photo / 3D',
        subtitle: 'Brief créatif professionnel en 2 min',
        ai_optimized: 'ChatGPT', icon: 'brief',
        notice: `1. Choisissez "Pack complet" pour obtenir un brief exhaustif transmissible directement au prestataire.\n2. Décrivez précisément la direction artistique souhaitée — c'est ce qui évite les allers-retours.\n3. Le brief inclut un planning de production suggéré à valider avec votre prestataire.\n4. Sauvegardez en bibliothèque pour constituer votre référentiel de briefs par programme.`,
        fields: [
            { id: 'nom_programme', label: 'Programme',              type: 'text',   placeholder: 'ex: Résidence Azur', required: true },
            { id: 'type_support',  label: 'Type de support',        type: 'select', options: ['Photographies réelles','Images 3D / Rendu','Vidéo promotionnelle','Visite virtuelle 360°','Drone / Aérien','Pack complet'], required: true },
            { id: 'stade',         label: 'Stade du projet',        type: 'select', options: ['Terrain seul','Permis obtenu (plans)','Chantier en cours','Livraison imminente','Livré'] },
            { id: 'ambiance',      label: 'Direction artistique',   type: 'select', options: ['Luxe & Prestige','Moderne & Épuré','Méditerranéen & Chaleureux','Éco & Nature','Urbain & Dynamique'] },
            { id: 'cible',         label: 'Usage & Diffusion',      type: 'text',   placeholder: 'ex: Plaquette, réseaux sociaux, site web' },
            { id: 'sujets',        label: 'Priorités & Contraintes',type: 'textarea', placeholder: 'Vues à valoriser, budget, délais, formats...', span: 'full',
              ai_assist: {
                task: 'redact-section',
                label: 'Structurer le brief',
                topic: 'Les priorités et contraintes pour un brief {type_support} sur "{nom_programme}", direction artistique {ambiance}, stade {stade}',
                include_fields: ['nom_programme', 'type_support', 'stade', 'ambiance', 'cible'],
              }
            },
        ],
        system_prompt: `Tu es un directeur artistique expert en communication immobilière neuf.

Brief pour :
- Programme : {{nom_programme}}
- Support : {{type_support}}
- Stade : {{stade}}
- Direction artistique : {{ambiance}}
- Usage : {{cible}}
- Priorités : {{sujets}}

Le brief inclut : 1) Direction artistique (palette, ambiance, références) 2) Liste des prises de vues / angles (numérotés) 3) Consignes lumière 4) Livrables (formats, résolutions, délais) 5) 3 références visuelles décrites 6) Planning de production suggéré.`,
    },

    // ── Sprint 4 — Contrat de Réservation VEFA (Art. L.261-15 CCH) ──
    // Modèle indicatif à valider par notaire. Bouton "Contrat PDF" via
    // doc_export → template vefa-contrat-v1.html. Pas d'appel LLM par défaut
    // hors AI Assist sur le champ clauses_particulieres.
    A9: {
        id: 'O-IMM-009', padKey: 'A9',
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
        { id:'O-IMM-001', padKey:'A1', title:'Notices VEFA',          subtitle:'Générez vos notices descriptives en 15 sec',     category:'IMM', plan:'STARTER', price:29, lifetimePrice:149, icon:'vefa',    ai_optimized:'Claude',  isNew:false, published:true, timeSaved:25, tags:['immobilier','vefa','notice','juridique','contrat'],
          longDesc:"Générez des notices descriptives VEFA conformes RE 2020 en quelques secondes. L'IA produit un document structuré, prêt à intégrer dans vos contrats. Gagne 45 à 90 minutes par dossier." },
        { id:'O-IMM-002', padKey:'A2', title:'Annonces Multi-Portails', subtitle:'SeLoger · LeBonCoin · Bien\'ici · Logic-Immo · Figaro Immo', category:'IMM', plan:'STARTER', price:29, lifetimePrice:149, icon:'multiportails', ai_optimized:'ChatGPT', isNew:true, published:true, timeSaved:30, tags:['immobilier','annonce','seloger','leboncoin','bienici','diffusion','portails','copywriting'],
          longDesc:"Générez vos annonces immobilières pour 6 portails majeurs (SeLoger, LeBonCoin, Bien'ici, Logic-Immo, Figaro Immo, Avendrealouer) en une seule saisie. L'IA produit une variante par portail respectant titre, description et ton spécifiques. Diffusion multi-canal en 2 minutes au lieu de 30." },
        { id:'O-IMM-003', padKey:'A3', title:'Emails Acquéreurs',     subtitle:'Communication chantier personnalisée',           category:'IMM', plan:'STARTER', price:29, lifetimePrice:149, icon:'mail',    ai_optimized:'Claude',  isNew:false, published:true, timeSaved:20, tags:['immobilier','email','chantier','acquéreur','suivi'],
          longDesc:"Générez des emails de suivi chantier professionnels et rassurants. L'IA adapte le contenu à l'avancement réel et au profil acquéreur. Réduit les appels entrants de 30 %." },
        { id:'O-MKT-001', padKey:'A4', title:'Posts Réseaux Sociaux', subtitle:'Facebook · Instagram · LinkedIn',                category:'COM', plan:'STARTER', price:29, lifetimePrice:149, icon:'social',  ai_optimized:'Gemini',  isNew:false, published:true, timeSaved:25, tags:['marketing','réseaux sociaux','facebook','instagram','linkedin'],
          longDesc:"Posts engageants pour vos réseaux sociaux : choisissez réseau, ton et objectif. L'IA adapte format, hashtags et CTA selon la plateforme." },
        { id:'O-MKT-002', padKey:'A8', title:'Brief Photo / 3D',      subtitle:'Brief créatif professionnel en 2 minutes',       category:'PRD', plan:'STARTER', price:29, lifetimePrice:149, icon:'brief',   ai_optimized:'ChatGPT', isNew:false, published:true, timeSaved:15, tags:['marketing','photo','3D','brief','créatif'],
          longDesc:"Briefs créatifs détaillés pour vos prestataires photo et 3D. L'IA structure angles, ambiance et livrables. Évite les allers-retours." },
        { id:'O-ANL-001', padKey:'A5', title:'CR Chantier',           subtitle:'Notes terrain → CR professionnel',               category:'IMM', plan:'PRO',     price:49, lifetimePrice:149, icon:'site',    ai_optimized:'Claude',  isNew:false, published:true, timeSaved:35, tags:['analyse','chantier','cr','réserves','suivi travaux'],
          longDesc:"Transformez vos notes brutes en comptes-rendus structurés. L'IA organise réserves, points d'attention, actions et délais." },
        { id:'O-ANL-002', padKey:'A6', title:'Analyste Foncier',      subtitle:'Dossier foncier complet en 5 minutes',           category:'IMM', plan:'PRO',     price:49, lifetimePrice:149, icon:'foncier', ai_optimized:'Claude',  isNew:true,  published:true, timeSaved:40, tags:['analyse','foncier','urbanisme','bilan','faisabilité'],
          longDesc:"Analyse de terrain : faisabilité réglementaire, potentiel constructible, bilan prévisionnel et risques. Présentable en comité d'engagement." },
        { id:'O-ADM-001', padKey:'A7', title:'Objections Acquéreurs', subtitle:'3 réponses graduées par objection',              category:'IMM', plan:'PRO',     price:39, lifetimePrice:149, icon:'chat',    ai_optimized:'Claude',  isNew:false, published:true, timeSaved:15, tags:['admin','commercial','objection','vente','argumentation'],
          longDesc:"Réponses calibrées aux objections fréquentes : prix, délais, charges, emplacement. 3 niveaux : douce, affirmée, closing." },
        { id:'O-IMM-009', padKey:'A9', title:'Contrat Réservation VEFA', subtitle:'Contrat préliminaire Art. L.261-15 — PDF prêt notaire', category:'IMM', plan:'STARTER', price:29, lifetimePrice:149, icon:'vefa', ai_optimized:'Claude', isNew:true, published:true, timeSaved:30, tags:['immobilier','vefa','contrat','réservation','juridique','notaire'],
          longDesc:"Générez un contrat préliminaire de réservation VEFA conforme aux articles L.261-15 et R.261-25-1 du CCH. Document indicatif à transmettre au notaire pour validation, prêt à signer en 5 minutes. Réutilise les données du programme déjà saisies." },

        // ── ARTEFACTS livrés (workspace fullscreen) ────────────────
        // Sprint SDQR-1 — Artefact à workspace fullscreen ──
        { id:'A-COM-001', padKey:null, title:'Sovereign Dynamic QR', subtitle:'QR codes dynamiques · stats souveraines · RGPD', category:'COM', plan:'PRO', price:49, lifetimePrice:199, icon:'sdqr', ai_optimized:'Claude', isNew:true, published:true, timeSaved:10, tags:['artefact','qr','marketing','tracking','vcard','wifi','sovereign','rgpd'],
          longDesc:"Générez des QR codes statiques (URL, VCard, Wi-Fi, iCal, texte) et dynamiques (URL modifiable après impression). Chaque scan est tracké de façon souveraine — aucune donnée tierce, RGPD natif. Studio de design pour brander vos QRs (Sprint SDQR-3). Dashboard stats (SDQR-4)." },
        // ── Sprint Kodex-1 — Artefact à workspace fullscreen ──
        { id:'A-COM-002', padKey:null, title:'Kodex', subtitle:'Le brief print/digital infaillible · calculateur d\'échelle', category:'COM', plan:'STARTER', price:49, lifetimePrice:199, icon:'kodex', ai_optimized:'Claude', isNew:true, published:true, timeSaved:30, tags:['artefact','print','digital','brief','communication','production'],
          longDesc:"Transforme une intention client en cahier des charges technique infaillible. Entonnoir guidé (imprimeur, réseaux sociaux, presse), saisie sectorisée, coffre-fort de vos assets, calculateur d'échelle automatique pour les grands formats (bâche, 4x3). Sortie : un brief PDF prêt à envoyer à votre graphiste ou imprimeur." },
        // ── Sprint Muse-1 — Artefact à workspace fullscreen ──
        { id:'A-COM-003', padKey:null, title:'Muse', subtitle:'La planche d\'ambiance pour votre studio 3D · 1 prompt → 1 moodboard complet', category:'COM', plan:'STARTER', price:49, lifetimePrice:199, icon:'muse', ai_optimized:'Claude', isNew:true, published:true, timeSaved:25, tags:['artefact','moodboard','planche-ambiance','studio-3d','illustration-immobiliere','midjourney','flux','muse'],
          longDesc:"Muse prépare la planche d'ambiance à transmettre à votre studio 3D spécialisé en illustration immobilière. Configurez cadrage (drone, piéton, intérieur, terrasse), atmosphère (lumière, saison, palette végétale, figuration, matériaux) et moteur d'image cible (Midjourney v8.1, Flux, DALL-E, Gemini Imagen). Muse assemble un Prompt Maître structuré à coller dans votre IA ; en retour, un fichier HTML avec un bouton \"Copier\" unique qui produit, en une seule génération, une planche moodboard professionnelle de 6 vignettes cohérentes (architecture · lumière · palette végétale · matériaux · lifestyle · détail signature). Pratique standard des studios 3D : une planche cohérente vaut mieux que quatre images éparses." },
        // ── Sprint Pulsa-1 — Artefact à workspace fullscreen ──
        { id:'A-COM-004', padKey:null, title:'Pulsa', subtitle:'Le formulaire intelligent · URL partageable · notif direction', category:'COM', plan:'STARTER', price:49, lifetimePrice:199, icon:'pulsa', ai_optimized:'Claude', isNew:true, published:true, timeSaved:20, tags:['artefact','formulaire','questionnaire','diagnostic','onboarding','collecte','communication','pulsa'],
          longDesc:"Pulsa transforme votre besoin de collecte d'informations en un formulaire intelligent, prêt à partager. Builder en 4 étapes : structurez vos sections et champs (texte court/long avec compteur strict, chips, tool cards, upload, rank, signature, date, montant, téléphone), personnalisez l'apparence aux couleurs de votre marque, configurez les destinataires direction qui recevront les réponses, puis publiez à une URL partageable type keystone.app/f/votre-slug. Mobile-first, signature anonyme garantie. Cas d'usage : diagnostic opérationnel, audit interne, onboarding fournisseur, candidature artistique, qualification prospect, pré-brief client." },
    ],
};
