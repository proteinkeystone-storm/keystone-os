/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Master Renderer v0.1 (Sprint B Phase 1)
   ─────────────────────────────────────────────────────────────
   Générateurs HTML purs pour les pads et artefacts.
   Extrait de ui-renderer.js _buildModal / _buildArtifactModal /
   _buildField / _renderNotice — fidélité 1:1 de la sortie HTML.

   Status : ADDITIF — aucun changement de comportement par défaut.
   Activation via feature flag :
     - window.__KS_MASTER_RENDERER__ = true   (in-memory, dev)
     - localStorage.setItem('ks_master_renderer', '1')  (persistant)

   Doctrine appliquée :
     - Fonctions PURES (no DOM access, no side effects)
     - Pas d'event listeners ici (les bindings restent dans
       ui-renderer.js pour ne pas dupliquer la logique)
     - Aucun import de globals / state ; tout passe par ctx

   Phase 2 (par Stéphane au retour) :
     - Migration des 3 pads form-driven (A1/A2/A9) vers JSON pur
     - Suppression de _buildModal / _buildArtifactModal / _buildField
       de ui-renderer.js (legacy templates remplacés)
   ═══════════════════════════════════════════════════════════════ */

import { COMP_ICONS } from './artifact-renderer.js';

// ── Constants (extraction depuis ui-renderer.js) ─────────────────

// Labels de catégorie depuis le NOMEN-K id (ex: O-IMM-001 → IMMOBILIER).
// NOTE : "COM" était absent de la map originale dans ui-renderer.js
// (les pads A-COM-* sont des artefacts fullscreen → pas concernés en
// pratique). Ajouté ici par cohérence, mais inutilisé pour A2 (catCode
// = IMM). À reporter dans ui-renderer.js après validation.
export const CAT_LABELS = {
    IMM: 'IMMOBILIER',
    MKT: 'MARKETING',
    ANL: 'ANALYSE',
    ADM: 'ADMIN',
    COM: 'COMMUNICATION',
};

const CHEVRON_SVG = `<svg class="ks-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 6l4 4 4-4"/></svg>`;

// ── Helpers exposés ──────────────────────────────────────────────

/**
 * Résout le label de catégorie depuis un NOMEN-K id.
 * 'O-IMM-002' → 'IMMOBILIER' (fallback 'IMM' si inconnu).
 */
export function resolveCatLabel(nomenId) {
    const code = (nomenId || '').split('-')[1] || '';
    return CAT_LABELS[code] || code;
}

// ── Générateurs HTML purs ────────────────────────────────────────

/**
 * Convertit "1. Texte\n2. Texte\n• Texte" en liste HTML <ul>.
 * Pure : no DOM access, no side effects.
 */
export function renderNotice(text) {
    if (!text) return '';
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const items = lines.map(line => {
        const clean = line.replace(/^\d+\.\s*/, '').replace(/^[•–-]\s*/, '');
        return `<li class="notice-item">${clean}</li>`;
    });
    return `<ul class="notice-list">${items.join('')}</ul>`;
}

/**
 * Génère le HTML d'un champ de formulaire depuis sa définition JSON.
 * Pure : no DOM access, no event listeners. Les bindings (custom
 * select, multiselect, ai-assist) sont attachés ailleurs après
 * injection du HTML.
 *
 * Supporte : select, multiselect, textarea, text, number, email, etc.
 * Hooks : ai_assist (ajoute un bouton ✨ à câbler dans ui-renderer).
 */
export function renderField(f) {
    const spanCls = f.span === 'full' ? ' full' : '';
    const req     = f.required ? ' <span class="req">*</span>' : '';
    let input = '';

    if (f.type === 'select') {
        const defaultVal = (f.options || [])[0] || '';
        const opts = (f.options || []).map((o, i) =>
            `<div class="ks-opt" data-val="${o}"${i === 0 ? ' data-selected' : ''} role="option">${o}</div>`
        ).join('');
        input = `
            <div class="ks-select" data-field="${f.id}">
                <div class="ks-select-trigger" id="ks-wrap-${f.id}">
                    <button type="button" class="ks-select-btn" aria-haspopup="listbox" aria-expanded="false" id="ks-btn-${f.id}">
                        <span class="ks-select-val">${defaultVal}</span>
                    </button>
                    ${CHEVRON_SVG}
                </div>
                <div class="ks-select-list" role="listbox" hidden id="ks-list-${f.id}">${opts}</div>
                <input type="hidden" id="f-${f.id}" name="${f.id}" value="${defaultVal}">
            </div>`;
    } else if (f.type === 'multiselect') {
        const defaultArr = Array.isArray(f.default) ? f.default : [];
        const defaultVal = defaultArr.join(', ');
        const opts = (f.options || []).map(o => {
            const checked = defaultArr.includes(o) ? 'checked' : '';
            return `<label class="ks-multi-opt">
                <input type="checkbox" value="${o}" ${checked}>
                <span class="ks-multi-opt-lbl">${o}</span>
            </label>`;
        }).join('');
        input = `
            <div class="ks-multiselect" data-field="${f.id}">
                <div class="ks-multi-grid">${opts}</div>
                <input type="hidden" id="f-${f.id}" name="${f.id}" value="${defaultVal}">
            </div>`;
    } else if (f.type === 'textarea') {
        input = `<textarea class="form-textarea" id="f-${f.id}" name="${f.id}" placeholder="${f.placeholder || ''}"></textarea>`;
    } else {
        input = `<input class="form-input" type="${f.type}" id="f-${f.id}" name="${f.id}" placeholder="${f.placeholder || ''}" ${f.required ? 'required' : ''}>`;
    }

    const aiAssistBtn = f.ai_assist ? `
        <div class="ai-assist-wrap">
            <button type="button" class="ai-assist-btn"
                    data-field-id="${f.id}"
                    aria-label="Générer avec IA">
                <span class="ai-assist-icon">✨</span>
                <span class="ai-assist-label">${f.ai_assist.label || 'Générer avec IA'}</span>
                <span class="ai-assist-spinner" hidden>
                    <svg viewBox="0 0 24 24" width="14" height="14"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-dasharray="14 28" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite"/></circle></svg>
                </span>
            </button>
            <span class="ai-assist-status" id="ai-status-${f.id}"></span>
        </div>` : '';

    return `
        <div class="form-field${spanCls}">
            <label class="form-label" for="${f.type === 'select' ? 'ks-btn-' : 'f-'}${f.id}" style="text-transform:none;letter-spacing:normal;font-size:14px;font-weight:500;">${f.label}${req}</label>
            ${input}
            ${aiAssistBtn}
        </div>
    `;
}

/**
 * Génère le HTML complet d'un modal de pad form-driven (non-artifact).
 * Pure : no DOM access, no event listeners.
 *
 * ctx requis :
 *   icons              — Map<string, string> des SVG (ICONS du ui-renderer)
 *   nomenId            — NOMEN-K id (ex: 'O-IMM-002')
 *   catLabel           — Label catégorie (ex: 'IMMOBILIER')
 *   engine             — Engine actif (ex: 'Claude')
 *   hasApiKey          — boolean
 *   helpButtonHTML     — string HTML du bouton aide (pré-généré)
 *   ratingButtonHTML   — string HTML du bouton notation (pré-généré)
 */
export function renderPadModalHTML(pad, ctx) {
    if (pad.type === 'artifact') {
        return renderArtifactModalHTML(pad, ctx);
    }

    const { icons, nomenId, catLabel, engine, hasApiKey, helpButtonHTML, ratingButtonHTML } = ctx;
    const fieldsHTML    = pad.fields.map(renderField).join('');
    const hasDocExport  = !!pad.doc_export;
    const requiredCount = pad.fields.filter(f => f.required).length;

    const generateBtn = hasDocExport
        ? ''
        : (hasApiKey
            ? `<button class="btn-generate" id="btn-generate" ${requiredCount > 0 ? 'disabled' : ''}>
                   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;flex-shrink:0"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                   Générer avec ${engine}
               </button>`
            : `<button class="no-api-hint" id="no-api-link" type="button">
                   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:14px;height:14px;flex-shrink:0"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                   Configurer une clé API pour générer directement
                   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px;flex-shrink:0;opacity:.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
               </button>`);

    const docExportBtn = hasDocExport
        ? `<button class="btn-generate btn-doc-primary" id="btn-doc-export" type="button" title="Générer la notice PDF print-ready">
               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;flex-shrink:0">
                   <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                   <polyline points="14 2 14 8 20 8"/>
                   <line x1="9" y1="13" x2="15" y2="13"/>
                   <line x1="9" y1="17" x2="13" y2="17"/>
               </svg>
               <span>${pad.doc_export.label || 'Notice PDF'}</span>
               <span class="btn-doc-export-spinner" hidden>
                   <svg viewBox="0 0 24 24" width="14" height="14"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-dasharray="14 28" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite"/></circle></svg>
               </span>
           </button>`
        : '';

    return `
        <div class="modal-handle"></div>

        <div class="modal-head">
            <div class="modal-ico">${icons[pad.icon] || icons['zap']}</div>
            <div class="modal-meta">
                <div class="modal-code">${nomenId} — ${catLabel}</div>
                <div class="modal-title">${pad.title}</div>
                <div class="modal-subtitle">${pad.subtitle}</div>
                <div class="modal-engine-chip">
                    <div class="modal-engine-dot"></div>
                    Recommandé : <strong>${pad.ai_optimized}</strong>
                </div>
            </div>
            <div class="modal-head-tools">
                <div class="modal-head-tools-top">
                    ${helpButtonHTML}
                </div>
                ${ratingButtonHTML}
            </div>
            <button class="modal-close" id="modal-close-btn" aria-label="Fermer">✕</button>
        </div>

        <div class="modal-body${hasDocExport ? ' modal-body--solo' : ''}">

            <div class="modal-form">
                <form id="tool-form" class="form-grid" onsubmit="return false">
                    ${fieldsHTML}
                </form>

                ${hasDocExport ? `
                <div class="form-warnings" id="form-warnings" hidden></div>
                ` : ''}

                <div class="modal-actions-row">
                    ${generateBtn}
                    ${docExportBtn}
                    ${hasDocExport ? `
                    <button class="action-btn action-btn-compact" id="btn-library" type="button" title="Sauvegarder dans la bibliothèque">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;flex-shrink:0"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                        Bibliothèque
                    </button>
                    ` : ''}
                </div>
            </div>

            ${!hasDocExport ? `
            <div class="modal-result-zone" data-mode="prompt">

                <div class="result-lbl" id="result-lbl">Prompt généré</div>

                <div class="prompt-empty-state" id="prompt-empty-state">
                    <div class="prompt-empty-cursor"></div>
                    <div class="prompt-empty-hint" id="prompt-empty-hint">
                        Remplissez les champs requis<br>pour générer votre prompt
                    </div>
                    <div class="prompt-missing-fields" id="prompt-missing-fields"></div>
                </div>

                <pre class="prompt-text" id="prompt-text" style="display:none"></pre>

                <div class="result-actions">
                    <button class="action-btn" id="btn-copy-prompt" title="Copier le prompt">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;flex-shrink:0"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                        Copier le prompt
                    </button>
                    <button class="action-btn" id="btn-library" title="Sauvegarder dans la bibliothèque">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;flex-shrink:0"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                        Bibliothèque
                    </button>
                </div>

                ${hasApiKey ? `
                <div class="ai-divider">
                    <div class="ai-divider-line"></div>
                    <div class="ai-divider-lbl">Réponse IA</div>
                    <div class="ai-divider-line"></div>
                </div>
                <div class="result-content" id="result-content"></div>
                <button class="btn-copy" id="btn-copy">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    Copier la réponse
                </button>` : ''}

            </div>
            ` : ''}
        </div>

        <div class="modal-library" id="modal-library" hidden>
            <div class="modal-library-head">
                <div class="modal-library-title">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;flex-shrink:0;opacity:.8"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
                    Bibliothèque · ${pad.title}
                </div>
                <button class="modal-library-close" id="modal-library-close" aria-label="Fermer la bibliothèque">✕</button>
            </div>
            <div class="modal-library-list" id="modal-library-list"></div>
        </div>
    `;
}

/**
 * Génère le HTML complet d'un modal d'artefact JSON (pad.type === 'artifact').
 * Pure : no DOM access, no event listeners.
 */
export function renderArtifactModalHTML(pad, ctx) {
    const { icons, nomenId, catLabel, hasApiKey } = ctx;

    const schema     = pad.artifact_config?.output_schema || {};
    const schemaKeys = Object.entries(schema);
    const chipPreview = schemaKeys.length
        ? schemaKeys.map(([, def]) =>
            `<span class="artifact-schema-chip">${COMP_ICONS[def.component] || '◈'} ${def.label}</span>`
          ).join('')
        : '<span style="color:var(--text-muted);font-size:11px">Aucun composant défini</span>';

    const generateBtn = hasApiKey
        ? `<button class="btn-generate" id="btn-generate">
               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;flex-shrink:0"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
               Générer l'artefact
           </button>`
        : `<button class="no-api-hint" id="no-api-link" type="button">
               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:14px;height:14px;flex-shrink:0"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
               Configurer une clé API pour générer
               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px;flex-shrink:0;opacity:.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
           </button>`;

    return `
        <div class="modal-handle"></div>

        <div class="modal-head">
            <div class="modal-ico">${icons[pad.icon] || icons['zap']}</div>
            <div class="modal-meta">
                <div class="modal-code">${nomenId} — ${catLabel}</div>
                <div class="modal-title">${pad.title}</div>
                <div class="modal-subtitle">${pad.subtitle}</div>
                <div class="modal-engine-chip">
                    <div class="modal-engine-dot" style="background:#6496ff"></div>
                    Artefact JSON · <strong>${pad.ai_optimized}</strong>
                </div>
            </div>
            <div class="modal-rating">
                <div class="modal-rating-lbl">Note</div>
                <div class="modal-rating-stars" id="modal-rating-stars">
                    ${[1,2,3,4,5].map(v => `
                        <button type="button" class="rating-star" data-v="${v}" aria-label="${v} étoile${v > 1 ? 's' : ''}">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15 9 22 9.5 16.5 14.5 18 22 12 18 6 22 7.5 14.5 2 9.5 9 9 12 2"/></svg>
                        </button>
                    `).join('')}
                </div>
            </div>
            <button class="modal-close" id="modal-close-btn" aria-label="Fermer">✕</button>
        </div>

        <div class="modal-body">

            <div class="modal-form">
                ${pad.notice ? `<div class="tool-notice open">${renderNotice(pad.notice)}</div>` : ''}
                <div class="artifact-compose-zone">
                    <div class="artifact-compose-label">
                        <span style="color:#6496ff;font-size:13px">◈</span>
                        Composants attendus
                    </div>
                    <div class="artifact-schema-chips">${chipPreview}</div>
                </div>
                <div class="form-field full" style="margin-bottom:0">
                    <label class="form-label">
                        Contexte additionnel <span style="font-weight:400;opacity:.6">(optionnel)</span>
                    </label>
                    <textarea id="artifact-context" class="form-textarea"
                              placeholder="Adresse, superficie, budget, données spécifiques à injecter…"
                              style="min-height:110px;resize:vertical"></textarea>
                </div>
                ${generateBtn}
            </div>

            <div class="modal-result-zone">
                <div class="result-lbl" id="result-lbl">Résultat de l'artefact</div>

                <div class="artifact-empty-state" id="artifact-empty-state">
                    <div class="artifact-empty-icon">🔷</div>
                    <p>Appuyez sur <strong>"Générer l'artefact"</strong><br>pour lancer l'analyse IA</p>
                </div>

                <div id="artifact-result" style="display:none"></div>

                <div class="result-actions" id="artifact-actions" style="display:none">
                    <button class="action-btn" id="btn-artifact-copy-json">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                        Copier JSON brut
                    </button>
                    <button class="action-btn action-btn--gold" id="btn-artifact-pdf">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                        Exporter PDF
                    </button>
                </div>
            </div>
        </div>
    `;
}

// ── Chargement schéma JSON (optionnel, pour Phase 2) ─────────────

/**
 * Charge un schéma de pad depuis K_STORE_ASSETS/PADS/{nomenId}.json.
 * Renvoie null si 404 ou erreur fetch (le caller décide du fallback).
 *
 * IMPORTANT : nomenId = ID complet 'O-IMM-002', pas le padKey 'A2'.
 *
 * Phase 1 (actuelle) : non utilisée par le wire-up dans ui-renderer.js,
 * qui passe le pad depuis pads-data.js. Exposée pour permettre une
 * comparaison JSON vs JS lors des tests manuels, et pour la Phase 2.
 */
export async function loadPadSchemaFromJSON(nomenId) {
    try {
        const res = await fetch(`/K_STORE_ASSETS/PADS/${nomenId}.json`, { cache: 'no-cache' });
        if (!res.ok) return null;
        return await res.json();
    } catch (_) {
        return null;
    }
}

// ── Feature flag ─────────────────────────────────────────────────

/**
 * Détecte si le Master Renderer doit être utilisé.
 * Activation :
 *   - window.__KS_MASTER_RENDERER__ = true     (dev, in-memory)
 *   - localStorage.setItem('ks_master_renderer', '1')  (persistant)
 *
 * Par défaut : false → ui-renderer.js continue avec ses templates inline.
 */
export function isMasterRendererEnabled() {
    if (typeof window === 'undefined') return false;
    if (window.__KS_MASTER_RENDERER__ === true) return true;
    try {
        return localStorage.getItem('ks_master_renderer') === '1';
    } catch (_) {
        return false;
    }
}
