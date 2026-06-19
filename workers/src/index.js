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
import { handleVaultLoad, handleVaultSave, handleVaultHealth, handleVaultDelete } from './routes/vault-user.js';
import { handleBillingPortal }                                          from './routes/billing.js';
import { handleStripeWebhook }                                         from './routes/stripe-webhook.js';
import { handleRegister, handleApprove, handleLogin,
         handleRevoke as handleDeviceRevoke, handleList as handleDeviceList } from './routes/device.js';
import { handleExport, handlePurgeTenant }                             from './routes/admin.js';
import { handleListPads, handleSavePad, handleDeletePad,
         handleGetCatalog, handleSaveCatalog,
         handleGetCatalogPublic }                                      from './routes/pads.js';
import { handleUploadScreenshot, handleGetScreenshot,
         handleDeleteScreenshot, handleListScreenshotsByApp }          from './routes/screenshots.js';
import { handleHelpMediaUpload, handleHelpMediaInfo,
         handleHelpMediaServe, handleHelpMediaDelete }                 from './routes/help-media.js';
import { handleListKeys, handleSaveKey, handleDeleteKey,
         handleGetKey }                                                 from './routes/vault.js';
import { handleSaveUserKey, handleDeleteUserKey, handleListUserKeys }   from './routes/keys.js';
import { handleDataDispatch }                                           from './routes/data.js';
import { handleProxyLLM }                                               from './routes/proxy-llm.js';
import { handleGhostwriterRewrite, handleGhostwriterQuota }             from './routes/ghostwriter.js';
import { handleAiCreditsQuota }                                         from './routes/ai-credits.js';
import { handleBrainstormingAgentRespond, handleBrainstormingSynthesize, handleBrainstormingPostIdeas, handleBrainstormingPickRoster } from './routes/brainstorming.js';
import { handleFetchSource } from './routes/content-source.js';
import { handleAiGenerate }                                              from './routes/ai-generate.js';
// Budget IA — compteur neurones Workers AI + bridage (2026-05-29)
import { handleAiBudgetGet, handleAiBudgetThrottle, handleAiBudgetThreshold } from './routes/ai-budget-admin.js';
import { handleLivingLayerGreeting }                                     from './routes/living-layer.js';
// Living Layer V2 — Ordinateur de bord (2026-05-28)
import { handleLivingBoard, handleLivingFeedback }                       from './routes/living-layer-board.js';
import {
  handleLivingListAdmin, handleLivingCreate, handleLivingUpdate,
  handleLivingDelete, handleLivingArchive,
} from './routes/living-messages-admin.js';
import { handleCspReport }                                              from './routes/csp-report.js';
import { handleLeadCapture, handleLeadsList }                           from './routes/leads.js';
import { handleRatingSubmit, handleRatingsAdmin }                       from './routes/ratings.js';
import { handleTrack, handleFunnel, pruneTrackEvents }                  from './routes/track.js';
import { handleUploadAsset, handleGetAsset, handleListAssets, handleDeleteAsset } from './routes/kodex-assets.js';
import { handlePulsaUpsert, handlePulsaList, handlePulsaGet, handlePulsaDelete } from './routes/pulsa-forms.js';
import { handlePulsaPublic } from './routes/pulsa-public.js';
import {
  handlePulsaSubmit, handlePulsaPurge,
  handlePulsaResponsesList, handlePulsaResponseGet, handlePulsaResponsesCsv,
  handlePulsaResponsesListBySlug, handlePulsaResponsePatch,
} from './routes/pulsa-responses.js';
import { handleQrRedirect, handleCreateQr, handleListQr, handleUpdateQr, handleDeleteQr, handleStatsQr, handleScansCsv, handlePrivacyPage, handleScheduledPurge, handleSmartQrGamePlay, handleSmartQrVerifyWin, handleSmartQrLoyaltyStamp, handleSmartQrConcierge } from './routes/qr.js';
import { handleSdqrAsset } from './routes/sdqr-assets.js';
import { handleExpirationReminders }                                  from './routes/expiration-reminders.js';
import { handleListLicencesEnriched, handleToggleLicenceFlag,
         handleAuditList, handleExpirationRemindersRunNow,
         handleAdminIssueJWT }                                         from './routes/admin-s5.js';
import { handleAssetTransfer }                                         from './routes/asset-transfer.js';
import { handleConciergeAutoDowngrade, handleConciergeDowngradeRunNow } from './routes/concierge-downgrade.js';
import { handleListPublic as handleMsgListPublic,
         handleCreate     as handleMsgCreate,
         handleListAdmin  as handleMsgListAdmin,
         handleUpdate     as handleMsgUpdate,
         handleDelete     as handleMsgDelete,
         handleRevoke     as handleMsgRevoke,
         handleRepublish  as handleMsgRepublish }                       from './routes/messages.js';
import { json, err, corsOk, requireAdmin, getAllowedOrigin }           from './lib/auth.js';
// ── Sprint S1 (Auth v2 — multi-email pour plan MAX) ─────────
import {
  handleLicenceMe       as handleLicenceMeV2Full,
  handleLicenceMembers,
  handleLicenceClaim,
  handleLicenceInvite,
  handleLicenceRevokeMember,
} from './routes/licence-v2.js';
// ── Sprint S2 (Devices v2 — liste + soft revoke licence/email) ──
import {
  handleListDevices,
  handleRevokeDevice,
} from './routes/devices-v2.js';
// ── Sprint S3 (Email + magic-link — activation sans saisie de clé) ──
import {
  handleRequestMagicLink,
  handleConsumeMagicLink,
} from './routes/auth-magic-link.js';
// ── Social Broadcast — routes de production (Sprint Social-1) ──
import { handleSocialProvisionFacebook, handleSocialProvisionInstagram, handleSocialProvisionThreads, handleSocialProvisionTelegram, handleSocialPublish, handleSocialAccountsList, handleSocialRegistry, handleSocialPostsList, handleSocialPostCancel, handleSocialPostsDelete, handleSocialPostRetry, handleSocialAccountDisconnect, sweepDuePosts, refreshSocialTokens, handleSocialTokenRefreshNow, handleSocialPostInsights } from './routes/social.js';
import { handleSocialMediaUpload, handleSocialMediaServe } from './routes/social-media.js';
import { handleThreadsConnect, handleThreadsCallback, handleThreadsDeauthorize, handleThreadsDataDeletion } from './routes/social-threads.js';
import { handleFacebookConnect, handleFacebookCallback, handleFacebookDeauthorize, handleFacebookDataDeletion } from './routes/social-oauth-fb.js';
import { handleLinkedInConnect, handleLinkedInCallback } from './routes/social-oauth-linkedin.js';
// ── Smart Agent / Kortex — jumeaux numériques de savoir-faire (SA-0 → SA-1) ──
import { handleSmartAgentHealth,
         handleKortexUnitsList, handleKortexUnitCreate,
         handleKortexUnitUpdate, handleKortexUnitDelete,
         handleKortexExtract, handleKortexSearch, handleKortexReindex,
         handleKortexImportUrl, handleKortexImportFile,
         handleAgentsList, handleAgentCreate, handleAgentUpdate, handleAgentDelete,
         handleAgentChat, handleGapsList, handleGapDismiss, handleGapStructure,
         handleGoldenList, handleGoldenAdd, handleGoldenDelete, handleGoldenReplay,
         handleSuggestOpening, handleSuggestFallbacks,
         handleFoldersList, handleFolderCreate, handleFolderUpdate, handleFolderDelete,
         handleKortexVaultsList, handleKortexVaultCreate, handleKortexVaultUpdate, handleKortexVaultDelete,
         handlePublicAgentMeta, handlePublicAgentChat,
         handleAgentPublish, handleAgentLinksList, handlePublicLinkRevoke, handlePublicLinkUpdate,
         handleSmartAgentLifecycle, handleExploreQuestions, handleAgentStructure,
         handleCardImageServe, handleAgentCardImageUpload } from './routes/smart-agent.js';

// ── Keynapse — espace de connaissances en bulles (Pad O-Keyn-001 · KN-0) ──
import { handleKeynapseHealth, handleKeynapseState,
         handleBubbleCreate, handleBubbleUpdate, handleBubbleDelete,
         handleBubbleDetail, handleTodoCreate, handleTodoUpdate, handleTodoDelete,
         handleNoteCreate, handleNoteDelete,
         handleZoneCreate, handleZoneUpdate, handleZoneDelete,
         handleLinkCreate, handleLinkDelete,
         handleMediaUpload, handleMediaServe, handleMediaDelete,
         handleVoiceUpload, handleReminderCreate,
         handleRemindersList, handleReminderUpdate, handleReminderDelete,
         handlePushSubscribe, handlePushUnsubscribe, sweepDueReminders } from './routes/keynapse.js';

// ── Sentinel — audit web avec suivi (Pad O-GEO-001 · S0) ──
import { handleSentinelHealth, handleSitesList, handleSiteCreate, handleSiteDelete,
         handleSiteCheck, handleSiteHistory, handleSiteAudit, handleSiteAuditGet,
         handleSiteSuggest, handleSiteSendReport,
         handlePushSubscribe as handleSentinelPushSub, handlePushUnsubscribe as handleSentinelPushUnsub,
         sweepDueChecks } from './routes/sentinel.js';

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
      // ── Keynapse (Pad O-Keyn-001 · KN-0) — bulles de connaissances ──
      if (path === '/api/keynapse/health'  && method === 'GET')  return handleKeynapseHealth(request, env);
      if (path === '/api/keynapse/state'   && method === 'GET')  return handleKeynapseState(request, env);
      if (path === '/api/keynapse/reminders' && method === 'GET') return handleRemindersList(request, env);
      if (path === '/api/keynapse/bubbles' && method === 'POST') return handleBubbleCreate(request, env);
      if (path === '/api/keynapse/zones'   && method === 'POST') return handleZoneCreate(request, env);
      const knZone = path.match(/^\/api\/keynapse\/zones\/([A-Za-z0-9-]+)$/);
      if (knZone && method === 'PATCH')  return handleZoneUpdate(request, env, knZone[1]);
      if (knZone && method === 'DELETE') return handleZoneDelete(request, env, knZone[1]);
      const knTodoCreate = path.match(/^\/api\/keynapse\/bubbles\/([A-Za-z0-9-]+)\/todos$/);
      if (knTodoCreate && method === 'POST') return handleTodoCreate(request, env, knTodoCreate[1]);
      const knNoteCreate = path.match(/^\/api\/keynapse\/bubbles\/([A-Za-z0-9-]+)\/notes$/);
      if (knNoteCreate && method === 'POST') return handleNoteCreate(request, env, knNoteCreate[1]);
      const knLinkCreate = path.match(/^\/api\/keynapse\/bubbles\/([A-Za-z0-9-]+)\/links$/);
      if (knLinkCreate && method === 'POST') return handleLinkCreate(request, env, knLinkCreate[1]);
      const knLink = path.match(/^\/api\/keynapse\/links\/([A-Za-z0-9-]+)$/);
      if (knLink && method === 'DELETE') return handleLinkDelete(request, env, knLink[1]);
      const knMediaUp = path.match(/^\/api\/keynapse\/bubbles\/([A-Za-z0-9-]+)\/media$/);
      if (knMediaUp && method === 'POST') return handleMediaUpload(request, env, knMediaUp[1]);
      const knVoice = path.match(/^\/api\/keynapse\/bubbles\/([A-Za-z0-9-]+)\/voice$/);
      if (knVoice && method === 'POST') return handleVoiceUpload(request, env, knVoice[1]);
      const knReminderCreate = path.match(/^\/api\/keynapse\/bubbles\/([A-Za-z0-9-]+)\/reminders$/);
      if (knReminderCreate && method === 'POST') return handleReminderCreate(request, env, knReminderCreate[1]);
      const knReminder = path.match(/^\/api\/keynapse\/reminders\/([A-Za-z0-9-]+)$/);
      if (knReminder && method === 'PATCH')  return handleReminderUpdate(request, env, knReminder[1]);
      if (knReminder && method === 'DELETE') return handleReminderDelete(request, env, knReminder[1]);
      if (path === '/api/keynapse/push/subscribe'   && method === 'POST') return handlePushSubscribe(request, env);
      if (path === '/api/keynapse/push/unsubscribe' && method === 'POST') return handlePushUnsubscribe(request, env);
      const knMedia = path.match(/^\/api\/keynapse\/media\/([A-Za-z0-9-]+)$/);
      if (knMedia && method === 'GET')    return handleMediaServe(request, env, knMedia[1]);
      if (knMedia && method === 'DELETE') return handleMediaDelete(request, env, knMedia[1]);
      const knTodo = path.match(/^\/api\/keynapse\/todos\/([A-Za-z0-9-]+)$/);
      if (knTodo && method === 'PATCH')  return handleTodoUpdate(request, env, knTodo[1]);
      if (knTodo && method === 'DELETE') return handleTodoDelete(request, env, knTodo[1]);
      const knNote = path.match(/^\/api\/keynapse\/notes\/([A-Za-z0-9-]+)$/);
      if (knNote && method === 'DELETE') return handleNoteDelete(request, env, knNote[1]);
      const knBubbleMatch = path.match(/^\/api\/keynapse\/bubbles\/([A-Za-z0-9-]+)$/);
      if (knBubbleMatch && method === 'GET')    return handleBubbleDetail(request, env, knBubbleMatch[1]);
      if (knBubbleMatch && method === 'PATCH')  return handleBubbleUpdate(request, env, knBubbleMatch[1]);
      if (knBubbleMatch && method === 'DELETE') return handleBubbleDelete(request, env, knBubbleMatch[1]);

      // ── Sentinel (Pad O-GEO-001 · S0) — audit web avec suivi ──
      if (path === '/api/sentinel/health' && method === 'GET')  return handleSentinelHealth(request, env);
      if (path === '/api/sentinel/sites'  && method === 'GET')  return handleSitesList(request, env);
      if (path === '/api/sentinel/sites'  && method === 'POST') return handleSiteCreate(request, env);
      const sntCheck = path.match(/^\/api\/sentinel\/sites\/([A-Za-z0-9-]+)\/check$/);
      if (sntCheck && method === 'POST') return handleSiteCheck(request, env, sntCheck[1]);
      const sntHist = path.match(/^\/api\/sentinel\/sites\/([A-Za-z0-9-]+)\/history$/);
      if (sntHist && method === 'GET') return handleSiteHistory(request, env, sntHist[1]);
      const sntAudit = path.match(/^\/api\/sentinel\/sites\/([A-Za-z0-9-]+)\/audit$/);
      if (sntAudit && method === 'POST') return handleSiteAudit(request, env, sntAudit[1]);
      if (sntAudit && method === 'GET')  return handleSiteAuditGet(request, env, sntAudit[1]);
      const sntSuggest = path.match(/^\/api\/sentinel\/sites\/([A-Za-z0-9-]+)\/suggest$/);
      if (sntSuggest && method === 'POST') return handleSiteSuggest(request, env, sntSuggest[1]);
      const sntReport = path.match(/^\/api\/sentinel\/sites\/([A-Za-z0-9-]+)\/send-report$/);
      if (sntReport && method === 'POST') return handleSiteSendReport(request, env, sntReport[1]);
      if (path === '/api/sentinel/push/subscribe'   && method === 'POST') return handleSentinelPushSub(request, env);
      if (path === '/api/sentinel/push/unsubscribe' && method === 'POST') return handleSentinelPushUnsub(request, env);
      const sntSite = path.match(/^\/api\/sentinel\/sites\/([A-Za-z0-9-]+)$/);
      if (sntSite && method === 'DELETE') return handleSiteDelete(request, env, sntSite[1]);

      // ── Smart Agent / Kortex (SA-0 santé · SA-1 coffre) ──────
      if (path === '/api/smart-agent/health' && method === 'GET') return handleSmartAgentHealth(request, env);
      // SA-5 — exposition publique anonyme (lien/QR, SANS JWT : le handler résout le tenant du propriétaire)
      const saPubChat = path.match(/^\/api\/smart-agent\/p\/([A-Za-z0-9]+)\/chat$/);
      if (saPubChat && method === 'POST') return handlePublicAgentChat(request, env, saPubChat[1]);
      const saPubMeta = path.match(/^\/api\/smart-agent\/p\/([A-Za-z0-9]+)$/);
      if (saPubMeta && method === 'GET') return handlePublicAgentMeta(request, env, saPubMeta[1]);
      // Lot 3 — image d'une carte (public, servie depuis R2). Clé avec slashes → (.+).
      const saCardImg = path.match(/^\/api\/smart-agent\/card-img\/(.+)$/);
      if (saCardImg && method === 'GET') return handleCardImageServe(request, env, saCardImg[1]);
      if (path === '/api/smart-agent/kortex/units'       && method === 'GET')  return handleKortexUnitsList(request, env);
      if (path === '/api/smart-agent/kortex/units'       && method === 'POST') return handleKortexUnitCreate(request, env);
      if (path === '/api/smart-agent/kortex/extract'     && method === 'POST') return handleKortexExtract(request, env);
      // SA-8.1 — ingestion sans friction : page web / fichier → fiches proposées
      if (path === '/api/smart-agent/kortex/import-url'  && method === 'POST') return handleKortexImportUrl(request, env);
      if (path === '/api/smart-agent/kortex/import-file' && method === 'POST') return handleKortexImportFile(request, env);
      if (path === '/api/smart-agent/kortex/search'      && method === 'GET')  return handleKortexSearch(request, env);
      if (path === '/api/smart-agent/kortex/reindex'     && method === 'POST') return handleKortexReindex(request, env);
      if (path === '/api/smart-agent/agents'             && method === 'GET')  return handleAgentsList(request, env);
      if (path === '/api/smart-agent/agents'             && method === 'POST') return handleAgentCreate(request, env);
      if (path === '/api/smart-agent/suggest-opening'    && method === 'POST') return handleSuggestOpening(request, env);
      // SA-8.0 — variantes de repli pré-générées (gratuites à l'usage)
      if (path === '/api/smart-agent/suggest-fallbacks'  && method === 'POST') return handleSuggestFallbacks(request, env);
      // SA-4.4.1 — dossiers d'agents (regroupement)
      if (path === '/api/smart-agent/folders'            && method === 'GET')  return handleFoldersList(request, env);
      if (path === '/api/smart-agent/folders'            && method === 'POST') return handleFolderCreate(request, env);
      const saFolderMatch = path.match(/^\/api\/smart-agent\/folders\/([A-Za-z0-9-]+)$/);
      if (saFolderMatch && method === 'PATCH')  return handleFolderUpdate(request, env, saFolderMatch[1]);
      if (saFolderMatch && method === 'DELETE') return handleFolderDelete(request, env, saFolderMatch[1]);
      // SA-4.4.2 — coffres partagés (portés par un dossier)
      if (path === '/api/smart-agent/vaults'             && method === 'GET')  return handleKortexVaultsList(request, env);
      if (path === '/api/smart-agent/vaults'             && method === 'POST') return handleKortexVaultCreate(request, env);
      const saVaultMatch = path.match(/^\/api\/smart-agent\/vaults\/([A-Za-z0-9-]+)$/);
      if (saVaultMatch && method === 'PATCH')  return handleKortexVaultUpdate(request, env, saVaultMatch[1]);
      if (saVaultMatch && method === 'DELETE') return handleKortexVaultDelete(request, env, saVaultMatch[1]);
      if (path === '/api/smart-agent/gaps'               && method === 'GET')  return handleGapsList(request, env);
      const saGapMatch = path.match(/^\/api\/smart-agent\/gaps\/([A-Za-z0-9-]+)\/dismiss$/);
      if (saGapMatch && method === 'POST') return handleGapDismiss(request, env, saGapMatch[1]);
      const saGapStructure = path.match(/^\/api\/smart-agent\/gaps\/([A-Za-z0-9-]+)\/structure$/);
      if (saGapStructure && method === 'POST') return handleGapStructure(request, env, saGapStructure[1]);
      const saChatMatch = path.match(/^\/api\/smart-agent\/agents\/([A-Za-z0-9-]+)\/chat$/);
      if (saChatMatch && method === 'POST') return handleAgentChat(request, env, saChatMatch[1]);
      // SA-5 — publication d'un agent (pad, protégé par _gate dans le handler)
      const saPublishMatch = path.match(/^\/api\/smart-agent\/agents\/([A-Za-z0-9-]+)\/publish$/);
      if (saPublishMatch && method === 'POST') return handleAgentPublish(request, env, saPublishMatch[1]);
      const saLinksMatch = path.match(/^\/api\/smart-agent\/agents\/([A-Za-z0-9-]+)\/links$/);
      if (saLinksMatch && method === 'GET') return handleAgentLinksList(request, env, saLinksMatch[1]);
      const saExplore = path.match(/^\/api\/smart-agent\/agents\/([A-Za-z0-9-]+)\/explore$/);
      if (saExplore && method === 'POST') return handleExploreQuestions(request, env, saExplore[1]);
      const saAgStructure = path.match(/^\/api\/smart-agent\/agents\/([A-Za-z0-9-]+)\/structure$/);
      if (saAgStructure && method === 'POST') return handleAgentStructure(request, env, saAgStructure[1]);
      // Lot 3 — upload de l'image d'une carte (pad authentifié)
      const saCardUp = path.match(/^\/api\/smart-agent\/agents\/([A-Za-z0-9-]+)\/cards\/image$/);
      if (saCardUp && method === 'POST') return handleAgentCardImageUpload(request, env, saCardUp[1]);
      const saLinkRevoke = path.match(/^\/api\/smart-agent\/links\/([A-Za-z0-9-]+)\/revoke$/);
      if (saLinkRevoke && method === 'POST') return handlePublicLinkRevoke(request, env, saLinkRevoke[1]);
      const saLinkMatch = path.match(/^\/api\/smart-agent\/links\/([A-Za-z0-9-]+)$/);
      if (saLinkMatch && method === 'PATCH') return handlePublicLinkUpdate(request, env, saLinkMatch[1]);
      // Golden set — /golden/replay AVANT /golden (sous-chemin plus spécifique)
      const saGoldReplay = path.match(/^\/api\/smart-agent\/agents\/([A-Za-z0-9-]+)\/golden\/replay$/);
      if (saGoldReplay && method === 'POST') return handleGoldenReplay(request, env, saGoldReplay[1]);
      const saGoldMatch = path.match(/^\/api\/smart-agent\/agents\/([A-Za-z0-9-]+)\/golden$/);
      if (saGoldMatch && method === 'GET')  return handleGoldenList(request, env, saGoldMatch[1]);
      if (saGoldMatch && method === 'POST') return handleGoldenAdd(request, env, saGoldMatch[1]);
      const saGoldDel = path.match(/^\/api\/smart-agent\/golden\/([A-Za-z0-9-]+)$/);
      if (saGoldDel && method === 'DELETE') return handleGoldenDelete(request, env, saGoldDel[1]);
      const saAgentMatch = path.match(/^\/api\/smart-agent\/agents\/([A-Za-z0-9-]+)$/);
      if (saAgentMatch && method === 'PATCH')  return handleAgentUpdate(request, env, saAgentMatch[1]);
      if (saAgentMatch && method === 'DELETE') return handleAgentDelete(request, env, saAgentMatch[1]);
      const saUnitMatch = path.match(/^\/api\/smart-agent\/kortex\/units\/([A-Za-z0-9-]+)$/);
      if (saUnitMatch && method === 'PATCH')  return handleKortexUnitUpdate(request, env, saUnitMatch[1]);
      if (saUnitMatch && method === 'DELETE') return handleKortexUnitDelete(request, env, saUnitMatch[1]);

      // ── Social Broadcast (production — Sprint Social-1) ──────
      if (path === '/api/social/provision/facebook'  && method === 'POST') return handleSocialProvisionFacebook(request, env);
      if (path === '/api/social/provision/instagram' && method === 'POST') return handleSocialProvisionInstagram(request, env);
      if (path === '/api/social/connect/threads'     && method === 'GET')  return handleThreadsConnect(request, env);
      if (path === '/api/social/callback/threads'    && method === 'GET')  return handleThreadsCallback(request, env);
      if (path === '/api/social/threads/deauthorize'  && (method === 'GET' || method === 'POST')) return handleThreadsDeauthorize(request, env);
      if (path === '/api/social/threads/data-deletion' && (method === 'GET' || method === 'POST')) return handleThreadsDataDeletion(request, env);
      // S3 — OAuth self-serve Facebook + Instagram (dormant tant que l'App Review Meta n'est pas validée)
      if (path === '/api/social/connect/facebook'    && method === 'GET')  return handleFacebookConnect(request, env);
      if (path === '/api/social/callback/facebook'   && method === 'GET')  return handleFacebookCallback(request, env);
      if (path === '/api/social/connect/linkedin'    && method === 'GET')  return handleLinkedInConnect(request, env);
      if (path === '/api/social/callback/linkedin'   && method === 'GET')  return handleLinkedInCallback(request, env);
      if (path === '/api/social/facebook/deauthorize'  && (method === 'GET' || method === 'POST')) return handleFacebookDeauthorize(request, env);
      if (path === '/api/social/facebook/data-deletion' && (method === 'GET' || method === 'POST')) return handleFacebookDataDeletion(request, env);
      if (path === '/api/social/provision/threads'   && method === 'POST') return handleSocialProvisionThreads(request, env);
      if (path === '/api/social/provision/telegram'  && method === 'POST') return handleSocialProvisionTelegram(request, env);
      if (path === '/api/social/publish'            && method === 'POST') return handleSocialPublish(request, env);
      if (path === '/api/social/accounts'           && method === 'GET')  return handleSocialAccountsList(request, env);
      if (path === '/api/social/accounts/disconnect' && method === 'POST') return handleSocialAccountDisconnect(request, env);
      if (path === '/api/social/tokens/refresh-now'  && method === 'POST') return handleSocialTokenRefreshNow(request, env);
      if (path === '/api/social/posts'              && method === 'GET')  return handleSocialPostsList(request, env);
      if (path === '/api/social/posts/cancel'       && method === 'POST') return handleSocialPostCancel(request, env);
      if (path === '/api/social/posts/delete'       && method === 'POST') return handleSocialPostsDelete(request, env);
      if (path === '/api/social/posts/retry'        && method === 'POST') return handleSocialPostRetry(request, env);
      if (path === '/api/social/posts/insights'     && method === 'GET')  return handleSocialPostInsights(request, env);
      if (path === '/api/social/registry'           && method === 'GET')  return handleSocialRegistry(request, env);
      if (path === '/api/social/media'              && method === 'POST') return handleSocialMediaUpload(request, env);
      const socialMediaMatch = path.match(/^\/api\/social\/media\/([A-Za-z0-9._-]+)$/);
      if (socialMediaMatch && (method === 'GET' || method === 'HEAD')) {
        return handleSocialMediaServe(request, env, socialMediaMatch[1]);
      }

      // ── Licences ────────────────────────────────────────────
      if (path === '/api/licence/list'     && method === 'GET')  return handleList(request, env);
      if (path === '/api/licence/activate' && method === 'POST') return handleActivate(request, env);
      if (path === '/api/licence/revoke'   && method === 'POST') return handleRevoke(request, env);
      if (path === '/api/licence/validate' && method === 'POST') return handleValidate(request, env);

      // ── Licences v2 (Sprint 2 — public, hashed, JWT, fingerprint) ──
      if (path === '/api/licence/v2/activate' && method === 'POST') return handleActivateV2(request, env);
      if (path === '/api/licence/v2/me'       && method === 'GET')  return handleMe(request, env);

      // ── Licence multi-email (Sprint S1 — plan MAX) ──────────────
      // Routes ADDITIVES — n'altèrent aucune route v2 existante.
      // Auto-migration D1 au premier appel via ensureSchemaAuthV2().
      if (path === '/api/licence/me'      && method === 'GET')  return handleLicenceMeV2Full(request, env);
      if (path === '/api/licence/members' && method === 'GET')  return handleLicenceMembers(request, env);
      if (path === '/api/licence/claim'   && method === 'POST') return handleLicenceClaim(request, env);
      if (path === '/api/licence/invite'  && method === 'POST') return handleLicenceInvite(request, env);
      if (path.startsWith('/api/licence/members/') && method === 'DELETE') {
        const targetEmail = path.split('/').pop();
        return handleLicenceRevokeMember(request, env, targetEmail);
      }

      // ── Devices v2 (Sprint S2 — liste + soft revoke) ────────────
      // Routes ADDITIVES centrées licence/email (différentes des
      // routes B2B-terrain /api/device/{register,approve,login,revoke}
      // qui restent inchangées).
      if (path === '/api/licence/devices' && method === 'GET') {
        return handleListDevices(request, env);
      }
      if (path.startsWith('/api/licence/devices/') && method === 'DELETE') {
        const deviceId = path.split('/').pop();
        return handleRevokeDevice(request, env, deviceId);
      }

      // ── Magic-link auth (Sprint S3 — email + activation sans clé) ──
      // Routes ADDITIVES — n'altèrent aucune route auth existante.
      if (path === '/api/auth/request-magic-link' && method === 'POST') {
        return handleRequestMagicLink(request, env);
      }
      if (path === '/api/auth/consume-magic-link' && method === 'POST') {
        return handleConsumeMagicLink(request, env);
      }

      // ── Auth refresh (Sprint Sécu-2 / H4 / Q2b) ──────────────
      // Rolling refresh du JWT : prend un JWT valide, en réémet un avec exp réinitialisé.
      if (path === '/api/auth/refresh'        && method === 'POST') return handleRefresh(request, env);

      // ── Vault utilisateur (Sprint 4 — sync cross-device) ──
      // S4 hardening : health-check + scoping per-(licence_key, email)
      // dormant par défaut, géré dans vault-user.js.
      if (path === '/api/vault/load'          && method === 'GET')    return handleVaultLoad(request, env);
      if (path === '/api/vault/save'          && method === 'POST')   return handleVaultSave(request, env);
      if (path === '/api/vault/health'        && method === 'GET')    return handleVaultHealth(request, env);
      // UX-3.5 — RGPD droit à l'oubli : purge le profil cloud (PREFS_KEYS)
      if (path === '/api/vault/delete'        && method === 'DELETE') return handleVaultDelete(request, env);

      // ── Facturation : portail Stripe (changement de plan prorraté) ──
      // Ouvre le Customer Portal pour l'abonné (JWT) → upgrade/downgrade
      // sur l'abo EXISTANT = prorata auto, pas de double facturation.
      if (path === '/api/billing/portal'      && method === 'POST')   return handleBillingPortal(request, env);

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

      // ── Ghost Writer (Sprint GW-1 — Workers AI / Gemma 4) ────
      // Service de réécriture textuelle via env.AI.run() (free tier).
      // Pré-requis : binding [ai] dans wrangler.toml (cf. ghostwriter.js).
      if (path === '/api/ghostwriter/rewrite' && method === 'POST') {
        return handleGhostwriterRewrite(request, env);
      }
      // Phase 2 — quota serveur par licence (DEMO=1 / STARTER=3 /
      // PRO=10 / MAX=50 / ADMIN=∞). Lecture seule, pas de bump.
      if (path === '/api/ghostwriter/quota' && method === 'GET') {
        return handleGhostwriterQuota(request, env);
      }

      // ── Crédits IA unifiés (Chantier B — Sprint 1) ────────────
      // Lecture seule du portefeuille de la licence : quota mensuel
      // inclus (par plan) + solde de packs + ventilation par outil.
      // Aucun débit ici. L'enforcement réel (débit Concierge puis
      // Brainstorming) arrive aux Sprints 2-3, derrière le flag
      // dormant enforce_ai_credits_v1 (défaut 0 = legacy/illimité).
      if (path === '/api/ai-credits/quota' && method === 'GET') {
        return handleAiCreditsQuota(request, env);
      }

      // ── AI War Room (Brainstorming V2) — Sprint 1 ─────────────
      // POST stream SSE de la réponse d'un agent du boardroom IA.
      // Sprint 1 : seul agent_id='strategic' supporté ; les 8 autres
      // retournent 501 jusqu'à l'orchestrateur Sprint 2.
      if (path === '/api/brainstorming/agent-respond' && (method === 'POST' || method === 'OPTIONS')) {
        return handleBrainstormingAgentRespond(request, env);
      }
      // Sprint 5 — Synthesizer : Plan d'actions structuré (JSON)
      if (path === '/api/brainstorming/synthesize' && (method === 'POST' || method === 'OPTIONS')) {
        return handleBrainstormingSynthesize(request, env);
      }
      // Chaîne de contenu — idées de posts par réseau (one-shot)
      if (path === '/api/brainstorming/post-ideas' && (method === 'POST' || method === 'OPTIONS')) {
        return handleBrainstormingPostIdeas(request, env);
      }
      // Mode « Auto » — l'IA choisit le comité de débat selon le sujet (one-shot)
      if (path === '/api/brainstorming/pick-roster' && (method === 'POST' || method === 'OPTIONS')) {
        return handleBrainstormingPickRoster(request, env);
      }
      // Chaîne de contenu — récupération d'une source web (ancrage débat + rédaction)
      if (path === '/api/content/fetch-source' && (method === 'POST' || method === 'OPTIONS')) {
        return handleFetchSource(request, env);
      }

      // Phase 3 — génération texte libre via Gemma 4 (vs /rewrite
      // qui force {variants:[]}). Cas d'usage : Annonces Immo,
      // ou tout outil qui veut une réponse Markdown longue.
      // Quota partagé avec Ghost Writer (même table D1).
      if (path === '/api/ai/generate' && method === 'POST') {
        return handleAiGenerate(request, env);
      }

      // ── CSP violation report endpoint (Sprint Sécu-2 / H5) ────
      // Le navigateur POST ici les violations en mode Report-Only.
      // Visible via `npx wrangler tail` (console.warn).
      if (path === '/api/csp-report' && method === 'POST') {
        return handleCspReport(request, env);
      }

      // ── Capture email beta (landing) — public POST + listing admin ──
      if (path === '/api/leads'        && method === 'POST') return handleLeadCapture(request, env);
      if (path === '/api/admin/leads'  && method === 'GET')  return handleLeadsList(request, env);

      // ── Funnel landing (mesure d'audience souveraine) — public + admin ──
      if (path === '/api/track'        && method === 'POST') return handleTrack(request, env);
      if (path === '/api/admin/funnel' && method === 'GET')  return handleFunnel(request, env);

      // ── Notes des apps (étoiles) — user pose sa note (JWT) + agrégat admin ──
      if (path === '/api/ratings'        && (method === 'POST' || method === 'OPTIONS')) return handleRatingSubmit(request, env);
      if (path === '/api/admin/ratings'  && method === 'GET')  return handleRatingsAdmin(request, env);

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

      // ── Pulsa — Builder de formulaires (Sprint Pulsa-3.1) ─────
      // CRUD config formulaires (auth requise) + lecture publique par slug.
      if (path === '/api/pulsa/forms' && method === 'POST')  return handlePulsaUpsert(request, env);
      if (path === '/api/pulsa/forms' && method === 'GET')   return handlePulsaList(request, env);
      if (path.startsWith('/api/pulsa/forms/') && method === 'GET') {
        const fid = path.split('/').pop();
        return handlePulsaGet(request, env, fid);
      }
      if (path.startsWith('/api/pulsa/forms/') && method === 'DELETE') {
        const fid = path.split('/').pop();
        return handlePulsaDelete(request, env, fid);
      }
      // Lecture publique : pas d'auth, retourne uniquement les formulaires
      // status='published' et strip les champs sensibles (recipients, owner).
      // Supporte un access_code optionnel via ?code=XXXX (401 si requis et absent).
      if (path.startsWith('/api/pulsa/public/') && method === 'GET') {
        const slug = path.split('/').pop();
        return handlePulsaPublic(request, env, slug, url);
      }
      // Soumission d'une réponse (publique). Stocke en D1 + envoie un mail
      // Resend aux destinataires direction. Purge automatique au TTL.
      if (path.startsWith('/api/pulsa/responses/') && method === 'POST') {
        const slug = path.split('/').pop();
        return handlePulsaSubmit(request, env, slug);
      }
      // Dashboard réponses (auth requise, owner du formulaire)
      if (path === '/api/pulsa/responses.csv' && method === 'GET') {
        return handlePulsaResponsesCsv(request, env, url);
      }
      if (path === '/api/pulsa/responses' && method === 'GET') {
        return handlePulsaResponsesList(request, env, url);
      }
      // Variante slug → form_id (alias lisible pour consommateurs externes)
      if (path.startsWith('/api/pulsa/responses-by-slug/') && method === 'GET') {
        const slug = path.split('/').pop();
        return handlePulsaResponsesListBySlug(request, env, slug);
      }
      if (path.startsWith('/api/pulsa/responses/') && method === 'GET') {
        const rid = path.split('/').pop();
        return handlePulsaResponseGet(request, env, rid);
      }
      // PATCH partiel admin (Sprint Trait d'union — Fiches artistes).
      // Whitelist STRICTE côté handler : fld_bio_courte, fld_bio_longue,
      // fld_oeuvres (uniquement op set_image). Tout autre champ → 400.
      if (path.startsWith('/api/pulsa/responses/') && method === 'PATCH') {
        const rid = path.split('/').pop();
        return handlePulsaResponsePatch(request, env, rid);
      }

      // ── SDQR — Assets statiques auto-hébergés (moteur Lottie + animations)
      // Servis même-origine que l'interstitiel, cache long immuable.
      if (path.startsWith('/sdqr-assets/') && (method === 'GET' || method === 'HEAD')) {
        return handleSdqrAsset(path);
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
      // Smart QR V4.3 (2026-05-26) — endpoint authoritative jeux (machine
      // à sous + carte à gratter). Tire l'aléatoire serveur, anti-rejouage
      // par device_hash, gère le stock de lots_disponibles.
      if (path === '/api/smartqr/game-play' && method === 'POST') return handleSmartQrGamePlay(request, env);
      // V4.3 UX (2026-05-26) — Vérification d'authenticité d'un code WIN-XXXX-XXXX
      // par le commerçant. Public, GET avec query ?code=WIN-XXXX-XXXX.
      if (path === '/api/smartqr/verify-win' && method === 'GET') return handleSmartQrVerifyWin(request, env);
      // Smart QR V4.4 (2026-05-26) — endpoint authoritative carte de fidélité.
      // Incrémente le compteur de tampons côté serveur, applique la règle
      // de validité, débloque la récompense au Nᵉ tampon avec code signé.
      if (path === '/api/smartqr/loyalty-stamp' && method === 'POST') return handleSmartQrLoyaltyStamp(request, env);
      // Concierge VEFA (2026-05-30, Sprint 2) — chat live SSE sur question
      // libre du visiteur. Charge le bloc programme, construit le prompt
      // déterministe, stream Mistral Small 3.1 24B. Public, pas d'auth.
      if (path === '/api/smartqr/concierge' && (method === 'POST' || method === 'OPTIONS')) return handleSmartQrConcierge(request, env);

      // ── Living Layer (2026-05-24) ────────────────────────────
      // Phrase courte vivante sous "Bonjour, X" du dashboard.
      // Public (pas de donnée privée fuitée), cache localStorage 30min.
      if (path === '/api/livinglayer/greeting' && (method === 'POST' || method === 'OPTIONS')) {
        return handleLivingLayerGreeting(request, env);
      }
      // ── Living Layer V2 — Ordinateur de bord (2026-05-28) ────
      // /board : endpoint unique pour la zone Living Layer du dashboard.
      // Agrège capteurs serveur (Smart QR / Pulsa / GW) + capteurs client
      // (Brainstorming / Annonces / Kodex via body.clientSensors). Retourne
      // un { mode, text, icon } selon priorité Pilotable URGENT > IA > Pilotable > Calculateur.
      if (path === '/api/livinglayer/board' && (method === 'POST' || method === 'OPTIONS')) {
        return handleLivingBoard(request, env);
      }
      // Feedback loop : impression / engagement par topic (apprend ce qui t'intéresse)
      if (path === '/api/livinglayer/feedback' && (method === 'POST' || method === 'OPTIONS')) {
        return handleLivingFeedback(request, env);
      }
      // CRUD admin Pilotables (auth KS_ADMIN_SECRET)
      if (path === '/api/admin/living-messages') {
        if (method === 'GET')    return handleLivingListAdmin(request, env);
        if (method === 'POST')   return handleLivingCreate(request, env);
        if (method === 'PATCH')  return handleLivingUpdate(request, env);
        if (method === 'DELETE') return handleLivingDelete(request, env);
      }
      if (path === '/api/admin/living-messages/archive' && method === 'POST') {
        return handleLivingArchive(request, env);
      }
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

      // ── Admin S5 enrichi (Sprint S5.3 — licences + audit + cron) ─
      if (path === '/api/admin/licences'                 && method === 'GET')  return handleListLicencesEnriched(request, env);
      if (path === '/api/admin/audit'                    && method === 'GET')  return handleAuditList(request, env);
      if (path === '/api/admin/expiration-reminders/run-now' && method === 'POST') return handleExpirationRemindersRunNow(request, env);
      // S5.6 — Admin login unifié : émet un JWT user pour activer Cloud Vault sync
      if (path === '/api/admin/issue-jwt'                && method === 'POST') return handleAdminIssueJWT(request, env);
      // Auto-dégradation Concierge à l'échéance — déclenche le job à la demande.
      // ?dry=1 = prévisualisation. Dormant par défaut (kill-switch env).
      if (path === '/api/admin/concierge-downgrade/run-now' && method === 'POST') return handleConciergeDowngradeRunNow(request, env);
      // « Livrer à un client » — réassigne un asset (QR / Key Form) vers le
      // tenant d'une licence cliente (par email). Gate admin flexible
      // (secret OU JWT isAdmin). dry_run=true → récap sans mutation.
      if (path === '/api/admin/asset/transfer'           && method === 'POST') return handleAssetTransfer(request, env);
      const licenceFlagMatch = path.match(/^\/api\/admin\/licences\/([A-Z0-9-]+)\/flag$/i);
      if (licenceFlagMatch && method === 'POST') {
        return handleToggleLicenceFlag(request, env, licenceFlagMatch[1]);
      }

      // ── Budget IA (2026-05-29 — compteur neurones + bridage) ──────
      // Compteur Workers AI maison (Cloudflare n'expose aucune conso temps
      // réel fiable) + pilotage du bridage manuel/auto. Auth KS_ADMIN_SECRET.
      if (path === '/api/admin/ai-budget'           && method === 'GET')  return handleAiBudgetGet(request, env);
      if (path === '/api/admin/ai-budget/throttle'  && method === 'POST') return handleAiBudgetThrottle(request, env);
      if (path === '/api/admin/ai-budget/threshold' && method === 'POST') return handleAiBudgetThreshold(request, env);

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

      // ── Help media (notices d'aide v2 — vidéos de démo sur R2) ──
      // Upload admin + service public avec support Range (seek vidéo).
      if (path === '/api/admin/help/media' && method === 'POST') {
        return handleHelpMediaUpload(request, env);
      }
      const helpDelMatch = path.match(/^\/api\/admin\/help\/media\/([A-Za-z0-9_-]+)$/);
      if (helpDelMatch && method === 'DELETE') {
        return handleHelpMediaDelete(request, env, helpDelMatch[1]);
      }
      // Le plus spécifique d'abord : /media/(video|poster) avant /media
      const helpServeMatch = path.match(/^\/api\/help\/([A-Za-z0-9_-]+)\/media\/(video|poster)$/);
      if (helpServeMatch && (method === 'GET' || method === 'HEAD')) {
        return handleHelpMediaServe(request, env, helpServeMatch[1], helpServeMatch[2]);
      }
      const helpInfoMatch = path.match(/^\/api\/help\/([A-Za-z0-9_-]+)\/media$/);
      if (helpInfoMatch && method === 'GET') {
        return handleHelpMediaInfo(request, env, helpInfoMatch[1]);
      }

      // ── Vault (clés API) ─────────────────────────────────────
      if (path === '/api/admin/keys'         && method === 'GET')    return handleListKeys(request, env);
      if (path === '/api/admin/keys'         && method === 'POST')   return handleSaveKey(request, env);
      if (path === '/api/admin/keys'         && method === 'DELETE') return handleDeleteKey(request, env);
      if (path.startsWith('/api/admin/keys/') && method === 'GET') {
        const provider = path.split('/').pop();
        return handleGetKey(request, env, provider);
      }

      // ── Coffre serveur per-tenant des clés BYOK (Phase 3b, user JWT) ──
      if (path === '/api/keys' && method === 'POST') return handleSaveUserKey(request, env);
      if (path === '/api/keys' && method === 'GET')  return handleListUserKeys(request, env);
      {
        const keyDel = path.match(/^\/api\/keys\/([a-z0-9]+)$/);
        if (keyDel && method === 'DELETE') return handleDeleteUserKey(request, env, keyDel[1]);
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
    // DISPATCH par expression cron (wrangler.toml). La maintenance quotidienne est GATÉE
    // EXPLICITEMENT sur '0 3 * * *' (plus de fallthrough) → un cron inattendu ne déclenche
    // JAMAIS purges/refresh au mauvais rythme.
    const cron = event.cron;

    // Publication sociale (programmés / réessais / vidéo IG·Threads « en traitement ») : sur
    // TOUT cron fréquent (≠ quotidien) → couvre le cron minute (réactif, <1 min) ET le 5 min
    // (FILET prouvé, si le minute ne tire pas), quelle que soit la forme exacte de event.cron.
    // sweepDuePosts est idempotent (claim atomique) → exécutions concurrentes sans double-envoi.
    if (cron !== '0 3 * * *') {
      ctx.waitUntil(
        sweepDuePosts(env)
          .then(r => console.log('[social-sweep]', cron, JSON.stringify(r)))
          .catch(e => console.warn('[social-sweep] failed', e?.message || e))
      );
    }

    // Rappels web-push Keynapse échus — toutes les 5 min (même app fermée).
    if (cron === '*/5 * * * *') {
      ctx.waitUntil(
        sweepDueReminders(env)
          .then(r => console.log('[keynapse-reminders]', JSON.stringify(r)))
          .catch(e => console.warn('[keynapse-reminders] failed', e?.message || e))
      );
    }

    // Sentinel — battement de cœur (disponibilité des sites surveillés),
    // file lissée, toutes les 5 min. Idempotent (lot borné par tick).
    if (cron === '*/5 * * * *') {
      ctx.waitUntil(
        sweepDueChecks(env)
          .then(r => console.log('[sentinel-sweep]', JSON.stringify(r)))
          .catch(e => console.warn('[sentinel-sweep] failed', e?.message || e))
      );
    }

    // ── Maintenance quotidienne (0 3 * * *) — purges & refresh, GATÉE explicitement ──
    if (cron === '0 3 * * *') {
      ctx.waitUntil(handleScheduledPurge(env));
      // Refresh des tokens sociaux proches expiration (Threads ~60j).
      ctx.waitUntil(
        refreshSocialTokens(env)
          .then(r => console.log('[social-token-refresh]', JSON.stringify(r)))
          .catch(e => console.warn('[social-token-refresh] failed', e?.message || e))
      );
      // Purge des réponses Pulsa expirées (TTL par formulaire, 90j défaut).
      ctx.waitUntil(
        handlePulsaPurge(env)
          .then(r => console.log('[pulsa-purge]', JSON.stringify(r)))
          .catch(e => console.warn('[pulsa-purge] failed', e?.message || e))
      );
      // Rappels d'expiration licence (J-7/J-3/J-1) — dormant sauf KS_EXPIRATION_REMINDERS_ENABLED.
      ctx.waitUntil(
        handleExpirationReminders(env)
          .then(r => console.log('[expiration-reminders]', JSON.stringify(r)))
          .catch(e => console.warn('[expiration-reminders] failed', e?.message || e))
      );
      // Auto-dégradation Concierge des licences inactives — dormant sauf KS_CONCIERGE_AUTODOWNGRADE_ENABLED.
      ctx.waitUntil(
        handleConciergeAutoDowngrade(env)
          .then(r => console.log('[concierge-downgrade]', JSON.stringify(r)))
          .catch(e => console.warn('[concierge-downgrade] failed', e?.message || e))
      );
      // Péremption des fiches Smart Agent (review_at échu → quarantine) + purge RGPD publique.
      ctx.waitUntil(
        handleSmartAgentLifecycle(env)
          .then(r => console.log('[smart-agent-lifecycle]', JSON.stringify(r)))
          .catch(e => console.warn('[smart-agent-lifecycle] failed', e?.message || e))
      );
      // Funnel landing — purge des événements > 90j (minimisation RGPD).
      ctx.waitUntil(
        pruneTrackEvents(env)
          .then(r => console.log('[track-prune]', JSON.stringify(r)))
          .catch(e => console.warn('[track-prune] failed', e?.message || e))
      );
    }
  },
};
