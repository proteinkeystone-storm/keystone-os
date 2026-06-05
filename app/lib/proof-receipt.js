/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Key Form · Certificat de preuve (reçu téléchargeable)
   ─────────────────────────────────────────────────────────────
   Génère un « Certificat de preuve » imprimable (→ PDF via la boîte
   d'impression du navigateur) pour une réponse Key Form :
   horodatage serveur, empreinte SHA-256, IP/navigateur (si formulaire
   non anonyme), et le contenu signé. Aucune dépendance externe —
   réutilise le pattern window.open + print() (cf. pdf-export.js).
   ═══════════════════════════════════════════════════════════════ */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function fmtDate(ts) {
  if (!ts) return '—';
  // created_at D1 est en UTC sans suffixe → on force Z si absent.
  const norm = /Z$|[+-]\d\d:?\d\d$/.test(ts) ? ts : ts + 'Z';
  const d = new Date(norm);
  if (isNaN(d.getTime())) return String(ts);
  return d.toLocaleString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function choiceLabel(field, id) {
  const ch = (field.options?.choices || []).find(c => c.id === id);
  return ch ? ch.label : id;
}

function fmtValue(field, raw) {
  if (raw == null || raw === '') return '<em class="muted">(vide)</em>';
  const t = field.type;
  if (t === 'signature') {
    return `<img src="${esc(raw)}" alt="Signature" style="max-width:320px;background:#fff;border:1px solid #cbd5e1;border-radius:6px;padding:6px"/>`;
  }
  if (t === 'yes-no') {
    const o = field.options || {};
    return esc(raw === 'yes' ? (o.yes_label || 'Oui') : raw === 'no' ? (o.no_label || 'Non') : raw);
  }
  if (t === 'chips' || t === 'likert' || t === 'image-picker') {
    return esc(Array.isArray(raw) ? raw.map(id => choiceLabel(field, id)).join(', ') : choiceLabel(field, raw));
  }
  if (t === 'cards' && Array.isArray(raw)) {
    return esc(raw.map(id => choiceLabel(field, id)).join(', '));
  }
  if (t === 'rank-top3' && Array.isArray(raw)) {
    return esc(raw.filter(Boolean).join('  ›  '));
  }
  if (t === 'repeater' && Array.isArray(raw)) {
    if (!raw.length) return '<em class="muted">(aucun)</em>';
    return raw.map(item => `<div style="margin:3px 0;padding-left:10px;border-left:2px solid #e2e8f0">${esc(Object.values(item || {}).filter(v => v != null && v !== '').join('  ·  '))}</div>`).join('');
  }
  if (Array.isArray(raw)) return esc(raw.join(', '));
  if (raw && typeof raw === 'object') {
    return `<pre style="white-space:pre-wrap;margin:0;font:inherit">${esc(JSON.stringify(raw, null, 2))}</pre>`;
  }
  return esc(String(raw)).replace(/\n/g, '<br>');
}

/**
 * Ouvre une fenêtre avec le certificat de preuve et déclenche l'impression
 * (l'utilisateur choisit « Enregistrer au format PDF »).
 * @param {object} form     structure du formulaire (meta + sections)
 * @param {object} response réponse { id, responses, created_at, expires_at,
 *                          response_hash, submitter_ip, user_agent }
 */
export function downloadProofReceipt(form, response) {
  const meta = form?.meta || {};
  const sections = form?.sections || [];
  const values = response?.responses || {};
  const hash = response?.response_hash;
  const ip = response?.submitter_ip;
  const ua = response?.user_agent;
  const anonymous = meta.anonymous !== false;

  const sectionsHtml = sections.map(sec => {
    const rows = (sec.fields || []).map(f => `
      <tr><td class="lbl">${esc(f.label || '')}</td><td class="val">${fmtValue(f, values[f.id])}</td></tr>
    `).join('');
    if (!rows.trim()) return '';
    return `<tr><td colspan="2" class="sec">${esc(sec.title || 'Section')}</td></tr>${rows}`;
  }).join('');

  const proofRows = [
    ['Formulaire', esc(meta.title || '—') + (meta.slug ? ` <span class="muted">/f/${esc(meta.slug)}</span>` : '')],
    ['Identifiant de la réponse', `<code>${esc(response.id || '—')}</code>`],
    ['Horodatage serveur (réception)', esc(fmtDate(response.created_at))],
    ['Empreinte d\'intégrité (SHA-256)', hash ? `<code class="hash">${esc(hash)}</code>` : '<em class="muted">non disponible (réponse antérieure à cette fonction)</em>'],
    ['Adresse IP du signataire', ip ? `<code>${esc(ip)}</code>` : `<em class="muted">non capturée${anonymous ? ' (formulaire anonyme)' : ''}</em>`],
    ['Navigateur', ua ? esc(ua) : '<em class="muted">—</em>'],
  ].map(([k, v]) => `<tr><td class="lbl">${k}</td><td class="val">${v}</td></tr>`).join('');

  const genDate = fmtDate(new Date().toISOString());

  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"/>
  <title>Certificat-de-preuve-${esc(response.id || '')}</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0f172a;background:#fff}
    .wrap{max-width:760px;margin:0 auto;padding:40px 44px}
    .eyebrow{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#b08d57;font-weight:800}
    h1{font-size:25px;font-weight:900;letter-spacing:-.02em;margin:6px 0 2px}
    .sub{color:#64748b;font-size:13px;margin:0 0 22px}
    h2{font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:#334155;margin:26px 0 6px}
    table{width:100%;border-collapse:collapse}
    td{padding:9px 0;border-bottom:1px solid #eef2f6;vertical-align:top;font-size:13px;line-height:1.5}
    td.lbl{width:38%;color:#64748b;font-weight:600;padding-right:16px}
    td.val{color:#0f172a}
    td.sec{padding:18px 0 6px;border-bottom:none;font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:800;color:#b08d57}
    code{font-family:'SF Mono',Menlo,Consolas,monospace;font-size:12px;background:#f1f5f9;padding:1px 5px;border-radius:4px}
    code.hash{word-break:break-all;font-size:11px}
    .muted{color:#94a3b8}
    .block{margin:16px 0;padding:16px 18px;border:1px solid #e2e8f0;border-radius:10px}
    .note{background:#f8fafc;color:#475569;font-size:12px;line-height:1.6}
    .foot{margin-top:26px;padding-top:14px;border-top:1px solid #eef2f6;color:#94a3b8;font-size:11px}
    @media print{.wrap{padding:0}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head>
  <body><div class="wrap">
    <div class="eyebrow">Keystone OS · Key Form</div>
    <h1>Certificat de preuve</h1>
    <p class="sub">Document généré le ${esc(genDate)}</p>

    <div class="block"><table>${proofRows}</table></div>

    <div class="note block">
      <strong>Valeur de preuve.</strong> L'empreinte SHA-256 ci-dessus a été calculée par le serveur au moment exact de la réception. Toute modification ultérieure des réponses produirait une empreinte différente : une altération serait donc immédiatement détectable. La signature recueillie constitue une <strong>signature électronique simple horodatée</strong> (règlement eIDAS, niveau simple), recevable comme commencement de preuve.
    </div>

    <h2>Réponses soumises</h2>
    <table>${sectionsHtml}</table>

    <div class="foot">Certificat émis par Protein Studio · Keystone OS — Key Form.${response.expires_at ? ' Donnée conservée jusqu\'au ' + esc(fmtDate(response.expires_at)) + '.' : ''}</div>
  </div>
  <script>setTimeout(function(){try{window.print();}catch(e){}},400);<\/script>
  </body></html>`;

  const win = window.open('', '_blank', 'width=900,height=780,menubar=yes');
  if (!win) { alert('Autorisez les pop-ups pour générer le certificat de preuve.'); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
}
