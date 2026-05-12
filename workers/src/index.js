/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Cloudflare Worker · Router principal v1.1
   EU data residency : D1 weur · AES-GCM · Multi-tenant ready

   Routes :
   ── Licences ──────────────────────────────────────────────────
   GET  /api/licence/list       Admin — liste toutes les licences
   POST /api/licence/activate   Admin — créer / mettre à jour
   POST /api/licence/revoke     Admin — révoquer
   POST /api/licence/validate   Public — vérifier une clé (login)

   ── Devices ───────────────────────────────────────────────────
   POST /api/device/register    Public — enregistrer un appareil
   POST /api/device/approve     Admin  — approuver
   POST /api/device/login       Public — connexion par token
   POST /api/device/revoke      Admin  — révoquer

   ── Admin ─────────────────────────────────────────────────────
   GET  /api/admin/devices        Admin — liste des appareils
   GET  /api/admin/health         Admin — santé du Worker + D1
   GET  /api/admin/export         Admin — export RGPD (portabilité)
   POST /api/admin/purge-tenant   Admin — effacement RGPD (Art.17)
   ═══════════════════════════════════════════════════════════════ */

import { handleList, handleActivate, handleRevoke, handleValidate }   from './routes/licence.js';
import { handleActivateV2, handleMe, handleRefresh }                   from './routes/licence-public.js';
import { handleVaultLoad, handleVaultSave }                            from './routes/vault-user.js';
import { handleStripeWebhook }                                         from './routes/stripe-webhook.js';
import { handleRegister, handleApprove, handleLogin,
         handleRevoke as handleDeviceRevoke, handleList as handleDeviceList } from './routes/device.js';
import { handleExport, handlePurgeTenant }                             from './routes/admin.js';
import { handleListPads, handleSavePad, handleDeletePad,
         handleGetCatalog, handleSaveCatalog,
         handleGetCatalogPublic }                                      from './routes/pads.js';
import { handleUploadScreenshot, handleGetScreenshot,
         handleDeleteScreenshot, handleListScreenshotsByApp }          from './routes/screenshots.js';
import { handleListKeys, handleSaveKey, handleDeleteKey,
         handleGetKey }                                                 from './routes/vault.js';
import { handleDataDispatch }                                           from './routes/data.js';
import { handleProxyLLM }                                               from './routes/proxy-llm.js';
import { handleCspReport }                                              from './routes/csp-report.js';
import { handleUploadAsset, handleGetAsset, handleListAssets, handleDeleteAsset } from './routes/kodex-assets.js';
import { handleQrRedirect, handleCreateQr, handleListQr, handleUpdateQr, handleDeleteQr, handleStatsQr, handleScansCsv, handlePrivacyPage, handleScheduledPurge } from './routes/qr.js';
import { handleListPublic as handleMsgListPublic,
         handleCreate     as handleMsgCreate,
         handleListAdmin  as handleMsgListAdmin,
         handleUpdate     as handleMsgUpdate,
         handleDelete     as handleMsgDelete,
         handleRevoke     as handleMsgRevoke,
         handleRepublish  as handleMsgRepublish }                       from './routes/messages.js';
import { json, err, corsOk, requireAdmin, getAllowedOrigin }           from './lib/auth.js';

// ── Router ────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const origin = getAllowedOrigin(env, request);

    // ── Preflight CORS ────────────────────────────────────────
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin'  : origin,
          'Access-Control-Allow-Methods' : 'GET, POST, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers' : 'Content-Type, Authorization, X-Tenant-Id',
        },
      });
    }

    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;

    try {
      // ── Licences ────────────────────────────────────────────
      if (path === '/api/licence/list'     && method === 'GET')  return handleList(request, env);
      if (path === '/api/licence/activate' && method === 'POST') return handleActivate(request, env);
      if (path === '/api/licence/revoke'   && method === 'POST') return handleRevoke(request, env);
      if (path === '/api/licence/validate' && method === 'POST') return handleValidate(request, env);

      // ── Licences v2 (Sprint 2 — public, hashed, JWT, fingerprint) ──
      if (path === '/api/licence/v2/activate' && method === 'POST') return handleActivateV2(request, env);
      if (path === '/api/licence/v2/me'       && method === 'GET')  return handleMe(request, env);

      // ── Auth refresh (Sprint Sécu-2 / H4 / Q2b) ──────────────
      // Rolling refresh du JWT : prend un JWT valide, en réémet un avec exp réinitialisé.
      if (path === '/api/auth/refresh'        && method === 'POST') return handleRefresh(request, env);

      // ── Vault utilisateur (Sprint 4 — sync cross-device) ──
      if (path === '/api/vault/load'          && method === 'GET')  return handleVaultLoad(request, env);
      if (path === '/api/vault/save'          && method === 'POST') return handleVaultSave(request, env);

      // ── Stripe webhook (Sprint 5 — auto-delivery clés) ────
      if (path === '/api/stripe/webhook'      && method === 'POST') return handleStripeWebhook(request, env);

      // ── Devices ─────────────────────────────────────────────
      if (path === '/api/device/register'  && method === 'POST') return handleRegister(request, env);
      if (path === '/api/device/approve'   && method === 'POST') return handleApprove(request, env);
      if (path === '/api/device/login'     && method === 'POST') return handleLogin(request, env);
      if (path === '/api/device/revoke'    && method === 'POST') return handleDeviceRevoke(request, env);

      // ── Data Fabric (Sprint 1.1 — Layer 1) ───────────────────
      // CRUD générique pour toute entité whitelistée dans routes/data.js
      if (path.startsWith('/api/data/')) {
        return handleDataDispatch(request, env, path, method, origin);
      }

      // ── Proxy LLM (Sprint P2.1 — Layer 2 / PromptEngine) ─────
      // Bridge serveur vers les APIs LLM tierces (Anthropic, OpenAI…).
      // BYOK : la clé API est passée dans le body, jamais stockée Worker.
      if (path === '/api/proxy/llm' && method === 'POST') {
        return handleProxyLLM(request, env);
      }

      // ── CSP violation report endpoint (Sprint Sécu-2 / H5) ────
      // Le navigateur POST ici les violations en mode Report-Only.
      // Visible via `npx wrangler tail` (console.warn).
      if (path === '/api/csp-report' && method === 'POST') {
        return handleCspReport(request, env);
      }

      // ── Kodex Assets (Sprint Kodex-3.1.5) — upload binaire ─────
      if (path === '/api/kodex/asset'   && method === 'POST')   return handleUploadAsset(request, env);
      if (path === '/api/kodex/assets'  && method === 'GET')    return handleListAssets(request, env);
      if (path.startsWith('/api/kodex/asset/') && method === 'GET') {
        const aid = path.split('/').pop();
        return handleGetAsset(request, env, aid);
      }
      if (path.startsWith('/api/kodex/asset/') && method === 'DELETE') {
        const aid = path.split('/').pop();
        return handleDeleteAsset(request, env, aid);
      }

      // ── SDQR — Sovereign Dynamic QR (Sprint SDQR-1) ──────────
      // Redirect public ultra-rapide (lookup PRIMARY KEY) + log RGPD-safe.
      if (path.startsWith('/r/') && method === 'GET') {
        const shortId = path.slice(3);
        return handleQrRedirect(request, env, shortId);
      }
      // Page de transparence publique (RGPD natif, Sprint SDQR-5)
      // Tolerance HEAD pour les crawlers / health-checks (curl -I)
      if (path === '/sdqr-privacy' && (method === 'GET' || method === 'HEAD')) {
        return handlePrivacyPage(request, env);
      }
      // CRUD QR — tenant authentifié via X-Tenant-Id (à durcir si besoin)
      if (path === '/api/qr' && method === 'POST') return handleCreateQr(request, env);
      if (path === '/api/qr' && method === 'GET')  return handleListQr(request, env);
      if (path.startsWith('/api/qr/') && method === 'PATCH') {
        const qrId = path.split('/').pop();
        return handleUpdateQr(request, env, qrId);
      }
      if (path.startsWith('/api/qr/') && method === 'DELETE') {
        const qrId = path.split('/').pop();
        return handleDeleteQr(request, env, qrId);
      }
      // Sprint SDQR-4 — analytics
      // /api/qr/:id/stats  → JSON agrégats
      // /api/qr/:id/scans.csv → CSV brut RGPD-safe
      const qrStatsMatch = path.match(/^\/api\/qr\/([^/]+)\/stats$/);
      if (qrStatsMatch && method === 'GET') {
        return handleStatsQr(request, env, qrStatsMatch[1]);
      }
      const qrCsvMatch = path.match(/^\/api\/qr\/([^/]+)\/scans\.csv$/);
      if (qrCsvMatch && method === 'GET') {
        return handleScansCsv(request, env, qrCsvMatch[1]);
      }

      // ── PADs ─────────────────────────────────────────────────
      if (path === '/api/pads'               && method === 'GET')    return handleListPads(request, env);
      if (path === '/api/catalog'            && method === 'GET')    return handleGetCatalogPublic(request, env);
      if (path === '/api/admin/pad'          && method === 'POST')   return handleSavePad(request, env);
      if (path === '/api/admin/pad'          && method === 'DELETE') return handleDeletePad(request, env);
      if (path === '/api/admin/catalog'      && method === 'GET')    return handleGetCatalog(request, env);
      if (path === '/api/admin/catalog'      && method === 'POST')   return handleSaveCatalog(request, env);

      // ── Screenshots (fiches Key-Store) ───────────────────────
      if (path === '/api/admin/screenshot'   && method === 'POST')   return handleUploadScreenshot(request, env);
      if (path === '/api/admin/screenshots'  && method === 'GET')    return handleListScreenshotsByApp(request, env);
      if (path.startsWith('/api/screenshot/') && method === 'GET') {
        const id = path.split('/').pop();
        return handleGetScreenshot(request, env, id);
      }
      if (path.startsWith('/api/admin/screenshot/') && method === 'DELETE') {
        const id = path.split('/').pop();
        return handleDeleteScreenshot(request, env, id);
      }

      // ── Vault (clés API) ─────────────────────────────────────
      if (path === '/api/admin/keys'         && method === 'GET')    return handleListKeys(request, env);
      if (path === '/api/admin/keys'         && method === 'POST')   return handleSaveKey(request, env);
      if (path === '/api/admin/keys'         && method === 'DELETE') return handleDeleteKey(request, env);
      if (path.startsWith('/api/admin/keys/') && method === 'GET') {
        const provider = path.split('/').pop();
        return handleGetKey(request, env, provider);
      }

      // ── Messagerie ───────────────────────────────────────────
      if (path === '/api/messages'                   && method === 'GET')    return handleMsgListPublic(request, env);
      if (path === '/api/admin/messages'             && method === 'GET')    return handleMsgListAdmin(request, env);
      if (path === '/api/admin/messages'             && method === 'POST')   return handleMsgCreate(request, env);
      if (path === '/api/admin/messages'             && method === 'PATCH')  return handleMsgUpdate(request, env);
      if (path === '/api/admin/messages'             && method === 'DELETE') return handleMsgDelete(request, env);
      if (path === '/api/admin/messages/revoke'      && method === 'POST')   return handleMsgRevoke(request, env);
      if (path === '/api/admin/messages/republish'   && method === 'POST')   return handleMsgRepublish(request, env);

      // ── Admin ────────────────────────────────────────────────
      if (path === '/api/admin/devices'      && method === 'GET')    return handleDeviceList(request, env);
      if (path === '/api/admin/export'       && method === 'GET')    return handleExport(request, env);
      if (path === '/api/admin/purge-tenant' && method === 'POST')   return handlePurgeTenant(request, env);

      if (path === '/api/admin/health'       && method === 'GET') {
        if (!requireAdmin(request, env)) return err('Non autorisé', 401, origin);
        // Vérifie la connexion D1
        const test = await env.DB.prepare('SELECT COUNT(*) as n FROM licences').first();

        // Sprint Sécu-2 / H9 — observabilité du cron de purge SDQR.
        // last_purge_at est posé par handleScheduledPurge (qr.js).
        // stale = aucune purge dans les 25h (cron quotidien à 3h UTC).
        let cron = { last_purge_at: null, stale: true, payload: null };
        try {
          const row = await env.DB
            .prepare("SELECT value, updated_at FROM system_meta WHERE key = 'last_purge_at'")
            .first();
          if (row) {
            const ageMs = Date.now() - new Date(row.updated_at + 'Z').getTime();
            cron = {
              last_purge_at: row.updated_at,
              age_hours:     Math.round(ageMs / 36e5 * 10) / 10,
              stale:         ageMs > 25 * 36e5,
              payload:       (() => { try { return JSON.parse(row.value); } catch { return null; }})(),
            };
          }
        } catch (_) { /* table absente — premier run, stale par défaut */ }

        return json({
          status:    cron.stale ? 'degraded' : 'ok',
          worker:    'keystone-os-api',
          d1:        'connected',
          licences:  test?.n ?? 0,
          cron,
          timestamp: new Date().toISOString(),
        }, 200, origin);
      }

      return err('Route introuvable', 404, origin);

    } catch (e) {
      console.error('[Worker]', e);
      return err(`Erreur interne : ${e.message}`, 500, origin);
    }
  },

  // ── Scheduled handler (Cron) — Sprint SDQR-5 ──────────────
  // Auto-purge des qr_scans > rétention (90 jours par défaut).
  // Configure dans wrangler.toml :
  //   [triggers]
  //   crons = ["0 3 * * *"]   # tous les jours à 3h UTC
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduledPurge(env));
  },
};
