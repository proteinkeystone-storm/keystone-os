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
import { handleActivateV2, handleMe }                                  from './routes/licence-public.js';
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
import { handleQrRedirect, handleCreateQr, handleListQr, handleUpdateQr } from './routes/qr.js';
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
          'Access-Control-Allow-Headers' : 'Content-Type, Authorization',
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

      // ── SDQR — Sovereign Dynamic QR (Sprint SDQR-1) ──────────
      // Redirect public ultra-rapide (lookup PRIMARY KEY) + log RGPD-safe.
      if (path.startsWith('/r/') && method === 'GET') {
        const shortId = path.slice(3);
        return handleQrRedirect(request, env, shortId);
      }
      // CRUD QR — tenant authentifié via X-Tenant-Id (à durcir si besoin)
      if (path === '/api/qr' && method === 'POST') return handleCreateQr(request, env);
      if (path === '/api/qr' && method === 'GET')  return handleListQr(request, env);
      if (path.startsWith('/api/qr/') && method === 'PATCH') {
        const qrId = path.split('/').pop();
        return handleUpdateQr(request, env, qrId);
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
        return json({
          status:    'ok',
          worker:    'keystone-os-api',
          d1:        'connected',
          licences:  test?.n ?? 0,
          timestamp: new Date().toISOString(),
        }, 200, origin);
      }

      return err('Route introuvable', 404, origin);

    } catch (e) {
      console.error('[Worker]', e);
      return err(`Erreur interne : ${e.message}`, 500, origin);
    }
  },
};
