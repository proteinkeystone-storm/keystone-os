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
import { handleRegister, handleApprove, handleLogin,
         handleRevoke as handleDeviceRevoke, handleList as handleDeviceList } from './routes/device.js';
import { handleExport, handlePurgeTenant }                             from './routes/admin.js';
import { json, err, corsOk, requireAdmin, getAllowedOrigin }           from './lib/auth.js';

// ── Router ────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const origin = getAllowedOrigin(env);

    // ── Preflight CORS ────────────────────────────────────────
    if (request.method === 'OPTIONS') return corsOk(origin);

    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;

    try {
      // ── Licences ────────────────────────────────────────────
      if (path === '/api/licence/list'     && method === 'GET')  return handleList(request, env);
      if (path === '/api/licence/activate' && method === 'POST') return handleActivate(request, env);
      if (path === '/api/licence/revoke'   && method === 'POST') return handleRevoke(request, env);
      if (path === '/api/licence/validate' && method === 'POST') return handleValidate(request, env);

      // ── Devices ─────────────────────────────────────────────
      if (path === '/api/device/register'  && method === 'POST') return handleRegister(request, env);
      if (path === '/api/device/approve'   && method === 'POST') return handleApprove(request, env);
      if (path === '/api/device/login'     && method === 'POST') return handleLogin(request, env);
      if (path === '/api/device/revoke'    && method === 'POST') return handleDeviceRevoke(request, env);

      // ── Admin ────────────────────────────────────────────────
      if (path === '/api/admin/devices'      && method === 'GET')  return handleDeviceList(request, env);
      if (path === '/api/admin/export'       && method === 'GET')  return handleExport(request, env);
      if (path === '/api/admin/purge-tenant' && method === 'POST') return handlePurgeTenant(request, env);

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
