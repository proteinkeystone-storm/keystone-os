/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Pads Data Module
   Source canonique : K_STORE_ASSETS/PADS/IMMOBILIER/
   ═══════════════════════════════════════════════════════════════ */

export const PADS_DATA = {

    A1: {
        id: 'O-IMM-001', padKey: 'A1', title: 'Notices VEFA',
        subtitle: 'Notice descriptive conforme RE 2020 — 2026',
        ai_optimized: 'Claude', icon: 'vefa',
        notice: `1. Remplissez chaque champ avec précision — la qualité du prompt dépend du niveau de détail.\n2. Copiez le prompt généré et collez-le dans Claude.ai, ChatGPT ou votre IA préférée.\n3. Demandez ensuite à l'IA : "Rédige une 2ème version plus luxueuse" ou "Ajoute une section sur les extérieurs".\n4. Avec une clé API configurée dans ⚙️, la réponse s'affiche directement ici.`,
        fields: [
            { id: 'nom_programme', label: 'Nom du programme',           type: 'text',     placeholder: 'ex: Les Jardins du Midi', required: true, span: 'full' },
            { id: 'type_logement', label: 'Type de logement',           type: 'select',   options: ['T2','T3','T4','T5','Villa','Penthouse'], required: true },
            { id: 'surface',       label: 'Surface habitable (m²)',     type: 'number',   placeholder: 'ex: 75', required: true },
            { id: 'etage',         label: 'Étage / Situation',          type: 'text',     placeholder: 'ex: 3ème étage, vue dégagée' },
            { id: 'orientation',   label: 'Orientation principale',     type: 'select',   options: ['Sud','Sud-Est','Sud-Ouest','Est','Ouest','Nord-Est','Nord-Ouest','Nord'] },
            { id: 'sols',          label: 'Revêtements sols',           type: 'select',   options: ['Carrelage grand format','Parquet chêne naturel','Béton ciré','Marbre','Travertin'] },
            { id: 'cuisine',       label: 'Cuisine',                    type: 'select',   options: ['Entièrement équipée','Partiellement équipée (attentes)','Non équipée'] },
            { id: 'chauffage',     label: 'Mode de chauffage',          type: 'select',   options: ['PAC collective','PAC individuelle','Réseau de chaleur urbain (CPCU)','Plancher chauffant électrique','Pompe à chaleur air/air'], required: true },
            { id: 're2020',        label: 'Conformité RE 2020',         type: 'select',   options: ['Seuil 2025 (IC construction ≤ 490 kgCO₂eq/m²)','Seuil 2028 (IC construction ≤ 415 kgCO₂eq/m²)','Seuil 2031 (Objectif bas carbone)'], required: true },
            { id: 'confort_ete',   label: 'Confort d\'été',             type: 'select',   options: ['Brise-soleil orientables (BSO)','Volets roulants motorisés','Double vitrage à contrôle solaire','BSO + Volets motorisés','Sans dispositif spécifique'] },
            { id: 'isolation',     label: 'Type d\'isolation',          type: 'select',   options: ['Biosourcée (laine de bois, chanvre, ouate)','Synthétique (PSE, laine de verre)','Mixte biosourcée + synthétique','ITI béton banché renforcé'] },
            { id: 'annexes',       label: 'Annexes incluses',           type: 'select',   options: ['Cave + Parking standard','Cave + Parking IRVE (borne de recharge)','Parking IRVE seul','Cave seule','Local vélo sécurisé','Aucune annexe'] },
            { id: 'specificites',  label: 'Spécificités & équipements', type: 'textarea', placeholder: 'Terrasse, domotique, VMC double flux, loggia...', span: 'full' },
        ],
        system_prompt: `Rôle : Expert en ingénierie immobilière. Rédige une notice descriptive contractuelle VEFA.

INSTRUCTIONS DE FORMATAGE (CRUCIAL) :
- Ne cite aucune source web.
- Ne fais aucune introduction ni conclusion — commence directement par le titre.
- Utilise des titres en gras et des listes à puces pour une clarté maximale.
- Le document doit être prêt à être imprimé au format PDF.

PARAMÈTRES DU LOT :
- Programme : {{nom_programme}}
- Typologie : {{type_logement}} de {{surface}} m²
- Situation : {{etage}} — Orientation {{orientation}}
- Matériaux Sols : {{sols}}
- Cuisine : {{cuisine}}
- Chauffage : {{chauffage}}
- Confort d'été : {{confort_ete}}
- Isolation : {{isolation}}
- Annexes : {{annexes}}
- Extérieur & spécificités : {{specificites}}

RÉGLEMENTATION 2026 :
- Conformité RE 2020 — {{re2020}}
- Chauffage décarboné (PAC ou équivalent), sans gaz.
- Confort d'été optimisé (Indice DH conforme).
- Performance énergétique : Classe A.

PLAN DE RÉDACTION OBLIGATOIRE :

**NOTICE DESCRIPTIVE DE VENTE (Art. R*261-25 du CCH)**

**1. GROS ŒUVRE ET ISOLATION**
(Détails sur les murs, planchers et isolation {{isolation}})

**2. MENUISERIES ET FERMETURES**
(Vitrage argon, rupture pont thermique, occultations — {{confort_ete}})

**3. ÉQUIPEMENTS TECHNIQUES ET DOMOTIQUE**
({{chauffage}}, VMC Hygro B, pilotage intelligent des consommations)

**4. FINITIONS INTÉRIEURES**
(Sols : {{sols}} — Peintures lisses — Équipements sanitaires haut de gamme)

**5. PARTIES COMMUNES ET SERVICES**
(Sécurité, mobilité douce, locaux vélos, biodiversité — Annexes : {{annexes}})

**6. GARANTIES LÉGALES**
(Parfait achèvement, Biennale, Décennale)`,
    },

    A2: {
        id: 'A2', title: 'Annonces Commerciales',
        subtitle: '3 versions de textes percutants',
        ai_optimized: 'ChatGPT', icon: 'ad',
        notice: `1. Renseignez le programme, la ville et les atouts — c'est l'essentiel.\n2. Le prompt génère 3 versions d'annonces (Luxe, Investissement, Lifestyle).\n3. Dans votre IA, demandez : "Raccourcis la version 2 à 40 mots" ou "Adapte pour SeLoger".\n4. Tip : copiez la version retenue directement dans votre logiciel de diffusion.`,
        fields: [
            { id: 'nom_programme', label: 'Nom du programme',   type: 'text',   placeholder: 'ex: Résidence Azur', required: true },
            { id: 'ville',         label: 'Ville / Quartier',   type: 'text',   placeholder: 'ex: Marseille 8ème', required: true },
            { id: 'type_bien',     label: 'Type de bien',       type: 'select', options: ['Appartement T2','Appartement T3','Appartement T4','T5 et plus','Villa','Penthouse'] },
            { id: 'surface',       label: 'Surface (m²)',       type: 'number', placeholder: 'ex: 68' },
            { id: 'prix',          label: 'Prix (€)',           type: 'number', placeholder: 'ex: 245000' },
            { id: 'dispositif',    label: 'Dispositif fiscal',  type: 'select', options: ['Aucun','Pinel','Pinel+','LMNP','Déficit foncier','Malraux'] },
            { id: 'atouts',        label: 'Atouts & points forts', type: 'textarea', placeholder: 'Vue mer, terrasse, parking, livraison T4 2026...', span: 'full' },
        ],
        system_prompt: `Tu es un copywriter expert en immobilier neuf. Rédige 3 versions d'annonces commerciales percutantes.

Bien :
- Programme : {{nom_programme}} — {{ville}}
- Type : {{type_bien}} de {{surface}}m² — {{prix}} €
- Dispositif fiscal : {{dispositif}}
- Atouts : {{atouts}}

Pour chaque version : 1 accroche (max 10 mots), 1 description (50 mots max), 1 call-to-action.
1. LUXE & PRESTIGE — ton premium, vocabulaire élégant
2. INVESTISSEMENT — ROI, rentabilité, avantages fiscaux
3. LIFESTYLE — émotion, mode de vie, bien-être`,
    },

    A3: {
        id: 'A3', title: 'Emails Acquéreurs',
        subtitle: 'Communication chantier personnalisée',
        ai_optimized: 'Claude', icon: 'mail',
        notice: `1. Le prénom du client est important — l'IA l'utilisera pour personnaliser le ton.\n2. Soyez précis dans "Informations à transmettre" : montants, dates, pièces demandées.\n3. Vous obtiendrez 2 variantes : formelle et chaleureuse. Choisissez selon le profil client.\n4. Après génération, relisez et ajoutez les éléments contractuels spécifiques à votre dossier.`,
        fields: [
            { id: 'nom_client',     label: 'Prénom du client',        type: 'text',   placeholder: 'ex: Marie', required: true },
            { id: 'nom_programme',  label: 'Programme',               type: 'text',   placeholder: 'ex: Les Jardins du Midi', required: true },
            { id: 'type_info',      label: 'Objet de l\'email',       type: 'select', options: ['Avancement chantier','Date de livraison confirmée','Visite cloisons','Demande pièces','Appel de fonds','Remise clés','Relance sans réponse'], required: true },
            { id: 'date_evenement', label: 'Date / Échéance',         type: 'text',   placeholder: 'ex: 15 mai 2026' },
            { id: 'infos_chantier', label: 'Informations à transmettre', type: 'textarea', placeholder: 'Détails, avancement %, montant, pièces demandées...', span: 'full' },
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
        id: 'A4', title: 'Posts Réseaux Sociaux',
        subtitle: 'Facebook · Instagram · LinkedIn',
        ai_optimized: 'Gemini', icon: 'social',
        notice: `1. Sélectionnez "Les 3 réseaux" pour obtenir une version adaptée à chaque plateforme.\n2. Décrivez le visuel avec précision — l'IA adapte le texte à l'image suggérée.\n3. Gemini est recommandé pour ce type de contenu créatif multiplateforme.\n4. Fréquence conseillée : 2-3 posts/semaine. Sauvegardez en bibliothèque pour créer votre calendrier éditorial.`,
        fields: [
            { id: 'nom_programme', label: 'Programme',          type: 'text',   placeholder: 'ex: Résidence Azur', required: true },
            { id: 'reseau',        label: 'Réseau(x) cible(s)', type: 'select', options: ['Facebook uniquement','Instagram uniquement','LinkedIn uniquement','Facebook + Instagram','Les 3 réseaux'], required: true },
            { id: 'type_post',     label: 'Type de contenu',    type: 'select', options: ['Lancement programme','Avancement chantier','Témoignage client','Conseil investissement','Portes ouvertes','Livraison / Remise clés'] },
            { id: 'ton',           label: 'Ton / Ambiance',     type: 'select', options: ['Professionnel & Expert','Humain & Proche','Inspirant & Premium','Éducatif & Pédagogique'] },
            { id: 'visuel',        label: 'Description du visuel', type: 'text', placeholder: 'ex: Vue terrasse avec mer en fond' },
            { id: 'accroche',      label: 'Message clé & infos', type: 'textarea', placeholder: 'Chiffres, date, prix, avancement...', span: 'full' },
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
        id: 'A5', title: 'CR Chantier',
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
        id: 'A6', title: 'Analyste Foncier',
        subtitle: 'Dossier foncier complet en 5 minutes',
        ai_optimized: 'Claude', icon: 'foncier',
        notice: `1. Vérifiez le zonage PLU avant toute analyse — c'est le point bloquant n°1.\n2. Renseignez le prix même approximatif : l'analyse de charge foncière est la plus-value principale.\n3. L'IA produit une recommandation GO/NO-GO — à compléter avec votre expertise terrain.\n4. Utilisez le résultat comme base de note interne ou de présentation aux associés.`,
        fields: [
            { id: 'commune',        label: 'Commune / Secteur',        type: 'text',   placeholder: 'ex: Ollioules, Var (83)', required: true },
            { id: 'surface_terrain',label: 'Surface terrain (m²)',     type: 'number', placeholder: 'ex: 1500', required: true },
            { id: 'plu',            label: 'Zone PLU',                 type: 'select', options: ['UA (Centre-ville)','UB (Pavillonnaire)','UC (Résidentiel)','UD (Mixte)','AU (À urbaniser)','N (Naturelle)','A (Agricole)','Inconnue'] },
            { id: 'prix_foncier',   label: 'Prix du terrain (€)',      type: 'number', placeholder: 'ex: 350000' },
            { id: 'ces',            label: 'CES / Gabarit connu',      type: 'text',   placeholder: 'ex: CES 0.5, R+3 max, recul 5m' },
            { id: 'contexte',       label: 'Contexte & Observations',  type: 'textarea', placeholder: 'Environnement, servitudes, risques, accès...', span: 'full' },
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
        id: 'A7', title: 'Objections Acquéreurs',
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
        id: 'A8', title: 'Brief Photo / 3D',
        subtitle: 'Brief créatif professionnel en 2 min',
        ai_optimized: 'ChatGPT', icon: 'brief',
        notice: `1. Choisissez "Pack complet" pour obtenir un brief exhaustif transmissible directement au prestataire.\n2. Décrivez précisément la direction artistique souhaitée — c'est ce qui évite les allers-retours.\n3. Le brief inclut un planning de production suggéré à valider avec votre prestataire.\n4. Sauvegardez en bibliothèque pour constituer votre référentiel de briefs par programme.`,
        fields: [
            { id: 'nom_programme', label: 'Programme',              type: 'text',   placeholder: 'ex: Résidence Azur', required: true },
            { id: 'type_support',  label: 'Type de support',        type: 'select', options: ['Photographies réelles','Images 3D / Rendu','Vidéo promotionnelle','Visite virtuelle 360°','Drone / Aérien','Pack complet'], required: true },
            { id: 'stade',         label: 'Stade du projet',        type: 'select', options: ['Terrain seul','Permis obtenu (plans)','Chantier en cours','Livraison imminente','Livré'] },
            { id: 'ambiance',      label: 'Direction artistique',   type: 'select', options: ['Luxe & Prestige','Moderne & Épuré','Méditerranéen & Chaleureux','Éco & Nature','Urbain & Dynamique'] },
            { id: 'cible',         label: 'Usage & Diffusion',      type: 'text',   placeholder: 'ex: Plaquette, réseaux sociaux, site web' },
            { id: 'sujets',        label: 'Priorités & Contraintes',type: 'textarea', placeholder: 'Vues à valoriser, budget, délais, formats...', span: 'full' },
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
};
