import { loadVault, isVaultEmpty }             from './vault.js';
import { renderDashboard, initSettings }       from './ui-renderer.js';
import { initDST, initDSTAdminBridge }        from './dst.js';
import { initLockScreen }                     from './lockscreen.js';
import { loadPads, fetchRemoteCatalog }       from './pads-loader.js';
import { initOnboarding }                     from './onboarding.js';

// ── Démarrage complet du dashboard ─────────────────────────────
function _boot() {
    renderDashboard();
    initSettings();
    initDST();
    initDSTAdminBridge();
    initLockScreen();
}

window.addEventListener('DOMContentLoaded', async () => {
    // 1. Vault en premier — source de vérité USB, écrase le localStorage
    loadVault();

    // 2. Chargement des PADs (nécessaire aussi pour le catalogue d'onboarding)
    const pads = await loadPads();

    // 2b. Catalogue distant — fire & forget (SWR, pas bloquant pour le boot)
    fetchRemoteCatalog().catch(() => {});

    // 3. Sprint 5.2 — Vault vide + jamais onboardé → Onboarding
    const onboarded = localStorage.getItem('ks_onboarded');
    if (isVaultEmpty() && !onboarded) {
        const catalog = Object.values(pads).map(p => ({
            id:   p.id,
            name: p.title,
            desc: p.subtitle || '',
        }));
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
    window.addEventListener('ks-catalog-loaded', () => {
        renderDashboard();
    });
});
