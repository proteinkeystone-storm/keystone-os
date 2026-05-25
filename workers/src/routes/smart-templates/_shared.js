// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Templates · helpers partagés (V4)
// ───────────────────────────────────────────────────────────────────
// Helpers communs aux templates V4 d'expérience d'attente interactive.
// Toute la sécurité XSS / validation d'input passe par ici.
//
// Pourquoi un fichier _shared :
//   • V4 = 7 templates, escapes répétés → factorisation dès V4.1
//   • Centralise les politiques de safe-input (URL, couleur, datetime)
//   • Permet le test unitaire des fonctions critiques
//
// Référence brief : BRIEF_SMART_QR_V4_TEMPLATES_INTERACTIFS.md §
//   "Patterns techniques communs aux 7 templates"
// ══════════════════════════════════════════════════════════════════

/**
 * Escape une string pour insertion dans du HTML (texte ou attribut).
 * Pattern unique inspiré OWASP : remplace les 5 caractères dangereux.
 */
export function escHtml(s) {
  return String(s == null ? '' : s).replace(/[<>&"']/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

/**
 * Valide une URL http(s) propriétaire (logo, visuel). Refuse javascript:,
 * data:, file:, vbscript: etc. Retourne '' si invalide pour faciliter le
 * test ternaire dans le HTML (ex: `${safeUrl(x) ? `<img src="${safeUrl(x)}">` : ''}`).
 */
export function safeUrl(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) return '';
  // Re-escape les caractères qui casseraient un attribut HTML.
  return s.replace(/["'<>]/g, '');
}

/**
 * Valide une couleur hex (#rgb ou #rrggbb). Fallback indigo Keystone si
 * invalide ou absent (--acc historique).
 */
export function safeColor(c, fallback = '#7c8af9') {
  const s = String(c || '').trim();
  if (/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(s)) return s;
  return fallback;
}

/**
 * Parse une date ISO/datetime-local en ms timestamp. Retourne NaN si
 * invalide pour permettre Number.isFinite() côté caller.
 */
export function safeDate(d) {
  if (!d) return NaN;
  const t = new Date(d).getTime();
  return Number.isFinite(t) ? t : NaN;
}

/**
 * Fragment HTML standard à insérer en fin de card : mention discrète
 * "Contenu généré contextuellement par Keystone" + lien vie privée.
 * Tous les templates V4 doivent l'afficher (cohérence + Soleau).
 */
export function renderKeystoneFoot() {
  return `<p class="sq-foot">Contenu généré contextuellement par Keystone · <a href="/sdqr-privacy">Vie privée</a></p>`;
}

/**
 * Script JS inline standard qui fetch /api/smartqr/generate-interstitial
 * et révèle le slot IA quand la réponse arrive. À insérer en bas de page
 * dans chaque template V4. Variables exposées :
 *   - window.SQ_AI_READY = promise qui résout {title, phrase} ou rejette
 *   - event 'sq:ai-ready' dispatché sur document avec detail = {title, phrase}
 * Le template décide quand révéler (souvent : après que la séquence
 * motion graphique est terminée).
 */
export function renderAiFetchScript(safeShort) {
  return `<script>
(() => {
  const SHORT = ${JSON.stringify(safeShort)};
  window.SQ_AI_READY = (async () => {
    try {
      const r = await fetch('/api/smartqr/generate-interstitial', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ short_id: SHORT }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      const detail = {
        title:  (data && data.title)  || 'Bienvenue',
        phrase: (data && data.phrase) || '',
      };
      document.dispatchEvent(new CustomEvent('sq:ai-ready', { detail }));
      return detail;
    } catch (e) {
      console.warn('[smart-qr]', e);
      const fallback = { title: 'Votre destination est prête', phrase: 'Merci d\\'avoir scanné. Continuons.' };
      document.dispatchEvent(new CustomEvent('sq:ai-error', { detail: fallback }));
      throw e;
    }
  })();
})();
</script>`;
}
