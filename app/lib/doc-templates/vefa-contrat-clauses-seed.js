/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Seed Clauses Contrat de Réservation VEFA v1 (Sprint 4)
   Bibliothèque juridique initiale pour le template vefa-contrat-v1.html,
   secteur IMM (immobilier neuf).

   Convention :
     - id      : déterministe (clause_vefa_contrat_<KEY>_v1) → seed idempotent
     - secteur : 'IMM'
     - key     : doit matcher [[CLAUSE_<KEY>]] dans le template
                 → toutes préfixées CONTRAT_ pour ne PAS collisionner
                   avec les clauses de la notice (vefa-clauses-seed.js).
     - version : entier croissant (fillClauses prend la version max)
     - label   : nom humain (admin)
     - content : fragment HTML (inséré tel quel)

   IMPORTANT — Statut juridique : ces clauses sont des MODÈLES INDICATIFS
   reflétant le droit commun de la VEFA (CCH Art. L.261-1 et suivants).
   Elles doivent être validées et adaptées par un notaire avant signature.

   Seed via : Admin → La Fabrique → Clauses → ↻ Seed Contrat VEFA v1
   ═══════════════════════════════════════════════════════════════ */

export const VEFA_CONTRAT_CLAUSES_V1 = [

  // ── Page 1 — Avertissement liminaire ─────────────────────────
  {
    id: 'clause_vefa_contrat_CONTRAT_AVERTISSEMENT_v1',
    secteur: 'IMM', key: 'CONTRAT_AVERTISSEMENT', version: 1,
    label: 'Avertissement liminaire — Couverture',
    content: `<div class="warning-box"><p><strong>⚠ Document indicatif :</strong> Le présent contrat préliminaire constitue un modèle reflétant les dispositions du Code de la Construction et de l'Habitation (Art. L.261-15 et R.261-25-1). Il doit être <strong>impérativement examiné et validé par un notaire</strong> avant signature des parties. Toute clause particulière ou adaptation au cas d'espèce relève de l'office du notaire instrumentaire désigné en page 1.</p></div>`,
  },

  // ── Page 2 — Objet & Désignation ─────────────────────────────
  {
    id: 'clause_vefa_contrat_CONTRAT_OBJET_v1',
    secteur: 'IMM', key: 'CONTRAT_OBJET', version: 1,
    label: 'Objet du contrat',
    content: `<p>Le Réservant s'engage à réserver au Réservataire, qui l'accepte, un lot privatif à édifier dans le programme immobilier ci-après désigné, dans les conditions définies aux présentes et conformément aux dispositions de l'article L.261-15 du Code de la Construction et de l'Habitation. Le présent contrat ne vaut pas vente : il ouvre droit, sous les conditions et délais convenus, à la signature ultérieure d'un acte authentique de vente en l'état futur d'achèvement reçu par le notaire désigné.</p>`,
  },

  {
    id: 'clause_vefa_contrat_CONTRAT_DESIGNATION_LOT_v1',
    secteur: 'IMM', key: 'CONTRAT_DESIGNATION_LOT', version: 1,
    label: 'Désignation du lot réservé',
    content: `<p>Le bien réservé est précisément désigné ci-après. Le Réservataire reconnaît avoir pris connaissance de l'ensemble des plans, perspectives et documents graphiques annexés (cotes, surfaces, hauteurs sous plafond, prospects). Toute modification du programme ou du lot devra faire l'objet d'un avenant écrit signé des deux parties.</p>`,
  },

  {
    id: 'clause_vefa_contrat_CONTRAT_ETAT_DESCRIPTIF_v1',
    secteur: 'IMM', key: 'CONTRAT_ETAT_DESCRIPTIF', version: 1,
    label: 'État descriptif de division & règlement de copropriété',
    content: `<p>Le Réservataire déclare avoir reçu communication du projet d'état descriptif de division ainsi que du projet de règlement de copropriété établi par le notaire désigné. Il reconnaît en avoir pris connaissance et accepte d'adhérer au règlement de copropriété qui sera publié au Service de la Publicité Foncière concomitamment à la signature de l'acte authentique. Les quote-parts indivises des parties communes attachées au lot privatif sont indiquées en page 1.</p>`,
  },

  {
    id: 'clause_vefa_contrat_CONTRAT_NOTICE_REFERENCE_v1',
    secteur: 'IMM', key: 'CONTRAT_NOTICE_REFERENCE', version: 1,
    label: 'Notice descriptive — Renvoi',
    content: `<p>Les caractéristiques techniques de la construction, les prestations et équipements du lot privatif et des parties communes sont décrits dans la <strong>notice descriptive contractuelle</strong> annexée au présent contrat, établie conformément à l'arrêté du 10 mai 1968 et à la RE 2020. Le Réservataire reconnaît en avoir pris connaissance et l'accepter sans réserve. La notice descriptive a la même force contractuelle que le présent contrat.</p>`,
  },

  // ── Page 3 — Prix & Échéancier ───────────────────────────────
  {
    id: 'clause_vefa_contrat_CONTRAT_PRIX_v1',
    secteur: 'IMM', key: 'CONTRAT_PRIX', version: 1,
    label: 'Prix de vente',
    content: `<p>Le prix de vente TTC est ferme et définitif. Il s'entend honoraires de négociation et de commercialisation inclus s'il y a lieu, mais hors frais d'acte authentique et émoluments du notaire qui demeurent à la charge du Réservataire. La répartition entre la quote-part foncière et la quote-part bâti est précisée ci-dessous à des fins de calcul des droits et taxes.</p>`,
  },

  {
    id: 'clause_vefa_contrat_CONTRAT_ECHEANCIER_v1',
    secteur: 'IMM', key: 'CONTRAT_ECHEANCIER', version: 1,
    label: 'Échéancier de paiement (R.261-14)',
    content: `<p>Le paiement du prix s'effectue par appels de fonds successifs, exigibles à la réalisation effective de chaque stade d'avancement constaté par l'architecte ou le maître d'œuvre. Les pourcentages cumulés ci-après constituent des <strong>plafonds légaux impératifs</strong> fixés par l'article R.261-14 du CCH : aucun appel ne peut excéder ces seuils, sous peine de nullité.</p>`,
  },

  {
    id: 'clause_vefa_contrat_CONTRAT_FRAIS_ACTE_v1',
    secteur: 'IMM', key: 'CONTRAT_FRAIS_ACTE', version: 1,
    label: 'Frais d\'acte & émoluments',
    content: `<p>Les frais, droits et émoluments de l'acte authentique de vente (taxe de publicité foncière, contribution de sécurité immobilière, émoluments du notaire, débours et formalités) sont supportés exclusivement par le Réservataire. En matière de vente d'immeuble neuf soumis à TVA, ces frais sont dits « réduits » et représentent généralement entre 2 % et 3 % du prix TTC. Une estimation chiffrée sera communiquée par le notaire au Réservataire préalablement à la signature de l'acte authentique.</p>`,
  },

  // ── Page 4 — Dépôt de garantie & Séquestre ───────────────────
  {
    id: 'clause_vefa_contrat_CONTRAT_DEPOT_GARANTIE_v1',
    secteur: 'IMM', key: 'CONTRAT_DEPOT_GARANTIE', version: 1,
    label: 'Dépôt de garantie',
    content: `<p>En garantie de l'exécution de ses engagements, le Réservataire verse au Réservant, à la signature des présentes, un dépôt de garantie dont le montant est indiqué ci-dessous. Ce dépôt est versé sur un compte spécial inaliénable, indisponible et insaisissable jusqu'à la signature de l'acte authentique de vente ou la résolution du contrat dans les conditions prévues aux articles 10 et 11. Conformément à l'article R.261-28 du CCH, son montant ne peut excéder 5 % du prix prévisionnel de vente lorsque la signature de l'acte authentique doit intervenir dans le délai d'un an, 2 % lorsqu'elle doit intervenir dans le délai de deux ans ; aucun dépôt ne peut être exigé lorsque ce délai excède deux ans.</p>`,
  },

  {
    id: 'clause_vefa_contrat_CONTRAT_SEQUESTRE_v1',
    secteur: 'IMM', key: 'CONTRAT_SEQUESTRE', version: 1,
    label: 'Compte séquestre',
    content: `<p>Le dépôt de garantie est versé entre les mains du séquestre désigné ci-dessous (notaire instrumentaire ou établissement bancaire habilité) qui en accuse réception et s'engage à le conserver dans les conditions légales. Les fonds séquestrés produisent intérêts au profit du Réservataire au taux du livret A, sauf disposition contraire convenue entre les parties. Aucune somme ne peut être prélevée sur ce compte avant la signature de l'acte authentique de vente ou, en cas de résolution, avant accord écrit des parties ou décision de justice.</p>`,
  },

  {
    id: 'clause_vefa_contrat_CONTRAT_RESTITUTION_DEPOT_v1',
    secteur: 'IMM', key: 'CONTRAT_RESTITUTION_DEPOT', version: 1,
    label: 'Restitution du dépôt de garantie',
    content: `<p>Le dépôt de garantie sera restitué intégralement au Réservataire, sans pénalité ni retenue, dans un délai maximum de trois (3) mois à compter de la demande, dans les cas suivants prévus à l'article R.261-31 du CCH :</p>
    <ul class="items">
      <li>Si le contrat de vente n'est pas conclu du fait du Réservant dans le délai prévu au contrat préliminaire ;</li>
      <li>Si le prix de vente excède de plus de 5 % le prix prévisionnel indiqué aux présentes ;</li>
      <li>Si le ou les prêts prévus à la condition suspensive de l'article 12 ne sont pas obtenus aux conditions fixées ;</li>
      <li>Si l'un des éléments d'équipement essentiels prévus dans la notice descriptive ne devait pas être réalisé ;</li>
      <li>Si l'immeuble présente une réduction supérieure à 5 % de la consistance ou de la qualité des ouvrages.</li>
    </ul>`,
  },

  // ── Page 5 — Rétractation, conditions suspensives, livraison ──
  {
    id: 'clause_vefa_contrat_CONTRAT_RETRACTATION_v1',
    secteur: 'IMM', key: 'CONTRAT_RETRACTATION', version: 1,
    label: 'Délai de rétractation (Loi SRU — L.271-1)',
    content: `<p>Conformément à l'article L.271-1 du CCH (loi SRU du 13 décembre 2000), le Réservataire dispose d'un délai de <strong>dix (10) jours calendaires</strong> pour se rétracter, sans avoir à justifier de motifs ni à supporter de pénalités. Ce délai court à compter du lendemain de la première présentation de la lettre recommandée avec accusé de réception lui notifiant le présent contrat, ou de sa remise en main propre contre récépissé daté et signé. La rétractation s'exerce par lettre recommandée avec accusé de réception adressée au Réservant à l'adresse de son siège indiqué en page 1. En cas de rétractation dans ce délai, l'intégralité des sommes versées sera restituée au Réservataire dans un délai maximum de vingt et un (21) jours.</p>`,
  },

  {
    id: 'clause_vefa_contrat_CONTRAT_COND_SUSP_PRET_v1',
    secteur: 'IMM', key: 'CONTRAT_COND_SUSP_PRET', version: 1,
    label: 'Condition suspensive d\'obtention de prêt (L.313-41)',
    content: `<p>Le présent contrat est conclu sous la condition suspensive d'obtention par le Réservataire du ou des prêts destinés à financer l'acquisition, conformément aux articles L.313-40 et suivants du Code de la consommation. Le Réservataire s'oblige à déposer au minimum deux (2) demandes de prêt auprès d'établissements bancaires distincts dans un délai de quinze (15) jours à compter de la signature. À défaut d'obtention dans les conditions et délais ci-dessous indiqués, le présent contrat sera résolu de plein droit et les sommes versées intégralement restituées dans un délai de vingt et un (21) jours. Si le Réservataire renonce à recourir à un emprunt, il doit en faire la déclaration manuscrite expresse en marge du présent contrat.</p>`,
  },

  {
    id: 'clause_vefa_contrat_CONTRAT_COND_SUSP_AUTRES_v1',
    secteur: 'IMM', key: 'CONTRAT_COND_SUSP_AUTRES', version: 1,
    label: 'Conditions suspensives complémentaires',
    content: `<p>Le présent contrat est en outre conclu sous les conditions suspensives suivantes, dont la défaillance entraînera la résolution de plein droit du contrat et la restitution intégrale des sommes versées :</p>
    <ul class="items">
      <li>Obtention par le Réservant du permis de construire purgé de tout recours administratif et tiers (délai de retrait administratif et de recours contentieux des tiers expirés) ;</li>
      <li>Obtention de la garantie financière d'achèvement (GFA) extrinsèque émise par un établissement habilité avant la signature de l'acte authentique de vente ;</li>
      <li>Constatation par le notaire de l'absence de servitudes, hypothèques ou inscriptions de nature à rendre la vente impossible ou à en altérer significativement la consistance ;</li>
      <li>Absence de découverte, lors des sondages ou études complémentaires, de pollution du sol ou de risques naturels non identifiés à ce jour rendant le projet inexécutable.</li>
    </ul>`,
  },

  {
    id: 'clause_vefa_contrat_CONTRAT_LIVRAISON_v1',
    secteur: 'IMM', key: 'CONTRAT_LIVRAISON', version: 1,
    label: 'Livraison & pénalités de retard',
    content: `<p>La livraison du bien interviendra à la date prévisionnelle indiquée ci-dessous. Cette date pourra être reportée du fait de causes légitimes de suspension du délai d'exécution (intempéries au sens de la profession, force majeure, défaillance d'entreprise, recours administratif ou contentieux retardant le chantier). Toute prolongation justifiée fera l'objet d'une notification écrite au Réservataire. En cas de retard imputable au Réservant et non couvert par une cause légitime de suspension, des pénalités de retard sont stipulées au profit du Réservataire dans les termes ci-dessous, sans préjudice de la possibilité pour ce dernier de mettre en œuvre les sanctions du droit commun de la vente.</p>`,
  },

  // ── Page 6 — Garanties, litiges, validation ──────────────────
  {
    id: 'clause_vefa_contrat_CONTRAT_GARANTIES_LEGALES_v1',
    secteur: 'IMM', key: 'CONTRAT_GARANTIES_LEGALES', version: 1,
    label: 'Garanties légales',
    content: `<p>Le Réservant rappelle qu'à compter de la réception des travaux par le Réservataire, ce dernier bénéficiera de plein droit des garanties légales attachées à la vente d'immeuble à construire :</p>
    <ul class="items">
      <li><strong>Garantie de parfait achèvement (1 an)</strong> — Art. 1792-6 du Code civil : réparation de tous désordres signalés à la réception ou apparus pendant l'année qui suit.</li>
      <li><strong>Garantie biennale de bon fonctionnement (2 ans)</strong> — Art. 1792-3 du Code civil : éléments d'équipement dissociables du gros œuvre.</li>
      <li><strong>Garantie décennale (10 ans)</strong> — Art. 1792 et 1792-2 du Code civil : dommages compromettant la solidité de l'ouvrage ou le rendant impropre à sa destination.</li>
      <li><strong>Assurance dommages-ouvrage</strong> — Art. L.242-1 du Code des assurances : préfinancement des réparations relevant de la garantie décennale.</li>
      <li><strong>Garantie financière d'achèvement (GFA)</strong> — Art. L.261-10-1 CCH : achèvement de l'immeuble en cas de défaillance du promoteur.</li>
    </ul>`,
  },

  {
    id: 'clause_vefa_contrat_CONTRAT_LITIGES_DROIT_v1',
    secteur: 'IMM', key: 'CONTRAT_LITIGES_DROIT', version: 1,
    label: 'Litiges & droit applicable',
    content: `<p>Le présent contrat est régi par le droit français. À défaut de résolution amiable, tout litige né de l'interprétation ou de l'exécution des présentes sera porté devant le tribunal judiciaire territorialement compétent au regard de la situation de l'immeuble. Le Réservataire est informé de la possibilité de recourir à un médiateur de la consommation, conformément aux articles L.612-1 et suivants du Code de la consommation, préalablement à toute action judiciaire.</p>`,
  },

  {
    id: 'clause_vefa_contrat_CONTRAT_AVERTISSEMENT_VALIDATION_v1',
    secteur: 'IMM', key: 'CONTRAT_AVERTISSEMENT_VALIDATION', version: 1,
    label: 'Avertissement final — Validation notariale',
    content: `<div class="warning-box" style="margin-top:18pt;"><p><strong>⚠ Validation notariale impérative :</strong> Le présent document constitue un modèle indicatif généré par KEYSTONE OS. Il ne se substitue en aucun cas à l'office du notaire qui demeure seul compétent pour authentifier l'engagement des parties et établir l'acte définitif de vente. Avant toute signature, ce contrat doit être <strong>examiné, validé et le cas échéant complété par le notaire instrumentaire désigné en page 1</strong>, qui veillera à l'adaptation des clauses au cas d'espèce et au respect intégral des dispositions légales applicables à la date de signature.</p></div>`,
  },

];
