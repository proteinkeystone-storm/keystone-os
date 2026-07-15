// Sprint 1.1 — Data Fabric (Layer 1). Import side-effect : expose
// window.dataFabric pour les artefacts et le debug console.
import './lib/data-fabric.js';
// Sprint 1.2 — DocEngine (Layer 2).
import './lib/doc-engine.js';
// Sprint P2.1 — PromptEngine (Layer 2).
import './lib/prompt-engine.js';
import { loadVault }                            from './vault.js';
import { renderDashboard, initSettings, initTools } from './ui-renderer.js';
import { initDST, initDSTAdminBridge }        from './dst.js';
import { initLockScreen }                     from './lockscreen.js';
import { loadPads, fetchRemoteCatalog, addLifetimePurchase, getToolList, getArtefactList } from './pads-loader.js';
import { runSystemCoach }                     from './system-coach.js';
import { initInbox }                          from './inbox.js';
import { loadFromCloud, saveToCloud, isCloudReady, installAutoSync } from './cloud-vault.js';
// Garde-fou anti-session-coincée (incident 2026-06-14) : déconnexion propre
// + détection « connecté mais vide ». Side-effect : expose window.ksCleanLogout.
import { ksCleanLogout, ksWhoami } from './lib/session-guard.js';
import { getLicenceStatus }        from './licence.js';
import { icon }                    from './lib/ui-icons.js';
// Sprint GW-1 — Ghost Writer (service réécriture transversal).
// Hook global Cmd+Shift+G + Modal Master, behind flag ks_ghostwriter (OFF par défaut).
import { initGhostwriter }                       from './ghostwriter.js';

// ═══════════════════════════════════════════════════════════════
// VERSION CHECK — auto-cleanup à chaque déploiement
// ═══════════════════════════════════════════════════════════════
// Bumper APP_VERSION à chaque déploiement qui change la structure
// localStorage / la signature des outils. Au boot, si la version
// stockée diffère, on reset les clés problématiques sans toucher
// aux préférences utilisateur (clés API, photo, nom...).
const APP_VERSION = '2026-05-04-sprint2-jwt-pbkdf2';
(() => {
    const stored = localStorage.getItem('ks_app_version');
    if (stored === APP_VERSION) return;

    // Cache inbox uniquement (peut contenir d'anciennes structures).
    localStorage.removeItem('ks_inbox_cache');
    // Sprint 2 — la clé en clair n'est plus tolérée. Si elle traîne en
    // localStorage depuis une version pré-Sprint-2, on la supprime
    // (l'utilisateur sera invité à rééactiver pour obtenir un JWT).
    localStorage.removeItem('ks_licence');
    // Flags ks_deactivated_* (outils masqués) — repartent propres.
    Object.keys(localStorage)
        .filter(k => k.startsWith('ks_deactivated_'))
        .forEach(k => localStorage.removeItem(k));

    // ⚠ Ne JAMAIS effacer ks_onboarded ni ks_owned_assets ici :
    //  • la landing page (index.html) est la source de vérité du tunnel
    //    d'onboarding — c'est elle qui les pose après activation.
    //  • Les supprimer relance un second onboarding obsolète côté /app
    //    et écrase la sélection Démo (1 outil).

    localStorage.setItem('ks_app_version', APP_VERSION);
    console.info('[Keystone] Mise à jour appliquée :', APP_VERSION);
})();

// ── Démarrage complet du dashboard ─────────────────────────────
function _boot() {
    renderDashboard();
    initSettings();
    initDST();
    initDSTAdminBridge();
    initLockScreen();
    // Inbox push (admin) — priorité P1, fetch toutes les 5 min
    initInbox();
    // Coach système — règles locales, P2, cooldown 24h, après 1.5s
    setTimeout(runSystemCoach, 1500);
    // Sprint GW-1 — Ghost Writer hook global (idempotent).
    // Le module ne déclenche rien tant que ks_ghostwriter n'est pas posé.
    initGhostwriter();
}

// ═══════════════════════════════════════════════════════════════
// GARDE-FOU « connecté mais vide » (incident 2026-06-14)
// ───────────────────────────────────────────────────────────────
// Bannière NON bloquante et fermable. Ne s'affiche QUE si :
//   • un jeton est présent (donc soi-disant connecté), et non expiré
//     (déjà garanti par le gate de app.html) ;
//   • l'utilisateur est établi (onboardé) et PAS en mode démo ;
//   • le serveur a RÉPONDU (un échec réseau ≠ session périmée) ;
//   • le compte ne résout AUCUN outil (ownedAssets === [] explicite).
// → ADMIN/MAX (accès ∞ = ownedAssets null) ne la voient JAMAIS.
// Elle offre une sortie qui MARCHE vraiment (déconnexion propre), là où
// re-saisir la licence rebouclait sur un dashboard vide.
// ═══════════════════════════════════════════════════════════════
function _checkStaleSession(vaultRes) {
    try {
        if (!isCloudReady()) return;                                      // pas de jeton
        if (localStorage.getItem('ks_onboarded') !== '1') return;         // pas un user établi
        if (localStorage.getItem('ks_is_demo') === '1') return;           // démo = vide légitime
        if (sessionStorage.getItem('ks_stale_dismissed') === '1') return; // déjà fermée ce tour
        // Le serveur doit avoir répondu : offline (reason 'network') ≠ session périmée.
        if (!vaultRes || vaultRes.reason === 'network') return;

        const status = getLicenceStatus();
        // null = accès ∞ (ADMIN/MAX) → jamais « vide ». On ne cible QUE le
        // tableau explicitement vide.
        const empty = Array.isArray(status.ownedAssets) && status.ownedAssets.length === 0;
        if (!empty) return;

        _renderStaleBanner();
    } catch (_) { /* ne jamais casser le boot pour ça */ }
}

function _escHtml(s) {
    return String(s).replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

function _renderStaleBanner() {
    if (document.getElementById('ks-stale-banner')) return;
    const wrap = document.querySelector('.main .wrap');
    if (!wrap) return;

    _injectStaleStyles();

    const who   = ksWhoami();
    const ident = (who && (who.owner || who.email))
        ? `<div class="ks-stale-ident">Compte connecté : <strong>${_escHtml(who.owner || who.email)}</strong></div>`
        : '';

    const el = document.createElement('div');
    el.id = 'ks-stale-banner';
    el.setAttribute('role', 'status');
    el.innerHTML = `
      <div class="ks-stale-ico">${icon('alert-triangle', 20)}</div>
      <div class="ks-stale-body">
        <div class="ks-stale-title">Votre session semble incomplète</div>
        <div class="ks-stale-msg">Vous êtes connecté, mais aucun outil n'apparaît. Cela arrive quand une ancienne session reste coincée dans le navigateur. Une reconnexion propre rétablit tout.</div>
        ${ident}
      </div>
      <div class="ks-stale-actions">
        <button type="button" class="ks-stale-btn ks-stale-primary" id="ks-stale-relogin">${icon('refresh', 16)} Se reconnecter proprement</button>
        <button type="button" class="ks-stale-x" id="ks-stale-dismiss" aria-label="Masquer ce message">${icon('x', 16)}</button>
      </div>`;

    const pads = wrap.querySelector('.pads-section');
    if (pads) wrap.insertBefore(el, pads); else wrap.prepend(el);

    document.getElementById('ks-stale-relogin')?.addEventListener('click', () => {
        ksCleanLogout({ reason: 'stale-banner-user' });
    });
    document.getElementById('ks-stale-dismiss')?.addEventListener('click', () => {
        try { sessionStorage.setItem('ks_stale_dismissed', '1'); } catch (_) {}
        el.remove();
    });
}

// Styles inline scopés : aucune dépendance à style.css. Le bandeau est
// volontairement « dark » indépendamment du thème → lisible sur fond clair
// comme sombre.
function _injectStaleStyles() {
    if (document.getElementById('ks-stale-style')) return;
    const css = `
#ks-stale-banner{display:flex;align-items:flex-start;gap:14px;margin:0 0 22px;padding:16px 18px;background:linear-gradient(135deg,rgba(49,46,129,.94),rgba(30,27,75,.94));border:1px solid rgba(129,140,248,.38);border-radius:16px;box-shadow:0 10px 30px rgba(15,23,42,.30);color:#e0e7ff;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',sans-serif;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);}
#ks-stale-banner .ks-stale-ico{color:#fbbf24;flex-shrink:0;margin-top:1px;}
#ks-stale-banner .ks-stale-body{flex:1;min-width:0;}
#ks-stale-banner .ks-stale-title{font-weight:800;font-size:15px;letter-spacing:-.01em;margin:0 0 3px;color:#fff;}
#ks-stale-banner .ks-stale-msg{font-size:13px;line-height:1.5;color:rgba(224,231,255,.78);}
#ks-stale-banner .ks-stale-ident{font-size:12px;margin-top:6px;color:rgba(224,231,255,.62);}
#ks-stale-banner .ks-stale-ident strong{color:#c7d2fe;font-weight:600;}
#ks-stale-banner .ks-stale-actions{display:flex;align-items:center;gap:8px;flex-shrink:0;}
#ks-stale-banner .ks-stale-btn{display:inline-flex;align-items:center;gap:7px;padding:9px 14px;border-radius:10px;cursor:pointer;font-size:13px;font-weight:600;border:none;font-family:inherit;}
#ks-stale-banner .ks-stale-primary{background:#6366f1;color:#fff;transition:background .15s;}
#ks-stale-banner .ks-stale-primary:hover{background:#818cf8;}
#ks-stale-banner .ks-stale-x{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:9px;cursor:pointer;background:rgba(255,255,255,.06);color:rgba(224,231,255,.7);border:1px solid rgba(255,255,255,.10);transition:background .15s,color .15s;}
#ks-stale-banner .ks-stale-x:hover{background:rgba(255,255,255,.12);color:#fff;}
@media (max-width:640px){#ks-stale-banner{flex-wrap:wrap;}#ks-stale-banner .ks-stale-actions{width:100%;}#ks-stale-banner .ks-stale-primary{flex:1;justify-content:center;}}
`;
    const style = document.createElement('style');
    style.id = 'ks-stale-style';
    style.textContent = css;
    document.head.appendChild(style);
}

window.addEventListener('DOMContentLoaded', async () => {
    // 0. Installe l'auto-sync localStorage → Cloud Vault dès maintenant.
    //    Toute écriture sur une PREFS_KEY (ks_kodex_draft, ks_pulsa_library,
    //    ks_active_engine, ks_user_name, ks_pad_order, ks_lock_*, etc.)
    //    déclenchera un saveToCloud debouncé. Bug racine résolu : avant,
    //    seule la modif de clé API uploadait quoi que ce soit.
    installAutoSync();

    // 1. Vault local en premier — restore préférences depuis localStorage
    loadVault();

    // Sprint C — Activation URL post-paiement (?ks_activate=O-IMM-001)
    const _p = new URLSearchParams(window.location.search);
    const _activateId = _p.get('ks_activate');
    if (_activateId) {
        addLifetimePurchase(_activateId);
        const _clean = new URL(window.location.href);
        _clean.searchParams.delete('ks_activate');
        window.history.replaceState({}, '', _clean);
    }

    // 1bis. Sprint 4 — Cloud Vault sync : si JWT présent, on hydrate
    //       localStorage AVANT d'instancier l'UI. Cross-device garanti.
    let _vaultRes = null;
    if (isCloudReady()) {
        try { _vaultRes = await loadFromCloud(); } catch (_) {}
        // Garde-fou auth : 401/403 = jeton rejeté côté serveur (révoqué,
        // mauvais compte, secret tourné). On NE reste PAS sur un dashboard
        // vide → déconnexion propre + re-login. Un échec RÉSEAU ne déconnecte
        // jamais (offline préservé). Incident 2026-06-14.
        if (_vaultRes && (_vaultRes.reason === 'http-401' || _vaultRes.reason === 'http-403')) {
            await ksCleanLogout({ reason: 'boot-vault-' + _vaultRes.reason });
            return; // ksCleanLogout redirige : on stoppe le boot ici.
        }
    }

    // 2. Chargement des PADs (nécessaire aussi pour le catalogue d'onboarding)
    const pads = await loadPads();

    // 2b. Catalogue local en priorité (rapide, même origine) — légèrement bloquant
    //     pour que getArtefactList() soit disponible avant le premier render.
    await fetchRemoteCatalog().catch(() => {});

    // 2c. Injection des listes dynamiques dans le renderer (Master Renderer)
    initTools(getToolList(), getArtefactList());

    // 3. L'onboarding est intégralement géré par la landing page (index.html).
    // Si l'utilisateur arrive sur /app sans avoir activé sa licence, on le
    // laisse voir le dashboard vide — pas de second tunnel ici.
    _boot();

    // 3bis. Garde-fou « connecté mais vide » (incident 2026-06-14) — après
    // le rendu, on évalue si la session paraît périmée et on propose une
    // reconnexion propre plutôt qu'un dashboard vide silencieux.
    _checkStaleSession(_vaultRes);

    // ── Sprint 3 — Hot Reload après activation de licence ───────
    window.addEventListener('ks-licence-activated', e => {
        const { plan, ownedAssets } = e.detail || {};

        // Sprint 4 — On vient juste d'obtenir le JWT, hydrate le vault
        // distant (clés API saisies sur un autre appareil) puis re-render.
        loadFromCloud()
            .then(res => {
                // Même garde-fou qu'au boot : un jeton rejeté ne doit pas
                // reboucler sur un dashboard vide (incident 2026-06-14).
                if (res && (res.reason === 'http-401' || res.reason === 'http-403')) {
                    ksCleanLogout({ reason: 'activate-vault-' + res.reason });
                    return;
                }
                renderDashboard();
            })
            .catch(() => renderDashboard());

        // Re-render complet du dashboard avec les nouveaux droits

        // Feedback dans la DST
        const dstText = document.getElementById('dst-text');
        if (dstText) {
            const count = Array.isArray(ownedAssets)
                ? `${ownedAssets.length} outil${ownedAssets.length > 1 ? 's' : ''} débloqué${ownedAssets.length > 1 ? 's' : ''}`
                : 'accès complet activé';
            dstText.textContent = `✓ Licence ${plan || ''} activée — ${count}.`;
            setTimeout(() => {
                dstText.textContent = 'Votre suite d\'applications métiers est prête.';
            }, 5000);
        }
    });

    window.addEventListener('ks-licence-revoked', () => {
        renderDashboard();
    });

    // ── Sprint A — Hot reload après achat à vie ──────────────────
    window.addEventListener('ks-lifetime-activated', e => {
        // Marqueur pour le Coach (règle 'lifetime-welcome')
        localStorage.setItem('ks_last_lifetime_ts', String(Date.now()));
        renderDashboard();
        const dstText = document.getElementById('dst-text');
        if (dstText) {
            dstText.textContent = `✓ Outil acquis définitivement — accès permanent garanti.`;
            setTimeout(() => {
                dstText.textContent = 'Votre suite d\'applications métiers est prête.';
            }, 5000);
        }
    });

    // ── Sprint 4 — Re-render barre Key-Store dès que le catalogue arrive ─
    // (SWR revalidation après 5 min) — réinjecte les artefacts mis à jour
    window.addEventListener('ks-catalog-loaded', () => {
        initTools(getToolList(), getArtefactList());
        renderDashboard();
    });
});
