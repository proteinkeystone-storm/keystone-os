/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Ouverture d'un paiement (Sprint P5 · option B)
   ─────────────────────────────────────────────────────────────
   Une seule porte vers Stripe pour les 24 tarifs : on demande au
   serveur de préparer la page de paiement, il répond une adresse,
   on y envoie l'acheteur.

   POURQUOI PASSER PAR LE SERVEUR plutôt que par 24 liens figés :
   un lien statique ignore QUI clique. Le serveur, lui, joint à la
   commande l'identifiant de la licence de l'acheteur — c'est ce qui
   fait qu'en achetant une 2ᵉ application on n'obtient pas une 2ᵉ clé,
   mais un sac qui s'agrandit (cf. P4).

   Aucun montant, aucun identifiant de prix ne vit ici : le client ne
   décide pas de ce qu'il paie. Il nomme une application et une
   périodicité ; le serveur choisit le tarif et Stripe encaisse.
   ═══════════════════════════════════════════════════════════════ */

import { CF_API } from '../pads-loader.js';

/**
 * Ouvre la page de paiement Stripe pour une application.
 * @param {string} appId      id du catalogue, ou 'OS' pour l'offre complète
 * @param {object} [opts]
 * @param {'month'|'year'} [opts.interval='month']
 * @returns {Promise<void>} redirige la page en cas de succès
 * @throws {Error} message lisible, à afficher tel quel à l'utilisateur
 */
export async function openCheckout(appId, { interval = 'month' } = {}) {
    const jwt = (() => { try { return localStorage.getItem('ks_jwt') || ''; } catch (_) { return ''; } })();

    let res, data;
    try {
        res = await fetch(`${CF_API}/api/stripe/checkout`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
            },
            body: JSON.stringify({ app: appId, interval }),
        });
        data = await res.json().catch(() => ({}));
    } catch (_) {
        throw new Error('Connexion impossible — réessayez dans un instant.');
    }

    if (!res.ok || !data?.url) {
        // Le serveur renvoie déjà des messages destinés à l'utilisateur
        // (« Ce tarif n'est pas encore ouvert à la vente », etc.).
        throw new Error(data?.error || 'Paiement momentanément indisponible.');
    }

    // Stripe héberge la page : on quitte l'application le temps du paiement,
    // et on revient sur /app.html?achat=ok (ou ?achat=annule).
    window.location.href = data.url;
}
