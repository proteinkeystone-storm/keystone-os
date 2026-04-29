/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — System Coach v1.0
   Messages contextuels auto-générés (priorité P2 dans le DST)
   ─────────────────────────────────────────────────────────────
   Pure logique déclarative · 0 IA générative · 0 backend
   Chaque règle a un id stable, un cooldown 24h, et un score.
   La règle de plus haut score éligible déclenche son message.
   ─────────────────────────────────────────────────────────────
   Données lues (lecture seule, jamais écrites par le coach) :
     ks_user_name, ks_user_selection, ks_grid_order,
     ks_lifetime_purchases, ks_owned_assets,
     ks_coach_<id>_lastShown  (cooldown)
     ks_last_use, ks_first_use_<id>
   ═══════════════════════════════════════════════════════════════ */

import { setKeystoneStatus } from './dst.js';

const COOLDOWN_MS    = 24 * 60 * 60 * 1000; // 24h
const COACH_PRIORITY = 2;                    // P2 dans le DST (sous Admin push)
const DURATION_MS    = 12_000;               // 12 sec d'affichage par défaut

// ── Helpers contexte ──────────────────────────────────────────
const _ctx = () => {
    const now = new Date();
    return {
        now,
        hour    : now.getHours(),
        weekday : now.getDay(),                          // 0 = dim, 5 = ven
        name    : (localStorage.getItem('ks_user_name') || '').trim(),
        selectionLen : (() => {
            try { return JSON.parse(localStorage.getItem('ks_user_selection') || 'null')?.length || 0; }
            catch { return 0; }
        })(),
        lifetimeLen : (() => {
            try { return JSON.parse(localStorage.getItem('ks_lifetime_purchases') || '[]').length; }
            catch { return 0; }
        })(),
        lastUseTs : Number(localStorage.getItem('ks_last_use') || 0),
        firstLaunchToday : (() => {
            const todayKey = 'ks_launched_' + now.toISOString().slice(0, 10);
            const fresh    = !localStorage.getItem(todayKey);
            if (fresh) localStorage.setItem(todayKey, String(Date.now()));
            return fresh;
        })(),
    };
};

// ── Règles déclaratives ───────────────────────────────────────
// Chaque règle : { id, score, when(ctx) → bool, msg(ctx) → string }
// Score = priorité interne entre règles éligibles (plus haut = gagne)
const RULES = [
    {
        id:    'morning-greet',
        score: 50,
        when:  c => c.firstLaunchToday && c.hour >= 6 && c.hour < 11,
        msg:   c => c.name
            ? `Bonjour ${c.name} — votre pôle est prêt pour la journée.`
            : `Bonjour — votre pôle est prêt pour la journée.`,
    },
    {
        id:    'afternoon-momentum',
        score: 30,
        when:  c => c.firstLaunchToday && c.hour >= 14 && c.hour < 18,
        msg:   () => `Bel après-midi — un dossier à finaliser ?`,
    },
    {
        id:    'friday-evening',
        score: 60,
        when:  c => c.weekday === 5 && c.hour >= 16 && c.hour < 20,
        msg:   () => `Vendredi soir — pensez à exporter votre Vault avant le week-end.`,
    },
    {
        id:    'weekend-light',
        score: 25,
        when:  c => (c.weekday === 0 || c.weekday === 6) && c.firstLaunchToday,
        msg:   c => c.name
            ? `Bon week-end ${c.name} — on garde le cap.`
            : `Bon week-end — on garde le cap.`,
    },
    {
        id:    'empty-selection',
        score: 70,
        when:  c => c.selectionLen === 0 && _daysSinceFirstUse() >= 1,
        msg:   () => `Aucun outil dans votre pôle. Le Key-Store en propose 8 prêts à l'emploi.`,
    },
    {
        id:    'few-tools',
        score: 40,
        when:  c => c.selectionLen > 0 && c.selectionLen < 3 && _daysSinceFirstUse() >= 2,
        msg:   () => `Vous n'utilisez qu'une partie du potentiel. Découvrez les autres assistants au Key-Store.`,
    },
    {
        id:    'lifetime-welcome',
        score: 90,
        when:  c => c.lifetimeLen > 0 && _hoursSinceLastLifetime() < 24,
        msg:   () => `Bienvenue dans le club ∞ — votre nouvel outil reste actif à vie.`,
    },
    {
        id:    'unused-7d',
        score: 80,
        when:  () => _daysSinceLastUse() >= 7,
        msg:   c => c.name
            ? `7 jours sans connexion ${c.name} — vos outils vous attendent.`
            : `7 jours sans connexion — vos outils vous attendent.`,
    },
    {
        id:    'fresh-install',
        score: 10,
        when:  c => c.selectionLen === 0 && _daysSinceFirstUse() === 0,
        msg:   () => `Premier lancement — choisissez vos outils dans le Key-Store pour démarrer.`,
    },
];

// ── Compteurs basés sur localStorage (lecture seule) ──────────
function _daysSinceLastUse() {
    const ts = Number(localStorage.getItem('ks_last_use') || 0);
    if (!ts) return 0;
    return Math.floor((Date.now() - ts) / 86_400_000);
}
function _daysSinceFirstUse() {
    const ts = Number(localStorage.getItem('ks_first_use') || 0);
    if (!ts) {
        localStorage.setItem('ks_first_use', String(Date.now()));
        return 0;
    }
    return Math.floor((Date.now() - ts) / 86_400_000);
}
function _hoursSinceLastLifetime() {
    const ts = Number(localStorage.getItem('ks_last_lifetime_ts') || 0);
    if (!ts) return Infinity;
    return (Date.now() - ts) / 3_600_000;
}

// ── Cooldown ──────────────────────────────────────────────────
function _onCooldown(id) {
    const last = Number(localStorage.getItem(`ks_coach_${id}_lastShown`) || 0);
    return Date.now() - last < COOLDOWN_MS;
}
function _markShown(id) {
    localStorage.setItem(`ks_coach_${id}_lastShown`, String(Date.now()));
}

// ═══════════════════════════════════════════════════════════════
// API publique
// ═══════════════════════════════════════════════════════════════

/**
 * Évalue les règles, sélectionne la meilleure éligible,
 * pousse le message dans le DST avec priorité P2.
 * Appelé une fois au boot (depuis main.js, après _boot()).
 * Idempotent : si déjà affiché aujourd'hui, no-op.
 */
export function runSystemCoach() {
    // Marqueur "dernière utilisation" — utilisé par _daysSinceLastUse au prochain run
    localStorage.setItem('ks_last_use', String(Date.now()));

    const ctx = _ctx();

    // Filtre les règles éligibles ET hors cooldown, trie par score desc
    const eligible = RULES
        .filter(r => !_onCooldown(r.id))
        .filter(r => {
            try { return r.when(ctx); }
            catch (e) { console.warn('[Coach] erreur règle', r.id, e); return false; }
        })
        .sort((a, b) => b.score - a.score);

    if (eligible.length === 0) return null;

    const winner = eligible[0];
    let text;
    try { text = winner.msg(ctx); }
    catch { return null; }

    if (!text) return null;

    _markShown(winner.id);
    setKeystoneStatus(text, 'info', DURATION_MS, COACH_PRIORITY);

    return { id: winner.id, text };
}

/**
 * Reset complet des cooldowns (debug / settings panel).
 * Permet de retester les règles sans attendre 24h.
 */
export function resetCoachCooldowns() {
    Object.keys(localStorage)
        .filter(k => k.startsWith('ks_coach_') && k.endsWith('_lastShown'))
        .forEach(k => localStorage.removeItem(k));
}

/**
 * Liste des règles disponibles (debug / admin).
 */
export function listCoachRules() {
    return RULES.map(r => ({ id: r.id, score: r.score }));
}
