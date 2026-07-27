/* ═══════════════════════════════════════════════════════════════
   Atelier vidéos d'aide — DRIVER DE TOURNAGE (in-page)
   ─────────────────────────────────────────────────────────────
   Rejoue un scénario de façon DÉTERMINISTE, image par image :
   film.py appelle window.__film.tick(tMs) puis capture un
   screenshot — toute l'animation (curseur, frappe, cartons,
   bandeau) est une pure fonction du temps t. Aucun setTimeout.

   Posé sur la page par le harnais de tournage :
     import { mountFilm } from './tournage.js';
     mountFilm({ steps, icon, meta });

   DSL des étapes (toutes les valeurs en ms depuis 0) :
     { at, intro:  { dur } }                     carton d'ouverture
     { at, outro:  { dur } }                     carton de fin
     { at, caption: 'texte' }                    bandeau bas
     { at, moveTo: 'sel', dur }                  le curseur glisse
     { at, click:  'sel' }                       clic réel + pulse
     { at, type:   { sel, text, cps } }          frappe progressive
     { at, select: { sel, value } }              change un <select>
     { at, waitFor: 'sel', timeout }             gèle le temps
     { at, scrollTo: 'sel' }                     centre l'élément
   tick() renvoie { waiting, done } — film.py gèle la timeline
   tant que waiting=true (les frames continuent d'être capturées).
   ═══════════════════════════════════════════════════════════════ */

const Z = 2147483000;   // au-dessus des workspaces fullscreen des pads

export function mountFilm({ steps, meta = {} }) {
  const doc = document;

  // ── Décor : curseur + bandeau + carton ───────────────────────
  const cursor = doc.createElement('div');
  cursor.id = 'film-cursor';
  cursor.innerHTML = `<svg width="26" height="26" viewBox="0 0 24 24" style="filter:drop-shadow(0 1px 3px rgba(0,0,0,.6))">
    <path d="M5 3 L19 12.5 L12.6 13.6 L16 20.6 L13.4 21.8 L10 14.8 L5 19 Z" fill="#fff" stroke="#111" stroke-width="1.1" stroke-linejoin="round"/></svg>`;
  Object.assign(cursor.style, {
    position: 'fixed', left: '0', top: '0', zIndex: Z + 2,
    pointerEvents: 'none', transform: 'translate(640px, 700px)',
    transition: 'none',
  });

  const ripple = doc.createElement('div');
  Object.assign(ripple.style, {
    position: 'fixed', width: '34px', height: '34px', borderRadius: '50%',
    border: '2.5px solid rgba(255,255,255,.9)', zIndex: Z + 1,
    pointerEvents: 'none', opacity: '0', transform: 'translate(-50%,-50%) scale(.4)',
  });

  const band = doc.createElement('div');
  band.id = 'film-band';
  // Bandeau VIOLET bien visible + grande police (retour Stéphane 28/07).
  Object.assign(band.style, {
    position: 'fixed', left: '0', right: '0', bottom: '0', height: '72px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'linear-gradient(180deg, #5B54F0 0%, #4F46E5 100%)',
    boxShadow: '0 -4px 18px rgba(79,70,229,.45)',
    zIndex: Z, pointerEvents: 'none',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontSize: '24px', fontWeight: '700', letterSpacing: '-0.02em',
    color: '#fff', opacity: '0', textShadow: '0 1px 2px rgba(0,0,0,.25)',
  });
  const bandText = doc.createElement('span');
  band.appendChild(bandText);

  const card = doc.createElement('div');
  card.id = 'film-card';
  Object.assign(card.style, {
    position: 'fixed', inset: '0', zIndex: Z + 3,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: '18px', background: '#080B19', opacity: '0', pointerEvents: 'none',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    color: '#fff', textAlign: 'center',
  });
  card.innerHTML = `
    <img src="/LOGOS/Logo%20KEYSTONE%20dark-gold.svg" alt="" style="height:44px;margin-bottom:10px">
    <div id="film-card-icon" style="color:#C9A961;width:64px;height:64px"></div>
    <div id="film-card-name" style="font-size:40px;font-weight:900;letter-spacing:-0.02em"></div>
    <div id="film-card-sub" style="font-size:17px;font-weight:500;color:rgba(255,255,255,.65);max-width:520px;line-height:1.45"></div>`;

  doc.body.append(band, ripple, cursor, card);

  if (meta.iconSvg) card.querySelector('#film-card-icon').innerHTML = meta.iconSvg;
  card.querySelector('#film-card-name').textContent = meta.name || '';
  card.querySelector('#film-card-sub').textContent = meta.subtitle || '';

  // ── État du tournage ─────────────────────────────────────────
  const st = {
    cursor: { x: 640, y: 700 },        // position courante (px viewport)
    tween: null,                        // { fromX, fromY, toSel, at, dur }
    typing: null,                       // { sel, text, cps, at, done }
    fired: new Set(),                   // index des étapes déjà déclenchées
    caption: '',
    stallSince: null,
  };

  const q = (sel) => doc.querySelector(sel);
  const center = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 24) };
  };

  const setCursor = (x, y) => {
    st.cursor = { x, y };
    cursor.style.transform = `translate(${x}px, ${y}px)`;
  };

  const realClick = (el, x, y) => {
    const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.click();
    ripple.style.left = `${x}px`; ripple.style.top = `${y}px`;
    ripple.animate?.([
      { opacity: .9, transform: 'translate(-50%,-50%) scale(.4)' },
      { opacity: 0, transform: 'translate(-50%,-50%) scale(1.35)' },
    ], { duration: 420 });
  };

  const ease = (p) => p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;

  // ── La pompe à temps ─────────────────────────────────────────
  async function tick(t) {
    let waiting = false;

    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (s.at > t) break;

      // waitFor : gèle la timeline tant que la cible n'existe pas.
      if (s.waitFor && !st.fired.has(i)) {
        if (q(s.waitFor)) { st.fired.add(i); st.stallSince = null; }
        else { waiting = true; break; }
      }
      if (st.fired.has(i)) {
        // tween / frappe en cours : animés plus bas, hors déclenchement
        continue;
      }

      if (s.intro) {
        st.fired.add(i);
        st.card = { kind: 'intro', at: s.at, dur: s.intro.dur };
      } else if (s.outro) {
        st.fired.add(i);
        st.card = { kind: 'outro', at: s.at, dur: s.outro.dur };
        card.querySelector('#film-card-icon').style.display = 'none';
        card.querySelector('#film-card-name').textContent = 'Keystone OS';
        card.querySelector('#film-card-sub').textContent = meta.outro || 'Toute votre communication sur une seule plateforme.';
      } else if (s.caption !== undefined) {
        st.fired.add(i);
        st.caption = s.caption;
        bandText.textContent = s.caption;
        band.style.opacity = s.caption ? '1' : '0';
      } else if (s.moveTo) {
        st.fired.add(i);
        const el = q(s.moveTo);
        if (el) {
          el.scrollIntoView({ block: 'center', behavior: 'instant' });
          st.tween = { fromX: st.cursor.x, fromY: st.cursor.y, toSel: s.moveTo, at: s.at, dur: s.dur || 800 };
        }
      } else if (s.click) {
        st.fired.add(i);
        const el = q(s.click);
        if (el) { const c = center(el); setCursor(c.x, c.y); realClick(el, c.x, c.y); }
      } else if (s.type) {
        st.fired.add(i);
        const el = q(s.type.sel);
        el?.focus();
        st.typing = { ...s.type, at: s.at, printed: 0 };
      } else if (s.select) {
        st.fired.add(i);
        const el = q(s.select.sel);
        if (el) {
          el.value = s.select.value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      } else if (s.scrollTo) {
        st.fired.add(i);
        q(s.scrollTo)?.scrollIntoView({ block: 'center', behavior: 'instant' });
      } else if (s.run) {
        st.fired.add(i);
        try { await s.run(doc); } catch (_) {}
      }
    }

    // Tween curseur
    if (st.tween) {
      const { fromX, fromY, toSel, at, dur } = st.tween;
      const el = q(toSel);
      if (el) {
        const c = center(el);
        const p = Math.min(1, Math.max(0, (t - at) / dur));
        const e = ease(p);
        setCursor(fromX + (c.x - fromX) * e, fromY + (c.y - fromY) * e);
        if (p >= 1) st.tween = null;
      } else st.tween = null;
    }

    // Frappe progressive
    if (st.typing) {
      const { sel, text, cps = 10, at } = st.typing;
      const el = q(sel);
      if (el) {
        const want = Math.min(text.length, Math.floor(((t - at) / 1000) * cps));
        if (want > st.typing.printed) {
          el.value = text.slice(0, want);
          el.dispatchEvent(new InputEvent('input', { bubbles: true }));
          st.typing.printed = want;
        }
        if (want >= text.length) st.typing = null;
      } else st.typing = null;
    }

    // Cartons (fondu piloté par t)
    if (st.card) {
      const { at, dur } = st.card;
      const FADE = 350;
      let o = 0;
      if (t < at + FADE) o = (t - at) / FADE;
      else if (t < at + dur - FADE) o = 1;
      else if (t < at + dur) o = (at + dur - t) / FADE;
      else { o = 0; st.card = null; }
      card.style.opacity = String(Math.max(0, Math.min(1, o)));
    }

    const last = steps[steps.length - 1];
    const done = !waiting && t >= (last.at + (last.outro?.dur || last.intro?.dur || 0) + 200);
    return { waiting, done };
  }

  window.__film = { tick };
  window.__filmReady = true;
}
