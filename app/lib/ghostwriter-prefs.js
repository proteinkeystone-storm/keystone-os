/* ═══════════════════════════════════════════════════════════════
   Ghost Writer — préférences d'écriture partagées
   ───────────────────────────────────────────────────────────────
   Une seule préférence pour l'instant : « écriture naturelle »
   (2026-08-17). Quand elle est active, chaque réécriture emporte le
   cahier des charges anti-tics d'IA du worker (NATURAL_WRITING) —
   phrases variées, du concret, pas de connecteurs d'annonce, pas de
   triades, pas de tirets cadratins en série, pas de tournures
   d'assistant.

   Pourquoi un module et pas un `localStorage.getItem` dans chaque
   surface : le modal, le Studio et les boutons inline des pads
   doivent lire LA MÊME préférence — c'est un choix de compte
   (clé `ks_gw_natural`, inscrite dans PREFS_KEYS de cloud-vault.js,
   donc synchronisée entre appareils). On la lit au moment de générer,
   jamais au boot : le Cloud Vault peut réécrire le localStorage à
   l'hydratation, une valeur mise en cache serait périmée.

   Copy client : on dit « écriture naturelle », jamais « signature IA »
   ni « anti-détection » — ce n'est ni l'un ni l'autre, c'est du style.
   ═══════════════════════════════════════════════════════════════ */

const KEY = 'ks_gw_natural';

/** true si l'utilisateur a choisi l'écriture naturelle. Défaut : false. */
export function isNaturalWriting() {
  try { return localStorage.getItem(KEY) === '1'; } catch (_) { return false; }
}

/** Enregistre le choix (préférence de compte, synchronisée par le Cloud Vault).
 *  ⚠ Toujours une valeur EXPLICITE ('1' / '0'), jamais removeItem : le
 *  Cloud Vault n'AJOUTE que les clés présentes dans le blob à l'hydratation,
 *  il ne retire pas les absentes. Un removeItem ferait « ressusciter »
 *  l'écriture naturelle depuis un autre appareil au prochain reload. */
export function setNaturalWriting(on) {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (_) {}
  try { window.dispatchEvent(new CustomEvent('ks-gw-natural-changed', { detail: { on: !!on } })); } catch (_) {}
}

/** Libellés partagés — une seule formulation dans toute l'interface. */
export const NATURAL_LABELS = {
  standard : 'Standard',
  natural  : 'Naturelle',
  legend   : 'Écriture',
  hint     : 'Naturelle : phrases variées, du concret, sans les tournures toutes faites des assistants.',
};
