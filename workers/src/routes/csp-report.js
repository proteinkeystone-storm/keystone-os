/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — CSP Report endpoint (Sprint Sécu-2 / H5)
   ─────────────────────────────────────────────────────────────
   Reçoit les rapports de violations CSP envoyés par les navigateurs
   quand un asset est bloqué (ou serait bloqué en mode Report-Only).

   Body Chrome/Firefox : { "csp-report": { ... } }
   Body navigateurs récents (report-to) : tableau JSON.

   On log uniquement en console (visible via `npx wrangler tail`).
   Pas de stockage D1 : volume potentiellement élevé en cas de page
   très bavarde, et le but est le diagnostic ponctuel pendant le
   passage en enforcement, pas de la métrique long terme.
   ═══════════════════════════════════════════════════════════════ */

import { json, getAllowedOrigin } from '../lib/auth.js';

export async function handleCspReport(request, env) {
  const origin = getAllowedOrigin(env, request);

  let body = null;
  try { body = await request.json(); } catch (_) {}

  // Normaliser : Chrome envoie { "csp-report": {...} }, Firefox parfois pareil.
  const report = body?.['csp-report'] || body || null;

  if (report) {
    // Log compact pour wrangler tail
    console.warn('[CSP-VIOLATION]', JSON.stringify({
      blockedUri:    report['blocked-uri']    || report.blockedURL,
      violatedDir:   report['violated-directive'] || report.effectiveDirective,
      documentUri:   report['document-uri']   || report.documentURL,
      sourceFile:    report['source-file']    || report.sourceFile,
      lineNumber:    report['line-number']    || report.lineNumber,
      originalPolicy: (report['original-policy'] || '').slice(0, 200),
    }));
  } else {
    console.warn('[CSP-VIOLATION] body non parsable');
  }

  // 204 No Content : pas besoin de répondre quoi que ce soit au navigateur.
  return new Response(null, {
    status: 204,
    headers: { 'Access-Control-Allow-Origin': origin },
  });
}
