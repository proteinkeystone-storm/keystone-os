/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Seed Clauses VEFA v2 (Sprint Correctif)
   Version "AGNOSTIQUE" des clauses techniques problématiques.

   Pourquoi v2 ?
   ─────────────────────────────────────────────────────────────
   Les clauses v1 contenaient des spécifications techniques figées
   (ex: "plancher chauffant électrique", "PSE graphité") qui
   contredisaient les choix du formulaire utilisateur. Un audit
   contradictoire (Gemini) a relevé ces incohérences.

   Stratégie v2 :
   ─────────────────────────────────────────────────────────────
   Les clauses techniques renvoient désormais au tableau de
   synthèse de la PAGE 1 pour la solution retenue, et fournissent
   uniquement les exigences réglementaires, DTU et normes qui
   s'appliquent QUELLE QUE SOIT la solution choisie.

   Ne sont incluses ici que les 10 clauses problématiques (les
   autres restent en v1, fillClauses() prend la version max).

   Re-seed via : Admin → La Fabrique → Clauses → ↻ Re-seed VEFA v2
   ═══════════════════════════════════════════════════════════════ */

export const VEFA_CLAUSES_V2 = [

  // ── Page 2 — Maçonnerie & Façades ──────────────────────────
  {
    id: 'clause_vefa_MACONNERIE_v2',
    secteur: 'IMM', key: 'MACONNERIE', version: 2,
    label: 'Maçonnerie & Façades (agnostique v2)',
    content: `<ul class="items">
      <li>Maçonnerie de remplissage en blocs béton creux ou briques de terre cuite selon configuration et prescriptions architecturales.</li>
      <li>Isolation thermique par l'extérieur (ITE) ou par l'intérieur selon la solution d'isolation retenue — <em>type d'isolant indiqué en Page 1 (Synthèse)</em>. Système enduit ou bardage selon le projet architectural.</li>
      <li>Enduit de façade minéral teinté dans la masse, finition grain fin — couleurs conformes aux prescriptions architecturales du PLU local.</li>
      <li>Refends intérieurs : briques ou béton armé selon les zones fonctionnelles et l'étude structurelle.</li>
    </ul>`,
  },

  // ── Page 2 — Isolation thermique ───────────────────────────
  {
    id: 'clause_vefa_ISOLATION_THERMIQUE_v2',
    secteur: 'IMM', key: 'ISOLATION_THERMIQUE', version: 2,
    label: 'Isolation thermique (agnostique v2)',
    content: `<div class="info-box">
      <p><strong>Solution retenue :</strong> Le type d'isolation thermique mis en œuvre pour ce lot est précisé en <strong>Page 1 (Synthèse RE 2020)</strong>. La solution répond aux exigences de la RE 2020 et de l'étude thermique du projet.</p>
    </div>
    <ul class="items">
      <li>Résistance thermique R ≥ 6 m²·K/W en toiture, R ≥ 4 m²·K/W en façade (valeurs minimales conformes à la RE 2020).</li>
      <li>Ponts thermiques traités par rupteurs aux planchers et refends, conformément aux règles de calcul Th-BCE 2020.</li>
      <li>Étanchéité à l'air de l'enveloppe mesurée à la réception (test d'infiltrométrie obligatoire RE 2020) — objectif Q4 ≤ 0,6 m³/h/m².</li>
      <li>Plancher bas (sur vide sanitaire ou terre-plein) doublé avec un isolant adapté à l'usage.</li>
      <li>Combles et toiture : isolation continue, épaisseur dimensionnée par l'étude thermique.</li>
    </ul>`,
  },

  // ── Page 2 — Menuiseries extérieures ───────────────────────
  {
    id: 'clause_vefa_MENUISERIES_EXT_v2',
    secteur: 'IMM', key: 'MENUISERIES_EXT', version: 2,
    label: 'Menuiseries extérieures (agnostique v2)',
    content: `<ul class="items">
      <li>Fenêtres et baies vitrées en aluminium ou PVC à rupture de pont thermique, selon la solution constructive retenue et le PLU local.</li>
      <li>Vitrage isolant à lame d'argon, traitement faible émissivité — Ug ≤ 1,1 W/m²·K. Traitement Sécurit en zones d'allège et de plain-pied.</li>
      <li>Coefficient de transmission thermique des menuiseries : Uw ≤ 1,3 W/m²·K conformément aux exigences RE 2020.</li>
      <li>Portes-fenêtres coulissantes ou à la française selon les pièces — quincaillerie thermolaquée.</li>
      <li>Porte d'entrée blindée, isolation acoustique Rw ≥ 40 dB, seuil isolé anti-pont thermique.</li>
    </ul>`,
  },

  // ── Page 2 — Protections solaires ──────────────────────────
  {
    id: 'clause_vefa_PROTECTIONS_SOLAIRES_v2',
    secteur: 'IMM', key: 'PROTECTIONS_SOLAIRES', version: 2,
    label: 'Protections solaires (agnostique v2)',
    content: `<ul class="items">
      <li>Dispositif de protection solaire retenu : <em>voir Page 1 (Synthèse — Confort d'été)</em>. Conforme aux exigences RE 2020 pour atteindre un indicateur DH &lt; 1 250 h.</li>
      <li>Mise en œuvre coordonnée avec les menuiseries extérieures : coffre, tablier ou lames orientables intégrés selon le dispositif.</li>
      <li>Commandes individuelles par interrupteur mural — pré-câblage pour pilotage domotique éventuel.</li>
      <li>Coefficient de réduction solaire Fc conforme à l'étude thermique du projet, validé en phase RE 2020.</li>
      <li>Débords de toiture / casquettes architecturales sur les façades exposées en complément, selon le plan masse.</li>
    </ul>

    <div class="perf-row">
      <span class="perf-label">Indicateur RE 2020 — Confort d'été visé</span>
      <span class="perf-val" style="color:var(--gold);">DH &lt; 1 250 h</span>
      <span class="badge-green">✔ Conforme RE 2020</span>
    </div>`,
  },

  // ── Page 3 — Chauffage ─────────────────────────────────────
  {
    id: 'clause_vefa_CHAUFFAGE_v2',
    secteur: 'IMM', key: 'CHAUFFAGE', version: 2,
    label: 'Chauffage (agnostique v2)',
    content: `<div class="info-box">
      <p><strong>Système retenu :</strong> Le mode de chauffage de ce lot est précisé en <strong>Page 1 (Synthèse RE 2020)</strong>. Il s'inscrit dans une logique d'énergie décarbonée conforme aux exigences RE 2020 (limitation des émissions de CO₂ en phase d'usage).</p>
    </div>
    <ul class="items">
      <li>Dimensionnement du système réalisé par étude thermique selon les déperditions et la zone climatique du projet.</li>
      <li>Émetteurs adaptés au système (plancher chauffant, radiateurs, ventilo-convecteurs, etc.) — détail selon le lot et la configuration.</li>
      <li>Régulation par thermostat programmable, gestion zone par zone (séjour, chambres, salle de bain) — pré-équipement domotique.</li>
      <li>Comptage individuel des consommations énergétiques (RT/RE 2020 — décompte loi LME).</li>
      <li>Disjoncteurs / protections dédiés selon le tableau électrique du lot.</li>
      <li>Consommation prévisionnelle conforme classe énergétique annoncée en Page 1 (≤ 50 kWhEP/m²/an pour la classe A).</li>
    </ul>`,
  },

  // ── Page 3 — ECS ───────────────────────────────────────────
  {
    id: 'clause_vefa_ECS_v2',
    secteur: 'IMM', key: 'ECS', version: 2,
    label: 'Eau Chaude Sanitaire (agnostique v2)',
    content: `<ul class="items">
      <li>Production d'eau chaude sanitaire conforme à la solution énergétique retenue pour le lot (cf. Page 1).</li>
      <li>Volume du ballon dimensionné selon la composition du logement et le nombre d'habitants prévisionnels.</li>
      <li>Si chauffe-eau thermodynamique : COP ≥ 3,0, captation sur air intérieur ou extérieur selon configuration technique.</li>
      <li>Si réseau de chaleur ou solution collective : sous-station individuelle avec compteur de calories.</li>
      <li>Groupe de sécurité, soupape de sûreté et réducteur de pression conformes DTU 60.1.</li>
      <li>Calorifugeage des tuyauteries d'eau chaude selon RT/RE 2020 (classe 3 minimum).</li>
    </ul>`,
  },

  // ── Page 3 — VMC ───────────────────────────────────────────
  {
    id: 'clause_vefa_VMC_v2',
    secteur: 'IMM', key: 'VMC', version: 2,
    label: 'VMC (agnostique v2)',
    content: `<ul class="items">
      <li>Ventilation mécanique contrôlée conforme aux exigences RE 2020 et à l'arrêté du 24 mars 1982 modifié.</li>
      <li>Type de VMC (simple flux hygroréglable B ou double flux avec récupérateur de chaleur) défini par l'étude thermique selon les performances visées.</li>
      <li>Si double flux : rendement de récupération ≥ 85 %, filtration G4/F7, centrale en volume technique.</li>
      <li>Bouches d'insufflation/extraction réparties selon les pièces de vie et pièces humides — équilibrage des débits selon DTU 68.3.</li>
      <li>Maintenance simplifiée : trappes de visite accessibles, filtres remplaçables par l'occupant.</li>
    </ul>`,
  },

  // ── Page 4 — Sol Pièces de Vie ─────────────────────────────
  {
    id: 'clause_vefa_SOL_PIECES_VIE_v2',
    secteur: 'IMM', key: 'SOL_PIECES_VIE', version: 2,
    label: 'Sol pièces de vie (agnostique v2)',
    content: `<ul class="items">
      <li>Revêtement de sol retenu pour les pièces de vie : <em>voir Page 1 (Synthèse — Revêtements sols)</em>.</li>
      <li>Pose sur chape ciment lissée ou ragréage selon le revêtement, conformément au DTU 52.1 (carrelage) ou DTU 51.2 (parquet) ou DTU correspondant.</li>
      <li>Plinthes assorties au revêtement, hauteur 8 cm minimum, finition propre aux raccords.</li>
      <li>Seuils de porte en profilé aluminium ou en accord matériau au passage des huisseries.</li>
      <li>Qualité adaptée à un usage résidentiel intensif (PEI 4 minimum pour le carrelage, usage 23 minimum pour les sols stratifiés).</li>
      <li>Teinte et référence définitives choisies par l'acquéreur parmi le catalogue proposé par le promoteur (selon offre commerciale).</li>
    </ul>`,
  },

  // ── Page 4 — Sol Chambres ──────────────────────────────────
  {
    id: 'clause_vefa_SOL_CHAMBRES_v2',
    secteur: 'IMM', key: 'SOL_CHAMBRES', version: 2,
    label: 'Sol chambres (agnostique v2)',
    content: `<ul class="items">
      <li>Revêtement de sol des chambres : selon le choix retenu pour ce lot (cf. Page 1 — Revêtements sols), avec possibilité d'option différenciée chambres / pièces de vie selon l'offre du promoteur.</li>
      <li>Si parquet : finition vitrifiée mat, pose flottante ou collée sur sous-couche acoustique, conformément au DTU 51.2.</li>
      <li>Si carrelage : grès cérame rectifié, pose sur chape ciment, conformément au DTU 52.1.</li>
      <li>Plinthes assorties au revêtement, peintes en blanc ou teinte naturelle au choix de l'acquéreur.</li>
      <li>Sous-couche acoustique conforme à la réglementation acoustique en vigueur (NRA 2000).</li>
    </ul>`,
  },

  // ── Page 4 — Cuisine ───────────────────────────────────────
  {
    id: 'clause_vefa_CUISINE_v2',
    secteur: 'IMM', key: 'CUISINE', version: 2,
    label: 'Cuisine (agnostique v2)',
    content: `<div class="info-box">
      <p><strong>Niveau d'équipement retenu :</strong> Le degré d'équipement de la cuisine pour ce lot est précisé en <strong>Page 1 (Synthèse — Cuisine)</strong>. Le détail des prestations livrées dépend de cette option et figure dans l'annexe contractuelle dédiée.</p>
    </div>
    <ul class="items">
      <li><strong>Attentes techniques (présentes dans tous les cas) :</strong> alimentation eau froide / eau chaude avec robinets d'arrêt, siphon d'évacuation, prise 20A dédiée (plaque), prises 16A (lave-vaisselle, électroménager), circuit éclairage dédié, hotte aspirante.</li>
      <li><strong>Si "Entièrement équipée"</strong> (cf. Page 1) : meubles hauts et bas, plan de travail, évier inox, robinetterie mitigeuse, plaque vitrocéramique ou induction, hotte, four encastrable, réfrigérateur, lave-vaisselle. Configuration et finitions précisées au contrat de réservation.</li>
      <li><strong>Si "Partiellement équipée (attentes)"</strong> (cf. Page 1) : attentes techniques uniquement, l'acquéreur conserve le libre choix de son cuisiniste.</li>
      <li>Revêtement de sol identique aux pièces de vie (cf. clause Sol Pièces de Vie).</li>
      <li>Faïence crédence : 60 cm de hauteur sur zone de préparation (fournie, finitions à préciser au contrat).</li>
    </ul>`,
  },

];
