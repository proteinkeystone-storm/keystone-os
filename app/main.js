import { loadVault, isVaultEmpty }             from './vault.js';
import { renderDashboard, initSettings, initTools } from './ui-renderer.js';
import { initDST, initDSTAdminBridge }        from './dst.js';
import { initLockScreen }                     from './lockscreen.js';
import { loadPads, fetchRemoteCatalog, addLifetimePurchase, getToolList, getArtefactList } from './pads-loader.js';
import { initOnboarding }                     from './onboarding.js';
import { runSystemCoach }                     from './system-coach.js';
import { initInbox }                          from './inbox.js';

// ═══════════════════════════════════════════════════════════════
// VERSION CHECK — auto-cleanup à chaque déploiement
// ═══════════════════════════════════════════════════════════════
// Bumper APP_VERSION à chaque déploiement qui change la structure
// localStorage / la signature des outils. Au boot, si la version
// stockée diffère, on reset les clés problématiques sans toucher
// aux préférences utilisateur (clés API, photo, nom...).
const APP_VERSION = '2026-04-29-d';
(() => {
    const stored = localStorage.getItem('ks_app_version');
    if (stored !== APP_VERSION) {
        // Reset uniquement les clés liées aux licences (cause de l'affichage cassé).
        // On préserve : clés API, prénom, photo, lock, ordre grille, dark mode,
        // ainsi que ks_user_selection (préférence utilisateur sélection onboarding).
        ['ks_owned_assets','ks_inbox_cache'].forEach(k => localStorage.removeItem(k));
        // Reset des éventuels flags ks_deactivated_* (outils masqués)
        Object.keys(localStorage)
            .filter(k => k.startsWith('ks_deactivated_'))
            .forEach(k => localStorage.removeItem(k));
        // Force le mode démo : skip l'onboarding et affiche directement les 8 outils
        localStorage.setItem('ks_onboarded', '1');
        localStorage.setItem('ks_app_version', APP_VERSION);
        console.info('[Keystone] Mise à jour appliquée :', APP_VERSION);
    }
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
}

window.addEventListener('DOMContentLoaded', async () => {
    // 1. Vault en premier — source de vérité USB, écrase le localStorage
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

    // 2. Chargement des PADs (nécessaire aussi pour le catalogue d'onboarding)
    const pads = await loadPads();

    // 2b. Catalogue local en priorité (rapide, même origine) — légèrement bloquant
    //     pour que getArtefactList() soit disponible avant le premier render.
    await fetchRemoteCatalog().catch(() => {});

    // 2c. Injection des listes dynamiques dans le renderer (Master Renderer)
    initTools(getToolList(), getArtefactList());

    // 3. Sprint 5.2 — Vault vide + jamais onboardé → Onboarding
    const onboarded = localStorage.getItem('ks_onboarded');
    if (isVaultEmpty() && !onboarded) {
        // Outils PADs + Artefacts catalog (propositions suggérées)
        const toolItems = getToolList();
        const artefactItems = getArtefactList();
        const catalog = [...toolItems, ...artefactItems];
        initOnboarding(catalog, _boot);
        return;
    }

    // 4. Lancement direct si déjà onboardé ou vault configuré
    _boot();

    // ── Sprint 3 — Hot Reload après activation de licence ───────
    window.addEventListener('ks-licence-activated', e => {
        const { plan, ownedAssets } = e.detail || {};

        // Re-render complet du dashboard avec les nouveaux droits
        renderDashboard();

        // Feedback dans la DST
        const dstText = document.getElementById('dst-text');
        if (dstText) {
            const count = Array.isArray(ownedAssets)
                ? `${ownedAssets.length} outil${ownedAssets.length > 1 ? 's' : ''} débloqué${ownedAssets.length > 1 ? 's' : ''}`
                : 'accès complet activé';
            dstText.textContent = `✓ Licence ${plan || ''} activée — ${count}.`;
            setTimeout(() => {
                dstText.textContent = 'Votre pôle de promotion immobilière est prêt.';
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
                dstText.textContent = 'Votre pôle de promotion immobilière est prêt.';
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
