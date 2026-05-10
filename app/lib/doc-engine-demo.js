/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — DocEngine Demo (Sprint 1.2)
   Helpers console pour valider la chaîne complète DataFabric →
   DocEngine → Paged.js → window.print().

   Usage console (window.docEngineDemo) :

     // 1. Seed des 29 clauses VEFA en D1 (idempotent)
     await docEngineDemo.seedClauses()

     // 2. Inspect : clauses présentes en D1
     await docEngineDemo.listClauses()

     // 3. Génération HTML rempli (string, pour debug)
     const { html, missing } = await docEngineDemo.renderTestVefa('html')

     // 4. Preview paginée A4 (ouvre nouvelle fenêtre + Paged.js)
     await docEngineDemo.renderTestVefa('preview')

     // 5. Impression PDF (ouvre fenêtre + déclenche print dialog)
     await docEngineDemo.renderTestVefa('print')

     // 6. Reset clauses (purge complète)
     await docEngineDemo.resetClauses()
   ═══════════════════════════════════════════════════════════════ */

import { dataFabric } from './data-fabric.js';
import { docEngine }  from './doc-engine.js';
import { VEFA_CLAUSES_V1 } from './doc-templates/vefa-clauses-seed.js';

// Jeu de test : un programme fictif "Bandol Vue Mer T3".
// Mappe sur les variables [[VAR]] du template vefa-notice-v1.
const TEST_VARS = {
  PROGRAMME           : 'Bandol Vue Mer',
  DEPARTEMENT         : 'Var (83)',
  REGION              : "Provence-Alpes-Côte d'Azur",
  TYPE_LOT            : 'Appartement T3',
  SURFACE             : '72',
  ETAGE               : '3ème étage',
  ORIENTATION         : 'Sud-Ouest',
  RE2020_SEUIL        : 'Seuil 2031',
  RE2020_OBJECTIF     : 'Objectif bas carbone',
  IC_CONSTRUCTION_MAX : '580',
  CHAUFFAGE           : 'Plancher chauffant électrique',
  CONFORT_ETE         : 'Volets roulants motorisés — Protections solaires extérieures',
  ISOLATION           : 'Synthétique — PSE (polystyrène expansé) + Laine de verre',
  SOLS                : 'Carrelage grand format (pièces de vie) · Parquet (chambres)',
  CUISINE             : 'Partiellement équipée — Attentes plomberie / électricité',
  ANNEXES             : 'Cave privative + Parking IRVE (pré-équipement borne recharge)',
  REF_DOCUMENT        : 'NDC-BVM-2026-01',
  DATE_EDITION        : '2026',
  VERSION_DOC         : '1.0',
  VENDEUR             : 'SCCV Les Jardins du Midi — SIREN 123 456 789',
  NOTAIRE             : 'Étude Maître Dupont, Toulon',
  PERMIS              : 'PC 083 020 25 H 0042 — délivré le 12/03/2025',
  LIVRAISON           : 'T4 2027',
  ASSUREUR_DO         : 'AXA Construction — N° contrat 2025/DO/8842',
  GFA_ETABLISSEMENT   : 'Crédit Agricole Provence — engagement 4521',
  SPECIFICITES_BLOC   : `<ul class="items">
    <li>Vue mer panoramique sud-ouest depuis le séjour et la terrasse principale.</li>
    <li>Terrasse de 18 m² avec brise-vue végétal et arrosage automatique intégré.</li>
    <li>Domotique connectée préinstallée (volets, chauffage, éclairage) compatible HomeKit / Google Home.</li>
  </ul>`,
};

export const docEngineDemo = {

  /**
   * Seed des 29 clauses VEFA en D1 (via dataFabric.write).
   * Idempotent grâce aux ids déterministes.
   */
  async seedClauses() {
    const before = (await dataFabric.list('clauses')).length;
    let written = 0;
    for (const clause of VEFA_CLAUSES_V1) {
      await dataFabric.write('clauses', clause);
      written++;
    }
    // Attendre la fin de la sync (tout passe par la sync queue).
    await dataFabric.sync();
    const after = (await dataFabric.list('clauses')).length;
    console.info(`[demo] seedClauses: ${written} clauses upsertées (avant: ${before}, après: ${after})`);
    return { written, before, after };
  },

  /**
   * Inspecte les clauses présentes localement (cache IDB).
   */
  async listClauses() {
    const list = await dataFabric.list('clauses');
    return list.map(c => ({
      key     : c.key,
      version : c.version,
      label   : c.label,
      bytes   : (c.content || '').length,
    }));
  },

  /**
   * Render le template VEFA avec les variables de test + clauses BDD.
   * @param {'html'|'preview'|'print'} mode
   */
  async renderTestVefa(mode = 'preview') {
    const result = await docEngine.render({
      templateId : 'vefa-notice-v1',
      variables  : TEST_VARS,
      mode,
    });
    if (result.missing?.length) {
      console.warn('[demo] marqueurs non résolus :', result.missing);
    } else {
      console.info('[demo] tous les marqueurs résolus ✓');
    }
    return result;
  },

  /**
   * Purge toutes les clauses du tenant (utile pour repartir propre).
   */
  async resetClauses() {
    const list = await dataFabric.list('clauses');
    for (const c of list) {
      if (c.id) await dataFabric.delete('clauses', c.id);
    }
    await dataFabric.sync();
    console.info(`[demo] resetClauses: ${list.length} clauses supprimées`);
    return { deleted: list.length };
  },

  // Accès direct aux jeux de données pour adaptations console
  TEST_VARS,
  VEFA_CLAUSES_V1,
};

if (typeof window !== 'undefined') {
  window.docEngineDemo = docEngineDemo;
}
