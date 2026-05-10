/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Seed Clauses VEFA v1 (Sprint 1.2)
   Bibliothèque initiale de 29 clauses standard pour le template
   vefa-notice-v1.html, secteur IMM (immobilier neuf).

   Chaque clause :
     - id      : déterministe (clause_vefa_<KEY>_v1) → seed idempotent
     - secteur : 'IMM'  (filtre fillClauses())
     - key     : doit matcher [[CLAUSE_<KEY>]] dans le template
     - version : entier croissant (le moteur prend la version max)
     - label   : nom humain (admin)
     - content : fragment HTML (inséré tel quel, autorité de confiance)

   Pour modifier une clause sans casser les notices déjà signées :
     → bumper version, créer une entrée _v2.

   Seed via : window.docEngineDemo.seedClauses()
   ═══════════════════════════════════════════════════════════════ */

export const VEFA_CLAUSES_V1 = [

  // ── Page 1 ───────────────────────────────────────────────────
  {
    id: 'clause_vefa_AVERTISSEMENT_NOTICE_v1',
    secteur: 'IMM', key: 'AVERTISSEMENT_NOTICE', version: 1,
    label: 'Avertissement contractuel — couverture',
    content: `<div class="warning-box"><p><strong>⚠ Avertissement contractuel :</strong> La présente notice constitue un document descriptif. Toute modification des prestations par rapport au contenu ci-après doit faire l'objet d'un avenant signé. Les informations portant sur les performances énergétiques sont établies sur la base des plans et études thermiques en vigueur à la date d'édition. <strong>La validation humaine par un professionnel qualifié est impérative avant toute signature notariale.</strong></p></div>`,
  },

  // ── Page 2 — Structure & Enveloppe ───────────────────────────
  {
    id: 'clause_vefa_FONDATIONS_v1',
    secteur: 'IMM', key: 'FONDATIONS', version: 1,
    label: 'Fondations & Structure porteuse',
    content: `<ul class="items">
      <li>Fondations superficielles en semelles filantes et isolées sur sol naturel porteur, conformément à l'étude géotechnique G2 du site.</li>
      <li>Structure porteuse en béton armé coulé en place (poteaux, poutres, voiles de refend), dimensionnée selon les règles Eurocodes.</li>
      <li>Dallage béton sur hérisson drainant, épaisseur minimale 12 cm, avec treillis soudé anti-fissuration.</li>
      <li>Planchers intermédiaires : dalles alvéolées précontraintes ou dalle pleine béton armé selon configuration.</li>
    </ul>`,
  },
  {
    id: 'clause_vefa_MACONNERIE_v1',
    secteur: 'IMM', key: 'MACONNERIE', version: 1,
    label: 'Maçonnerie & Façades',
    content: `<ul class="items">
      <li>Maçonnerie de remplissage en blocs béton creux (200 mm) pour les façades non porteuses.</li>
      <li>Isolation thermique par l'extérieur (ITE) — système enduit sur isolant PSE (polystyrène expansé graphité) ep. 120 mm minimum.</li>
      <li>Enduit de façade minéral teinté dans la masse, finition grain fin — couleurs conformes aux prescriptions architecturales du PLU local.</li>
      <li>Refends intérieurs : briques de 20 cm ou béton armé selon les zones fonctionnelles.</li>
    </ul>`,
  },
  {
    id: 'clause_vefa_ISOLATION_THERMIQUE_v1',
    secteur: 'IMM', key: 'ISOLATION_THERMIQUE', version: 1,
    label: 'Isolation thermique (PSE + laine de verre)',
    content: `<div class="info-box">
      <p><strong>Solution retenue :</strong> Isolation <strong>synthétique</strong> — PSE graphité en façade (ITE) + laine de verre (combles / plafonds). Résistance thermique totale R ≥ 6 m²·K/W en toiture, R ≥ 4 m²·K/W en façade.</p>
    </div>
    <ul class="items">
      <li>Façades extérieures : ITE PSE ep. 120 mm (λ = 0,031 W/m·K)</li>
      <li>Combles / toiture : laine de verre soufflée ou rouleaux, ep. 300 mm min.</li>
      <li>Ponts thermiques traités : rupteurs de pont thermique aux planchers et refends.</li>
      <li>Plancher bas sur vide sanitaire : doublage isolant ep. 80 mm.</li>
    </ul>`,
  },
  {
    id: 'clause_vefa_TOITURE_v1',
    secteur: 'IMM', key: 'TOITURE', version: 1,
    label: 'Toiture',
    content: `<ul class="items">
      <li>Toiture terrasse inaccessible ou toiture à faible pente (préciser selon permis de construire) — étanchéité bicouche soudée avec protection gravillon ou végétalisée.</li>
      <li>Relevés d'étanchéité en périphérie avec bavettes aluminium.</li>
      <li>Évacuation des eaux pluviales par chéneaux encastrés et descentes en façade.</li>
      <li>Accès toiture par trappe de visite étanche et isolée.</li>
    </ul>`,
  },
  {
    id: 'clause_vefa_MENUISERIES_EXT_v1',
    secteur: 'IMM', key: 'MENUISERIES_EXT', version: 1,
    label: 'Menuiseries extérieures',
    content: `<ul class="items">
      <li>Fenêtres et baies vitrées en aluminium à rupture de pont thermique, profilé ≥ 28 mm de coupure.</li>
      <li>Vitrage : double vitrage 4/16/4 à lame d'argon, Ug ≤ 1,1 W/m²·K — traitement Sécurit en zones d'allège et de plain-pied.</li>
      <li>Coefficient de transmission thermique des menuiseries : Uw ≤ 1,3 W/m²·K.</li>
      <li>Portes-fenêtres coulissantes ou à la française selon les pièces — quincaillerie aluminium couleur thermolaquée.</li>
      <li>Porte d'entrée blindée, isolation acoustique Rw ≥ 40 dB, seuil isolé anti-pont thermique.</li>
    </ul>`,
  },
  {
    id: 'clause_vefa_PROTECTIONS_SOLAIRES_v1',
    secteur: 'IMM', key: 'PROTECTIONS_SOLAIRES', version: 1,
    label: 'Protections solaires (volets motorisés)',
    content: `<ul class="items">
      <li><strong>Volets roulants motorisés</strong> (toutes fenêtres et baies), tablier aluminium isolé, coffre isolé intégré en tableau ou en about de dalle.</li>
      <li>Commandes individuelles par interrupteur mural — pré-câblage pour pilotage domotique.</li>
      <li>Coefficient de réduction solaire Fc ≤ 0,30 avec volets fermés.</li>
      <li>Débords de toiture / casquettes sur les façades Sud et Ouest pour protection solaire passive.</li>
    </ul>`,
  },

  // ── Page 3 — Équipements Techniques ──────────────────────────
  {
    id: 'clause_vefa_CHAUFFAGE_v1',
    secteur: 'IMM', key: 'CHAUFFAGE', version: 1,
    label: 'Chauffage — plancher chauffant électrique RE 2020',
    content: `<div class="info-box">
      <p><strong>Énergie décarbonée :</strong> Le logement est équipé d'un plancher chauffant électrique rayonnant à basse température, conforme aux exigences RE 2020 (émission directe nulle en phase d'usage).</p>
    </div>
    <ul class="items">
      <li>Câbles chauffants noyés dans la chape, puissance spécifique ≤ 100 W/m², dimensionnée par étude thermique lot.</li>
      <li>Thermostat programmable par pièce (7 zones minimum), connecté — programmation hebdomadaire et dérogation manuelle.</li>
      <li>Régulation en chauffe par anticipation avec sonde de température extérieure.</li>
      <li>Disjoncteur différentiel dédié par zone de chauffage dans le tableau électrique.</li>
      <li>Consommation annuelle estimée : ≤ 50 kWhEP / m² / an (classe A).</li>
    </ul>`,
  },
  {
    id: 'clause_vefa_ECS_v1',
    secteur: 'IMM', key: 'ECS', version: 1,
    label: 'Production ECS — chauffe-eau thermodynamique',
    content: `<ul class="items">
      <li>Chauffe-eau thermodynamique (CET) monobloc, volume ≥ 200 litres, COP ≥ 3,0.</li>
      <li>Captation sur air intérieur ou extérieur selon configuration technique du logement.</li>
      <li>Raccordement électrique dédié, résistance électrique d'appoint pour périodes de forte demande.</li>
      <li>Groupe de sécurité, soupape de sûreté et réducteur de pression conformes DTU 60.1.</li>
    </ul>`,
  },
  {
    id: 'clause_vefa_VMC_v1',
    secteur: 'IMM', key: 'VMC', version: 1,
    label: 'Ventilation VMC double flux',
    content: `<ul class="items">
      <li>Ventilation mécanique contrôlée double flux avec récupérateur de chaleur, rendement ≥ 85 %.</li>
      <li>Centrale VMC DF installée en volume technique (comble ou local dédié), filtre G4/F7.</li>
      <li>Bouches d'insufflation dans les pièces de vie (séjour, chambres) ; bouches d'extraction dans les pièces humides (SDB, WC, cuisine).</li>
      <li>Raccordement sur conduits rigides isolés, équilibrage des débits selon DTU 68.3.</li>
      <li>Débit minimum réglementaire : conforme arrêté du 24 mars 1982 modifié.</li>
    </ul>`,
  },
  {
    id: 'clause_vefa_ELECTRICITE_v1',
    secteur: 'IMM', key: 'ELECTRICITE', version: 1,
    label: 'Installations électriques NF C 15-100',
    content: `<ul class="items">
      <li>Tableau de répartition général (TGBT) équipé de disjoncteurs différentiels 30 mA type A et type AC selon usages.</li>
      <li>Câblage en cuivre sous gaine IRO, section adaptée à chaque circuit — norme NF C 15-100.</li>
      <li>Prises de courant 2P+T dans toutes les pièces, circuit TV/RJ45 dans séjour et chambres.</li>
      <li>Éclairage extérieur (portail, allée, terrasse) avec détection de présence.</li>
      <li>Prise de recharge IRVE déportée au parking — voir Section 5.</li>
    </ul>`,
  },
  {
    id: 'clause_vefa_PLOMBERIE_v1',
    secteur: 'IMM', key: 'PLOMBERIE', version: 1,
    label: 'Plomberie & réseau d\'eau',
    content: `<ul class="items">
      <li>Alimentation eau froide en cuivre ou multicouche (PER gainé) depuis le regard de branchement en limite de propriété.</li>
      <li>Robinet d'arrêt général accessible dans gaine technique, compteur d'eau individuel conforme à la norme NF EN ISO 4064.</li>
      <li>Colonne montante eau chaude isolée (calorifugeage classe 3), retour boucle ECS pour les points de puisage éloignés.</li>
      <li>Évacuations en PVC série 1 pour les eaux usées, raccordement au réseau public d'assainissement.</li>
      <li>Robinets de puisage extérieur (terrasse / jardin) avec disconnecteur.</li>
    </ul>`,
  },
  {
    id: 'clause_vefa_DOMOTIQUE_v1',
    secteur: 'IMM', key: 'DOMOTIQUE', version: 1,
    label: 'Domotique & connectivité (KNX, FTTH)',
    content: `<ul class="items">
      <li>Gaine technique logement (GTL) conforme NF C 15-100 — tableau, tableau de communication, disjoncteur de branchement.</li>
      <li>Pré-câblage domotique : bus KNX ou protocole équivalent pour pilotage volets, chauffage et éclairages.</li>
      <li>Passerelle box domotique en attente dans le tableau de communication.</li>
      <li>Fibre optique FTTH jusqu'à la GTL — raccordement opérateur à la charge de l'acquéreur.</li>
      <li>Prises RJ45 Cat 6 dans séjour et toutes les chambres.</li>
    </ul>`,
  },

  // ── Page 4 — Finitions Intérieures ───────────────────────────
  {
    id: 'clause_vefa_SOL_PIECES_VIE_v1',
    secteur: 'IMM', key: 'SOL_PIECES_VIE', version: 1,
    label: 'Sol pièces de vie — carrelage 120x60',
    content: `<ul class="items">
      <li><strong>Carrelage grand format 120 × 60 cm</strong> — grès cérame rectifié, finition mate ou semi-polie, joint fin 2 mm. Pose droite sur chape ciment lissée.</li>
      <li>Qualité PEI 4 — résistance à l'abrasion adaptée aux zones de fort passage (entrée, cuisine, séjour, couloirs).</li>
      <li>Plinthes assorties au carrelage, hauteur 8 cm, finition biseautée.</li>
      <li>Seuils de porte en profilé aluminium ou en accord carrelage au passage des huisseries.</li>
      <li>Teinte et référence définitives choisies par l'acquéreur parmi catalogue proposé par le promoteur (3 teintes au choix incluses).</li>
    </ul>`,
  },
  {
    id: 'clause_vefa_SOL_CHAMBRES_v1',
    secteur: 'IMM', key: 'SOL_CHAMBRES', version: 1,
    label: 'Sol chambres — parquet contrecollé chêne',
    content: `<ul class="items">
      <li><strong>Parquet contrecollé</strong>, finition vitrifiée mat, lames 180 mm de largeur minimum, épaisseur totale 15 mm, pose flottante sur sous-couche acoustique.</li>
      <li>Essence : chêne naturel (référence standard) — choix possible dans catalogue promoteur sous réserve de plus-value éventuelle.</li>
      <li>Plinthes bois assorties, peintes en blanc ou teinte naturelle au choix de l'acquéreur.</li>
      <li>Chambre parentale : option sol en carrelage disponible sur demande (prestations équivalentes).</li>
    </ul>`,
  },
  {
    id: 'clause_vefa_SDB_v1',
    secteur: 'IMM', key: 'SDB', version: 1,
    label: 'Salles de bains & salles d\'eau',
    content: `<ul class="items">
      <li>Faïence murale 60 × 120 cm jusqu'en plafond dans douche à l'italienne, 1,80 m de hauteur dans le reste de la pièce.</li>
      <li>Receveur de douche extraplat 90 × 90 cm encastré, avec système de caniveau ou bonde décentrée — étanchéité DTU 52.2.</li>
      <li>Meuble vasque suspendu, double vasque (SDB principale), robinetterie chromée de gamme standard.</li>
      <li>WC suspendus avec bâti-support encastré et plaque de commande double touche.</li>
      <li>Radiateur sèche-serviettes électrique 500 W en SDB.</li>
    </ul>`,
  },
  {
    id: 'clause_vefa_PEINTURES_v1',
    secteur: 'IMM', key: 'PEINTURES', version: 1,
    label: 'Peintures & revêtements muraux Q3',
    content: `<ul class="items">
      <li><strong>Peinture lisse qualité Q3</strong> (selon norme NF DTU 59.1) sur enduit plâtre lissé ou plaque de plâtre BA 13 — deux couches minimum.</li>
      <li>Finition blanche satinée en standard (teinte RAL 9010 ou équivalent) — option de personnalisation couleur possible dans certaines pièces sur demande.</li>
      <li>Faux plafonds en plaques de plâtre BA 13 suspendus dans toutes les pièces — hauteur sous plafond fini ≥ 2,50 m en séjour.</li>
      <li>Cloisons de distribution en placostyle double peau BA 13, isolation phonique Rw ≥ 43 dB.</li>
      <li>Habillage de gaine technique en PVC blanc démontable.</li>
    </ul>`,
  },
  {
    id: 'clause_vefa_CUISINE_v1',
    secteur: 'IMM', key: 'CUISINE', version: 1,
    label: 'Cuisine partiellement équipée — attentes techniques',
    content: `<div class="warning-box">
      <p><strong>Cuisine partiellement équipée :</strong> Le logement est livré avec les attentes techniques (eau froide, eau chaude, évacuation, électricité dédiée) mais sans meubles ni électroménager inclus dans le prix de vente. L'acquéreur conserve le libre choix de son cuisiniste.</p>
    </div>
    <ul class="items">
      <li>Attente plomberie : alimentation eau froide et eau chaude avec robinets d'arrêt, siphon d'évacuation.</li>
      <li>Attente électricité : prise 20A dédiée (plaque de cuisson), prise 16A (lave-vaisselle), 2 prises 16A (électroménager), circuit éclairage dédié.</li>
      <li>Revêtement sol : carrelage grand format identique aux pièces de vie.</li>
      <li>Faïence crédence : 60 cm de hauteur sur zone de préparation (fournie, à préciser lors de la signature).</li>
    </ul>`,
  },
  {
    id: 'clause_vefa_MENUISERIES_INT_v1',
    secteur: 'IMM', key: 'MENUISERIES_INT', version: 1,
    label: 'Menuiseries intérieures',
    content: `<ul class="items">
      <li>Portes intérieures isoplane laquées blanc, huisseries bois MDF peint, poignées chromées brossées.</li>
      <li>Placard dressing dans chaque chambre (penderie sur toute la largeur, tablette et tringle).</li>
      <li>Escalier intérieur (si logement sur niveaux) : structure bois ou béton habillé bois, garde-corps en acier laqué blanc ou inox.</li>
    </ul>`,
  },

  // ── Page 5 — Annexes & Mobilité ──────────────────────────────
  {
    id: 'clause_vefa_CAVE_v1',
    secteur: 'IMM', key: 'CAVE', version: 1,
    label: 'Cave privative',
    content: `<ul class="items">
      <li>Cave privative attitrée au lot, numérotée et matérialisée sur plans de vente.</li>
      <li>Accès sécurisé depuis la circulation commune (hall sous-sol ou couloir), porte métallique avec serrure à cylindre ou cadenas.</li>
      <li>Revêtement sol : béton brut ou carrelage sol technique selon configuration.</li>
      <li>Alimentation électrique : éclairage et prise de courant 16A dédiés au sous-sol.</li>
      <li>Ventilation naturelle par grilles d'aération conformes aux règles sanitaires.</li>
      <li>Surface indicative : à préciser sur le plan annexé au contrat de réservation (non habitable, exclue SHAB).</li>
    </ul>`,
  },
  {
    id: 'clause_vefa_EXTERIEURS_v1',
    secteur: 'IMM', key: 'EXTERIEURS', version: 1,
    label: 'Espaces extérieurs privés',
    content: `<ul class="items">
      <li>Terrasse dallée accessible depuis le séjour, dallage grès cérame extérieur antidérapant R11, assortie au carrelage intérieur.</li>
      <li>Jardin privatif clos par mur de clôture ou haie végétale selon plan masse — nivellement et engazonnement inclus.</li>
      <li>Portail d'entrée motorisé avec interphone vidéo et commande à distance.</li>
      <li>Boîte aux lettres normalisée en limite de propriété.</li>
      <li>Robinet de jardin extérieur avec disconnecteur.</li>
    </ul>`,
  },
  {
    id: 'clause_vefa_PARKING_IRVE_v1',
    secteur: 'IMM', key: 'PARKING_IRVE', version: 1,
    label: 'Parking IRVE — pré-équipement borne',
    content: `<div style="margin-bottom:10pt;">
      <span class="badge-green" style="font-size:8.5pt; padding:4pt 10pt; display:inline-block;">⚡ Parking IRVE — Pré-équipement borne de recharge</span>
    </div>
    <div class="info-box">
      <p><strong>Conformité loi LOM (2019) &amp; Décret n°2020-1696 :</strong> Toute place de parking neuve doit être pré-équipée pour l'installation ultérieure d'une borne de recharge pour véhicule électrique. Ce logement est conforme à cette obligation.</p>
    </div>
    <ul class="items">
      <li><strong>Place de parking couverte / en box</strong> attitrée au lot, surface ≥ 12 m², numérotée sur plans de vente.</li>
      <li>Pré-câblage IRVE : fourreaux, câble souple H07RN-F 3G6 mm² depuis TGBT ou tableau sous-sol jusqu'à la place de parking.</li>
      <li>Disjoncteur différentiel 32A type A réservé IRVE dans le tableau électrique du logement.</li>
      <li>Prise de courant T2S (Type 2 renforcée) ou sortie de câble disponible à la borne de stationnement.</li>
      <li>L'installation de la borne de recharge finale (Wallbox) est à la charge de l'acquéreur après livraison — puissance disponible : jusqu'à 7,4 kW monophasé.</li>
      <li>Marquage IRVE au sol sur la place de parking, signalétique normalisée.</li>
      <li>Délai de recharge estimatif (véhicule 60 kWh) : ~9 h sur prise renforcée 7,4 kW.</li>
    </ul>`,
  },
  {
    id: 'clause_vefa_ACCES_SECURITE_v1',
    secteur: 'IMM', key: 'ACCES_SECURITE', version: 1,
    label: 'Accès & sécurité parking',
    content: `<ul class="items">
      <li>Accès au parking sécurisé par badge ou télécommande — résidence fermée.</li>
      <li>Éclairage LED avec détection de présence dans le parking et les circulations sous-sol.</li>
      <li>Système de désenfumage conforme ERP/IGH si application selon superficie.</li>
      <li>Visiophone couleur avec mémorisation et renvoi d'appel sur smartphone (option connectivité incluse).</li>
    </ul>`,
  },
  {
    id: 'clause_vefa_NOTE_ANNEXES_v1',
    secteur: 'IMM', key: 'NOTE_ANNEXES', version: 1,
    label: 'Note relative aux annexes',
    content: `<div class="info-box"><p><strong>Note relative aux annexes :</strong> La cave et la place de parking sont désignées dans l'acte de vente authentique par leurs numéros respectifs figurant sur les plans de masse et de niveaux annexés au contrat de réservation. Leur jouissance est exclusive et attachée au lot principal.</p></div>`,
  },

  // ── Page 6 — Mentions Légales ────────────────────────────────
  {
    id: 'clause_vefa_GFA_v1',
    secteur: 'IMM', key: 'GFA', version: 1,
    label: 'Garantie Financière d\'Achèvement (GFA)',
    content: `Garantie extrinsèque d'achèvement souscrite auprès d'un établissement de crédit ou d'une compagnie d'assurance, conformément aux articles L.261-10 et R.261-17 du Code de la Construction et de l'Habitation. Elle assure l'achèvement du programme en cas de défaillance du vendeur.`,
  },
  {
    id: 'clause_vefa_GPA_v1',
    secteur: 'IMM', key: 'GPA', version: 1,
    label: 'Garantie de Parfait Achèvement (GPA)',
    content: `À compter de la réception, l'entrepreneur est tenu de réparer tous les désordres signalés par le maître d'ouvrage, qu'ils soient mentionnés au procès-verbal de réception ou notifiés par voie écrite pendant l'année qui suit (art. 1792-6 du Code civil).`,
  },
  {
    id: 'clause_vefa_BIENNALE_v1',
    secteur: 'IMM', key: 'BIENNALE', version: 1,
    label: 'Garantie Biennale de Bon Fonctionnement',
    content: `Couvre les éléments d'équipement dissociables de l'ouvrage (volets, robinetterie, VMC, portes intérieures, appareils de chauffage…) pouvant être remplacés sans dénaturer l'immeuble (art. 1792-3 du Code civil).`,
  },
  {
    id: 'clause_vefa_DECENNALE_v1',
    secteur: 'IMM', key: 'DECENNALE', version: 1,
    label: 'Garantie Décennale',
    content: `Responsabilité solidaire du constructeur pour les dommages affectant la solidité de l'ouvrage ou le rendant impropre à sa destination (art. 1792 et suivants du Code civil). Couverte par l'assurance Dommages-Ouvrage (DO) souscrite par le maître d'ouvrage.`,
  },
  {
    id: 'clause_vefa_ART_R261_25_v1',
    secteur: 'IMM', key: 'ART_R261_25', version: 1,
    label: 'Article R.261-25 CCH',
    content: `« La notice descriptive indique les caractéristiques techniques de l'immeuble et de chaque local privatif. Elle précise, pour les parties privatives, la nature et la qualité des matériaux et éléments d'équipement, ainsi que les équipements collectifs. La notice descriptive doit être conforme à un modèle type. Elle est annexée au contrat préliminaire. »`,
  },
  {
    id: 'clause_vefa_AVERTISSEMENT_VALIDATION_v1',
    secteur: 'IMM', key: 'AVERTISSEMENT_VALIDATION', version: 1,
    label: 'Avertissement validation pré-notariale',
    content: `<div class="warning-box"><p><strong>⚠ Clause impérative avant signature notariale :</strong> La présente notice descriptive contractuelle a été établie sur la base des données de programme disponibles à la date d'édition. <strong>Toute information relative aux performances énergétiques, aux indicateurs RE 2020 et aux quantités de surfaces doit impérativement être validée par un professionnel qualifié (thermicien, maître d'œuvre ou bureau de contrôle) avant signature de l'acte authentique de vente chez le notaire.</strong> Le promoteur-vendeur décline toute responsabilité en cas de modification du programme survenant après l'édition de ce document, sans avenant signé.</p></div>`,
  },

];
