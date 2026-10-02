/* =============================================================================
   NOVA CART — PROMISE ENGINE
   ui.js — shared view helpers
   ========================================================================== */
(function (global) {
  'use strict';

  /* --------------------------------------------------------------- money --- */
  // Indian numbering: 1,20,000 / 26.1L / 2.55Cr — never "2610000".
  function inr(n, opts = {}) {
    const v = Number(n) || 0;
    const abs = Math.abs(v);
    if (opts.exact) return '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
    if (abs >= 1e7) return '₹' + (v / 1e7).toFixed(abs >= 1e8 ? 1 : 2) + ' Cr';
    if (abs >= 1e5) return '₹' + (v / 1e5).toFixed(abs >= 1e6 ? 1 : 2) + 'L';
    if (abs >= 1000) return '₹' + (v / 1000).toFixed(1) + 'k';
    return '₹' + v.toFixed(0);
  }
  const inrFull = (n) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  const num = (n, d = 0) => (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
  const pct = (n, d = 1) => (Number(n) || 0).toFixed(d) + '%';
  const signed = (n, d = 1) => (n > 0 ? '+' : '') + (Number(n) || 0).toFixed(d);
  const compact = (n) => {
    const v = Number(n) || 0, a = Math.abs(v);
    if (a >= 1e7) return (v / 1e7).toFixed(2) + 'Cr';
    if (a >= 1e5) return (v / 1e5).toFixed(1) + 'L';
    if (a >= 1000) return (v / 1000).toFixed(1) + 'k';
    return String(Math.round(v));
  };

  /* ------------------------------------------------------------ DOM build --- */
  function el(tag, attrs, children) {
    const parts = tag.split(/([.#])/);
    const node = document.createElement(parts[0] || 'div');
    for (let i = 1; i < parts.length; i += 2) {
      if (parts[i] === '.') node.classList.add(parts[i + 1]);
      else node.id = parts[i + 1];
    }
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'html') node.innerHTML = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'class') node.className = v;
        else node.setAttribute(k, v);
      }
    }
    append(node, children);
    return node;
  }
  function append(node, children) {
    if (children === null || children === undefined || children === false) return node;
    if (Array.isArray(children)) { children.forEach((c) => append(node, c)); return node; }
    if (children instanceof Node) { node.appendChild(children); return node; }
    const s = String(children);
    // Markup written inline in copy (<strong>, <em>, <code>) is common in this
    // codebase, so detect it rather than forcing every call site to opt in.
    // Everything here is authored content — no user input ever reaches this path.
    if (/<[a-z][\s\S]*>/i.test(s)) {
      const tpl = document.createElement('template');
      tpl.innerHTML = s;
      node.appendChild(tpl.content);
      return node;
    }
    node.appendChild(document.createTextNode(s));
    return node;
  }
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); return node; };
  const mount = (node, ...children) => { clear(node); children.forEach((c) => append(node, c)); return node; };

  /* -------------------------------------------------------------- pieces --- */
  function badge(text, tone = 'mute', dot = false) {
    return el('span.badge.b-' + tone + (dot ? '.dot' : ''), { text });
  }
  function kpi(label, value, sub, delta, deltaTone) {
    return el('div.kpi', null, [
      el('div.lbl', { text: label }),
      el('div.val', { text: value }),
      delta ? el('div.delta.' + (deltaTone || 'flat'), { text: delta }) : null,
      sub ? el('div.sub', { text: sub, style: { marginTop: delta ? '3px' : '0' } }) : null
    ]);
  }
  function barRow(label, valueText, fraction, tone = '', extra) {
    return el('div.bar-row', null, [
      el('div.bl', null, [extra || null, el('span', { text: label })]),
      el('div.bv', { text: valueText }),
      el('div.bar-track', null, el('div.bar', null,
        el('i.' + (tone || ''), { style: { width: Math.max(0, Math.min(1, fraction)) * 100 + '%' } })))
    ]);
  }
  function statLine(label, value, tone) {
    return el('div.row.between', { style: { padding: '5px 0', borderBottom: '1px solid var(--line-soft)' } }, [
      el('span.small.muted', { text: label }),
      el('span.small' + (tone ? '.' + tone : ''), { style: { fontWeight: '700' }, text: value })
    ]);
  }
  function confidenceChip(score, label) {
    const band = score >= 0.8 ? 'high' : score >= 0.6 ? 'medium' : score >= 0.4 ? 'low' : 'stale';
    const tone = band === 'high' ? 'good' : band === 'medium' ? 'info' : band === 'low' ? 'warn' : 'danger';
    return el('span.conf.conf-' + band, { title: label || '' }, [
      el('span.conf-bar.' + band, null, el('i', { style: { width: (score * 100).toFixed(0) + '%' } })),
      el('span', { style: { color: 'var(--' + (tone === 'good' ? 'good' : tone === 'info' ? 'info' : tone === 'warn' ? 'warn' : 'danger') + ')' },
        text: (score * 100).toFixed(0) + '%' })
    ]);
  }
  function reasonsList(reasons, mono) {
    if (!reasons || !reasons.length) return null;
    return el('ul.reasons' + (mono ? '.mono' : ''), null, reasons.map((r) => el('li', { text: r })));
  }
  function note(text, tone = '') {
    return el('div.note' + (tone ? '.' + tone : ''), { html: text });
  }

  /* --------------------------------------------------------------- modal --- */
  let overlayEl = null;
  function ensureOverlay() {
    if (overlayEl) return overlayEl;
    overlayEl = el('div.overlay', { onclick: (e) => { if (e.target === overlayEl) closeModal(); } });
    document.body.appendChild(overlayEl);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); closeDrawer(); } });
    return overlayEl;
  }
  function openModal(content, opts = {}) {
    const ov = ensureOverlay();
    const modal = el('div.modal' + (opts.wide ? '.wide' : ''), null, content);
    mount(ov, modal);
    requestAnimationFrame(() => ov.classList.add('on'));
    return modal;
  }
  function closeModal() { if (overlayEl) overlayEl.classList.remove('on'); }
  function modalShell(title, subtitle, bodyChildren, footChildren) {
    return [
      el('div.modal-head', null, [
        el('div', null, [
          el('h3', { text: title }),
          subtitle ? el('p.small.muted', { text: subtitle, style: { margin: '5px 0 0' } }) : null
        ]),
        el('button.x', { text: '×', onclick: closeModal, 'aria-label': 'Close' })
      ]),
      el('div.modal-body', null, bodyChildren),
      footChildren ? el('div.modal-foot', null, footChildren) : null
    ];
  }

  /* -------------------------------------------------------------- drawer --- */
  let drawerEl = null;
  function openDrawer(content) {
    closeDrawer();
    drawerEl = el('div.drawer', null, content);
    document.body.appendChild(drawerEl);
    requestAnimationFrame(() => drawerEl.classList.add('on'));
  }
  function closeDrawer() { if (drawerEl) { const d = drawerEl; drawerEl = null; d.classList.remove('on'); setTimeout(() => d.remove(), 320); } }
  const isDrawerOpen = () => !!drawerEl;

  /* --------------------------------------------------------------- toast --- */
  let toastHost = null;
  function toast(msg, tone = '', ms = 3000) {
    if (!toastHost) { toastHost = el('div.toast-host'); document.body.appendChild(toastHost); }
    const icon = tone === 'good' ? '✓' : tone === 'danger' ? '✕' : tone === 'warn' ? '!' : '›';
    const t = el('div.toast' + (tone ? '.' + tone : ''), null, [el('span', { text: icon }), el('span', { text: msg })]);
    toastHost.appendChild(t);
    setTimeout(() => { t.style.transition = '.3s'; t.style.opacity = '0'; t.style.transform = 'translateY(8px)'; setTimeout(() => t.remove(), 320); }, ms);
  }

  /* --------------------------------------------------------------- chart --- */
  /* Grouped vertical bar chart. series = [{name, colour, values:[]}].
     Bars within a column sit SIDE BY SIDE — they must never stack, or two series
     would read as one taller bar. */
  function barChart(labels, series, opts = {}) {
    const max = opts.max || Math.max(1, ...series.flatMap((s) => s.values));
    const h = opts.height || 150;
    const cols = labels.map((lb, i) => el('div.col', {
      title: labels[i] + '\n' + series.map((s) => s.name + ': ' + num(s.values[i])).join('\n')
    }, el('div', {
      style: { display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
               gap: '2px', width: '100%', height: '100%' }
    }, series.map((s) => el('i', {
      style: {
        height: Math.max(2, (s.values[i] / max) * (h - 10)) + 'px',
        width: (100 / series.length) + '%', flex: '1 1 0', minWidth: '3px',
        borderRadius: '3px 3px 1px 1px', background: s.colour
      }
    })))));
    return el('div', null, [
      el('div.chart', { style: { height: h + 'px' } }, cols),
      el('div.chart-x', null, labels.map((l) => el('span', { text: l })))
    ]);
  }
  function legend(items) {
    return el('div.legend', null, items.map((it) => el('span', null, [
      el('i', { style: { background: it.colour } }), it.name
    ])));
  }
  function donut(segments, size = 128, thickness = 16) {
    const total = segments.reduce((s, x) => s + x.value, 0) || 1;
    let acc = 0;
    const stops = segments.map((s) => {
      const from = (acc / total) * 100; acc += s.value;
      return `${s.colour} ${from}% ${(acc / total) * 100}%`;
    }).join(', ');
    return el('div', {
      style: {
        width: size + 'px', height: size + 'px', borderRadius: '50%', flex: 'none',
        background: `conic-gradient(${stops})`,
        mask: `radial-gradient(circle, transparent ${(size / 2 - thickness)}px, #000 ${(size / 2 - thickness)}px)`,
        WebkitMask: `radial-gradient(circle, transparent ${(size / 2 - thickness)}px, #000 ${(size / 2 - thickness)}px)`
      }
    });
  }
  function funnelRow(label, value, maxValue, colour, note) {
    return el('div.funnel-row', null, [
      el('div.fl-l', null, [el('div', { text: label }), note ? el('div.tiny.faint', { text: note }) : null]),
      el('div.funnel-track', null, el('i', { style: { width: Math.max(2, (value / maxValue) * 100) + '%', background: colour }, text: '' })),
      el('div.fl-v', { text: num(value) })
    ]);
  }

  /* ------------------------------------------------------------- network --- */
  function initNav(active) {
    const links = [
      { href: 'index.html', label: 'Diagnosis', key: 'diagnosis' },
      { href: 'app.html', label: 'Prototype', key: 'app' },
      { href: 'stores.html', label: 'Local Stores', key: 'stores' },
      { href: 'impact.html', label: 'Business Impact', key: 'impact' },
      { href: 'docs/README.html', label: 'Submission', key: 'docs' }
    ];
    return el('nav.nav', null, el('div.nav-in', null, [
      el('a.brand', { href: 'index.html' }, [
        el('span.brand-mark', { text: 'N' }),
        el('span', null, ['NOVA CART ', el('small', { text: 'Promise Engine' })])
      ]),
      el('div.nav-links', null, links.map((l) =>
        el('a', { href: l.href, class: l.key === active ? 'on' : '' }, el('span.lbl', { text: l.label })))),
      // Filled in by AUTH.mountAccountChip() — delivery location + account menu
      el('div', { id: 'account', style: { display: 'flex', alignItems: 'center', gap: '8px' } })
    ]));
  }
  function mountNav(active) {
    const host = document.getElementById('nav');
    if (host) host.replaceWith(initNav(active));
  }
  function footer() {
    return el('footer', { style: { borderTop: '1px solid var(--line-soft)', padding: '30px 0', marginTop: '30px' } },
      el('div.wrap.row.between', { style: { gap: '18px' } }, [
        el('div.small.muted', { html: '<strong style="color:var(--text)">NOVA CART Promise Engine</strong> — PromptWars Business Rescue Challenge. NOVA CART is a fictional company; all figures derive from the challenge brief.' }),
        el('div.small.faint', { text: 'PROMPT · DISCOVER · BUILD · PROVE' })
      ]));
  }
  function mountFooter() {
    const host = document.getElementById('footer');
    if (host) host.replaceWith(footer());
  }

  /* ------------------------------------------------------------ delegates --- */
  function delegateTabs(root, onPick) {
    $$('[data-tab]', root).forEach((btn) => btn.addEventListener('click', () => {
      $$('[data-tab]', root).forEach((b) => b.classList.toggle('on', b === btn));
      onPick(btn.dataset.tab);
    }));
  }

  global.UI = {
    inr, inrFull, num, pct, signed, compact,
    el, $, $$, clear, mount, append,
    badge, kpi, barRow, statLine, confidenceChip, reasonsList, note,
    openModal, closeModal, modalShell, openDrawer, closeDrawer, isDrawerOpen,
    toast, barChart, legend, donut, funnelRow,
    initNav, mountNav, mountFooter, delegateTabs
  };
})(window);
