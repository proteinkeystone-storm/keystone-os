import { loadVault, isVaultEmpty }             from './vault.js';
import { renderDashboard, initSettings, initTools } from './ui-renderer.js';
import { initDST, initDSTAdminBridge }        from './dst.js';
import { initLockScreen }                     from './lockscreen.js';
import { loadPads, fetchRemoteCatalog, addLifetimePurchase, getToolList, getArtefactList } from './pads-loader.js';
import { initOnboarding }                     from './onboarding.js';
import { runSystemCoach }                     from './system-coach.js';
import { initInbox }                          from './inbox.js';

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
