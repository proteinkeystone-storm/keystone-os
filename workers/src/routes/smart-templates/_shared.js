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
 * Valide une URL d'image (logo, visuel). Accepte :
 *   1. http(s)://...
 *   2. data:image/(png|jpeg|jpg|gif|svg+xml|webp);base64,... (upload local
 *      via le widget frontend type='image')
 * Refuse explicitement data:text/html, data:application/javascript, file:,
 * javascript:, vbscript: etc. → vecteurs XSS / SSRF.
 * Retourne '' si invalide pour faciliter le test ternaire dans le HTML.
 */
export function safeUrl(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  // Cas 1 : URL HTTP(S)
  if (/^https?:\/\//i.test(s)) {
    return s.replace(/["'<>]/g, '');
  }
  // Cas 2 : data:image/... uniquement (whitelist explicite des subtypes
  // image safe). Le pattern impose ;base64, pour rejeter les variantes
  // exotiques (charset=, etc.) qui ouvriraient des trous XSS.
  if (/^data:image\/(png|jpe?g|gif|svg\+xml|webp);base64,[A-Za-z0-9+/=]+$/i.test(s)) {
    return s;
  }
  return '';
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
 * "Propulsé par Keystone Smart QR" + lien vie privée.
 * Tous les templates V4 doivent l'afficher (cohérence + Soleau).
 */
export function renderKeystoneFoot() {
  return `<p class="sq-foot">Propulsé par Keystone Smart QR · <a href="/sdqr-privacy">Vie privée</a></p>`;
}

/**
 * V4.3 UX (2026-05-26) — Script inline qui génère un bon de gain
 * téléchargeable au format PNG via Canvas 2D. Appelle window.downloadWinPng
 * (à invoquer depuis le bouton du template) pour produire et télécharger
 * une image 800×500 avec : gradient fond + logo brand + nom marque +
 * code en gros monospace + message + date + mention vérification.
 *
 * Arguments injectés au render-time (depuis renderHTML) :
 *   - nomMarque : string (déjà escapée pour HTML mais on s'en moque côté canvas)
 *   - logoUrl   : string (https:// ou data:image/...) ou ''
 *   - accent    : string couleur hex
 */
export function renderWinPngScript(nomMarque, logoUrl, accent, bgImage = '') {
  // Tout est encodé en JSON pour échapper proprement les quotes/specials
  // sans risque d'injection (les valeurs viennent de safeColor/safeUrl/escHtml).
  return `<script>
(() => {
  const PNG_NOM    = ${JSON.stringify(nomMarque)};
  const PNG_LOGO   = ${JSON.stringify(logoUrl)};
  const PNG_ACCENT = ${JSON.stringify(accent)};
  const PNG_BG     = ${JSON.stringify(bgImage)};

  async function loadImage(src) {
    if (!src) return null;
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload  = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  function fmtDate() {
    const d = new Date();
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
         + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  window.downloadWinPng = async function(winCode, messageGain) {
    const W = 800, H = 500;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    // 1. Fond gradient sombre + halo accent
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#0e141b');
    bg.addColorStop(1, '#1a2331');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // 1b. V4.6 — Image de fond du client (cover) + voile sombre pour garder
    //     code + message lisibles. URL externe sans CORS peut tainter le
    //     canvas (toBlob échoue) ; l'upload local data URI est le cas nominal.
    const bgImg = await loadImage(PNG_BG);
    if (bgImg) {
      const cover = Math.max(W / bgImg.width, H / bgImg.height);
      const iw = bgImg.width * cover, ih = bgImg.height * cover;
      ctx.drawImage(bgImg, (W - iw) / 2, (H - ih) / 2, iw, ih);
      ctx.fillStyle = 'rgba(7,9,13,.72)';
      ctx.fillRect(0, 0, W, H);
    }

    const halo = ctx.createRadialGradient(W/2, H/2, 50, W/2, H/2, 380);
    halo.addColorStop(0, PNG_ACCENT + '55');
    halo.addColorStop(1, PNG_ACCENT + '00');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, H);

    // 2. Bordure dorée
    ctx.strokeStyle = PNG_ACCENT;
    ctx.lineWidth = 3;
    ctx.strokeRect(16, 16, W - 32, H - 32);
    ctx.strokeStyle = PNG_ACCENT + '55';
    ctx.lineWidth = 1;
    ctx.strokeRect(24, 24, W - 48, H - 48);

    // 3. Logo brand (en haut à gauche si dispo)
    const logo = await loadImage(PNG_LOGO);
    if (logo) {
      const maxH = 70, maxW = 180;
      const ratio = Math.min(maxH / logo.height, maxW / logo.width, 1);
      const lw = logo.width * ratio, lh = logo.height * ratio;
      ctx.drawImage(logo, 50, 50, lw, lh);
    }

    // 4. Nom marque (top right)
    ctx.fillStyle = PNG_ACCENT;
    ctx.font = 'bold 32px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(PNG_NOM || 'Keystone', W - 50, 60);

    // 5. Label "BON DE GAIN"
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 14px -apple-system, sans-serif';
    ctx.letterSpacing = '0.2em';
    ctx.textAlign = 'center';
    ctx.fillText('BON DE GAIN', W / 2, 175);

    // 6. Code en GROS monospace (signature visuelle forte)
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 60px "SF Mono", Menlo, Consolas, monospace';
    ctx.fillText(winCode, W / 2, 230);

    // 7. Message gain (multi-line wrap simple)
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '18px -apple-system, sans-serif';
    const msg = (messageGain || '').toString().slice(0, 240);
    const words = msg.split(' ');
    const maxWidth = W - 120;
    let line = '', y = 330;
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, W / 2, y);
        y += 24;
        line = word;
        if (y > 410) break; // max 4 lignes
      } else {
        line = test;
      }
    }
    if (line && y <= 410) ctx.fillText(line, W / 2, y);

    // 8. Footer : date d'émission uniquement (la mention vérification a
    //    été retirée car illisible et redondante — le rescan du QR
    //    original reste la preuve définitive).
    ctx.fillStyle = '#64748b';
    ctx.font = '13px -apple-system, sans-serif';
    ctx.fillText('Émis le ' + fmtDate(), W / 2, H - 55);

    // 9. Téléchargement
    canvas.toBlob((blob) => {
      const a = document.createElement('a');
      a.href     = URL.createObjectURL(blob);
      a.download = 'bon-' + winCode + '.png';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 1000);
    }, 'image/png', 0.95);
  };
})();
</script>`;
}
