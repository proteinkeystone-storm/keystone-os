/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — PromptEngine Demo (Sprint P2.1)
   Helpers console pour valider la chaîne complète :
   vault → PromptEngine → Worker proxy → Anthropic API → réponse.

   Usage console (window.promptEngineDemo) :

     // 1. Liste les engines disponibles + état clé API
     promptEngineDemo.checkSetup()

     // 2. Liste les tâches atomiques disponibles
     promptEngineDemo.listTasks()

     // 3. Test rédaction "Spécificités VEFA Bandol Vue Mer"
     await promptEngineDemo.testRedactSpecificites()

     // 4. Appel libre
     await promptEngineDemo.testTopic('Rédige une note sur l\'isolation phonique entre logements collectifs')

   Prérequis : ta clé API Anthropic (sk-ant-...) doit être saisie dans
   Réglages → Vault, ou directement :
     localStorage.setItem('ks_api_anthropic', 'sk-ant-...')
   ═══════════════════════════════════════════════════════════════ */

import { promptEngine } from './prompt-engine.js';

export const promptEngineDemo = {

  /** Vérifie l'état du setup avant d'essayer d'appeler une IA. */
  checkSetup() {
    const engines = promptEngine.listEngines();
    const tasks   = promptEngine.listTasks();
    console.group('[prompt-engine] Setup check');
    console.table(engines);
    console.log('Tasks:', tasks.map(t => t.id).join(', '));
    const missing = engines.filter(e => !e.hasApiKey).map(e => e.provider);
    if (missing.length) {
      console.warn(`⚠ Clés API manquantes : ${missing.join(', ')}\n→ Réglages → Vault, ou localStorage.setItem('ks_api_<provider>', '...')`);
    } else {
      console.info('✓ Toutes les clés API requises sont en place.');
    }
    console.groupEnd();
    return { engines, tasks };
  },

  listTasks() {
    return promptEngine.listTasks();
  },

  /** Test cas réel : rédige les "Spécificités" d'un T3 Bandol Vue Mer. */
  async testRedactSpecificites() {
    return this.testTopic(
      'Les spécificités et équipements d\'un appartement T3 neuf à Bandol avec vue mer',
      'Programme : Bandol Vue Mer. Surface : 72 m². Orientation : Sud-Ouest. ' +
      'Terrasse de 18 m² avec brise-vue végétal et arrosage automatique. ' +
      'Domotique connectée préinstallée (volets, chauffage, éclairage). ' +
      'RE2020 Seuil 2031. Vue panoramique sud-ouest. Plancher chauffant électrique.',
    );
  },

  /** Test libre — passe ton propre sujet. */
  async testTopic(topic, details = '') {
    console.log(`[demo] → Claude rédige : "${topic}"`);
    const t0 = performance.now();
    const result = await promptEngine.run({
      task   : 'redact-section',
      engine : 'claude',
      context: { topic, details },
    });
    const dt = ((performance.now() - t0) / 1000).toFixed(2);
    console.log(`[demo] ✓ ${dt}s — ${result.usage?.input_tokens || '?'} in / ${result.usage?.output_tokens || '?'} out tokens`);
    console.log('\n--- Réponse ---\n' + result.text + '\n---------------\n');
    return result;
  },
};

if (typeof window !== 'undefined') {
  window.promptEngineDemo = promptEngineDemo;
}
