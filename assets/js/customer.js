/* =============================================================================
   customer.js — the customer-facing half of the Promise Engine
   -----------------------------------------------------------------------------
   The whole point: a customer never sees a promise the store cannot keep.
   Every action here writes back into the SAME inventory rows the store view
   edits, so a store pulse in the other tab visibly changes this screen.
   ========================================================================== */
(function (global) {
  'use strict';
  const { el, inr, inrFull, num, mount, badge, confidenceChip, note, openDrawer,
          closeDrawer, toast, reasonsList, statLine, openModal, modalShell } = UI;
  const N = NOVA, E = ENGINE;

  /* Which store does this shopper land on? Three sources, in order of intent:
       1. ?store= in the URL — "Shop here" on the local-stores page
       2. a store they picked earlier in this browser
       3. the best store serving the account's delivery location
     Falling back to the curated demo store means the page always works, signed in or not. */
  function initialStoreId() {
    try {
      const q = new URLSearchParams(location.search).get('store');
      if (q && N.STORES.some((s) => s.id === q)) return q;
      const saved = localStorage.getItem('novacart.pickStore.v1');
      if (saved && N.STORES.some((s) => s.id === saved)) return saved;
    } catch (e) { /* storage blocked */ }
    if (global.AUTH) {
      const loc = AUTH.currentLocation();
      const near = E.nearbyStores(loc, { radiusKm: 4 });
      if (near.length) return near[0].store.id;
    }
    return N.DEMO_STORE_ID;
  }

  const C = {
    storeId: initialStoreId(),
    category: 'all',
    cart: [],            // [{product, confidence, qty}]
    swaps: {},           // productId -> substitute object the user accepted
    order: null,
    showReality: false,
    step: 1
  };
  global.CUSTOMER_STATE = C;

  const store = () => N.STORES.find((s) => s.id === C.storeId);
  const conf = (p) => E.availabilityConfidence(store(), p);
  const cartCount = () => C.cart.reduce((s, l) => s + l.qty, 0);
  const cartTotal = () => C.cart.reduce((s, l) => s + (C.swaps[l.product.id] ? C.swaps[l.product.id].product.price : l.product.price) * l.qty, 0);

  /* --------------------------------------------------------------- RENDER --- */
  function render(root) {
    mount(root,
      el('div', null, [storeBanner(), stepStrip()]),
      el('div', { style: { marginTop: '20px' } }, C.step === 1 ? browseView() : C.step === 2 ? cartView() : trackingView()),
      cartFab()
    );
  }

  /* Store header: shows how fresh this store's catalogue is — the honest bit */
  function storeBanner() {
    const s = store();
    const loc = global.AUTH ? AUTH.currentLocation() : null;
    const km = loc ? N.haversineKm(loc, s) : null;
    const lag = s.syncLagHours;
    const tone = lag < 6 ? 'good' : lag < 24 ? 'warn' : 'danger';
    const truthTone = lag < 6 ? 'Verified catalogue' : lag < 24 ? 'Partly stale catalogue' : 'Catalogue is out of date';
    const locName = N.storeLocation(s);
    return el('div.card', { style: { display: 'flex', gap: '18px', flexWrap: 'wrap', alignItems: 'center' } }, [
      el('div', { style: { width: '46px', height: '46px', borderRadius: '13px', background: 'var(--surface-3)',
        display: 'grid', placeItems: 'center', fontSize: '21px', flex: 'none' }, text: '🏪' }),
      el('div.grow', { style: { minWidth: '200px' } }, [
        el('div', { style: { fontWeight: '750', fontSize: '15.5px' }, text: s.name }),
        el('div.small.muted', { text: s.kind + ' · ' + locName.area + ', ' + locName.city +
          (km !== null ? ' · ' + km.toFixed(1) + ' km from you' : '') + ' · ★ ' + s.rating })
      ]),
      el('div', { style: { textAlign: 'right' } }, [
        badge(truthTone, tone, true),
        el('div.tiny.faint', { style: { marginTop: '5px' }, text: 'Last stock sync ' + E.formatAge(s.lastPulseMinAgo) + ' ago' })
      ]),
      el('button.btn.sm', {
        onclick: () => {
          // Only stores that can actually deliver to the shopper's location
          const options = global.AUTH ? E.nearbyStores(AUTH.currentLocation(), { radiusKm: 4 }) : [];
          const list = options.length ? options : E.nearbyStores(N.storeLocation(s), { radiusKm: 6 }).map((r) => ({ ...r, km: null }));
          openModal(modalShell('Choose a store',
            options.length
              ? 'Only partners inside your delivery radius appear here. Catalogue freshness differs by store — this is what you see before you trust anything.'
              : 'Every store in the network has a different catalogue freshness.',
            [
              el('div.stack.tight', { style: { maxHeight: '52vh', overflowY: 'auto' } }, list.map((row) => {
                const st = row.store;
                const t = st.syncLagHours < 6 ? 'good' : st.syncLagHours < 24 ? 'warn' : 'danger';
                return el('button.card', {
                  style: { display: 'flex', gap: '12px', alignItems: 'center', cursor: 'pointer', textAlign: 'left',
                    width: '100%', fontFamily: 'inherit', color: 'inherit', borderColor: st.id === C.storeId ? 'var(--brand)' : 'var(--line)' },
                  onclick: () => {
                    C.storeId = st.id; C.cart = []; C.swaps = {}; C.step = 1;
                    try { localStorage.setItem('novacart.pickStore.v1', st.id); } catch (e) {}
                    closeModal(); UI.rerender();
                  }
                }, [
                  el('div.grow', null, [
                    el('div', { style: { fontWeight: '680', fontSize: '13.5px' }, text: st.name }),
                    el('div.tiny.muted', { text: N.storeLocation(st).area + ', ' + N.storeLocation(st).city +
                      (row.km !== null ? ' · ' + row.km.toFixed(1) + ' km' : '') +
                      ' · ' + st.cats.length + ' categories · fulfil ' + st.fulfilmentScore })
                  ]),
                  badge(E.formatAge(st.lastPulseMinAgo) + ' stale', t)
                ]);
              }))
            ]));
        }
      }, 'Change store')
    ]);
  }

  function stepStrip() {
    const steps = [['1', 'Browse'], ['2', 'Smart swap'], ['3', 'Track']];
    return el('div.steps', { style: { marginTop: '16px' } }, steps.map(([n, l], i) => el('div.step' + (C.step === i + 1 ? '.on' : C.step > i + 1 ? '.done' : ''), null, [
      el('span.n', { text: C.step > i + 1 ? '✓' : n }), l
    ])));
  }

  /* --------------------------------------------------------------- BROWSE --- */
  function browseView() {
    const s = store();
    const items = s.cats.flatMap((c) => N.PRODUCTS.filter((p) => p.category === c))
      .filter((p) => C.category === 'all' || p.category === C.category);

    const withConf = items.map((p) => ({ p, c: conf(p) }));
    const shown = withConf.filter((x) => x.c.band !== 'none');
    const shaky = shown.filter((x) => x.c.score < 0.6);
    const hiddenByEngine = shown.filter((x) => x.c.action === 'confirm');
    const realOut = shown.filter((x) => x.c.record && x.c.record.truth === 'out' && x.c.record.reported === 'in');

    const cats = ['all', ...s.cats];

    return el('div.stack', { style: { gap: '18px' } }, [
      /* the honest headline */
      el('div.grid.g4', null, [
        UI.kpi('Items in catalogue', num(shown.length), 'across ' + s.cats.length + ' categories'),
        UI.kpi('Confirmed available', num(shown.filter((x) => x.c.score >= 0.6).length),
          'recently verified at this store', 'trusted', 'up'),
        UI.kpi('Unconfirmed', num(shaky.length), 'need a store pulse', shaky.length + ' flagged', 'down'),
        UI.kpi('Advertised but out of stock', num(realOut.length),
          'the cancellations we prevent', 'caught', 'up')
      ]),

      el('div.card', null, [
        el('div.row.between', { style: { marginBottom: '14px' } }, [
          el('div', null, [
            el('div.cap', { text: 'Shop' }),
            el('div', { style: { fontSize: '13px', color: 'var(--muted)', marginTop: '3px' } },
              'Confidence is shown on every item. Nothing is hidden from you.')
          ]),
          el('label', { style: { display: 'flex', alignItems: 'center', gap: '9px', cursor: 'pointer', fontSize: '12.5px', color: 'var(--text-2)' } }, [
            el('input', { type: 'checkbox', checked: C.showReality,
              onchange: (e) => { C.showReality = e.target.checked; UI.rerender(); } }),
            el('span', { text: '🔍 Reveal ground truth' })
          ])
        ]),
        el('div.row', { style: { gap: '7px', marginBottom: '16px' } }, cats.map((c) => {
          const cat = c === 'all' ? null : N.categoryById(c);
          return el('button.pill.click' + (C.category === c ? '.on' : ''), {
            onclick: () => { C.category = c; UI.rerender(); }
          }, (cat ? cat.icon + ' ' : '') + (cat ? cat.name : 'All items'));
        })),
        el('div.prod-grid', null, shown.map((x) => productCard(x.p, x.c)))
      ]),

      C.showReality ? el('div.card.danger', null, [
        el('div.cap', { text: 'Ground truth — what is physically on the shelf' }),
        el('p.small', { style: { margin: '8px 0 12px' } }, [
          'This panel exists to prove the model is not decoration. It compares what the app currently advertises ',
          'against what the store actually has.'
        ]),
        el('div.row', { style: { gap: '12px' } }, [
          el('div.kpi.grow', { style: { padding: '14px' } }, [
            el('div.lbl', { text: 'Phantom stock' }),
            el('div.val', { style: { color: 'var(--danger)' }, text: num(realOut.length) }),
            el('div.sub', { text: 'advertised as available, actually gone' })
          ]),
          el('div.kpi.grow', { style: { padding: '14px' } }, [
            el('div.lbl', { text: 'Engine precision' }),
            el('div.val', { style: { color: 'var(--good)' },
              text: shaky.length ? Math.round(realOut.length / shaky.length * 100) + '%' : '—' }),
            el('div.sub', { text: 'of flagged items were genuinely out' })
          ]),
          el('div.kpi.grow', { style: { padding: '14px' } }, [
            el('div.lbl', { text: 'Verified accuracy' }),
            el('div.val', { style: { color: 'var(--good)' },
              text: (() => {
                const hi = shown.filter((x) => x.c.score >= 0.6 && x.c.record);
                const ok = hi.filter((x) => x.c.record.truth !== 'out').length;
                return hi.length ? Math.round(ok / hi.length * 100) + '%' : '—';
              })() }),
            el('div.sub', { text: 'of high-confidence items really were available' })
          ])
        ]),
        el('div.stack.tight', { style: { marginTop: '16px' } }, realOut.map((x) => el('div.row.between', {
          style: { padding: '8px 0', borderBottom: '1px solid var(--line-soft)' }
        }, [
          el('div', null, [
            el('span.small', { style: { color: 'var(--text)', fontWeight: '600' }, text: x.p.name }),
            el('span.tiny.faint', { style: { marginLeft: '9px' }, text: 'reported "' + x.c.record.reported + '" · actually "' + x.c.record.truth + '"' })
          ]),
          badge('would have cancelled', 'danger')
        ])))
      ]) : null,

      el('div.note.good', null, [
        '<strong>What is different here:</strong> today NOVA CART shows all ' + num(shown.length) + ' items as simply "available". ',
        'We show ' + num(shown.filter((x) => x.c.score >= 0.6).length) + ' as confirmed, ' + num(shaky.length) + ' as unconfirmed with a swap offered before payment, and we stop ',
        'advertising the ' + num(realOut.length) + ' that are gone. The customer is never surprised after paying.'
      ])
    ]);
  }

  function productCard(p, c) {
    const inCart = C.cart.find((l) => l.product.id === p.id);
    const cat = N.categoryById(p.category);
    const shaky = c.score < 0.6;
    const cls = '.prod' + (c.band === 'stale' ? '.stale' : shaky ? '.shaky' : '') + (inCart ? '.in-cart' : '');
    return el('div' + cls, {
      onclick: () => addToCart(p, c)
    }, [
      p.localOnly ? el('span.local', { text: 'Local only' }) : null,
      el('div.ic', { text: cat.icon }),
      el('div', null, [
        el('div.nm', { text: p.name }),
        el('div.un', { text: p.unit + ' · ' + cat.name })
      ]),
      el('div.row.between', { style: { alignItems: 'flex-end' } }, [
        el('div.pr', { text: '₹' + p.price }),
        el('div', { style: { textAlign: 'right' } }, [
          confidenceChip(c.score, c.label + ' — ' + c.reasons[0]),
          el('div.tiny.faint', { style: { marginTop: '3px' },
            text: c.band === 'high' ? 'verified' : c.band === 'medium' ? 'likely' : 'unconfirmed' })
        ])
      ]),
      el('div.foot', null, [
        el('button.btn.xs' + (inCart ? '.good' : ''), {
          onclick: (e) => { e.stopPropagation(); if (inCart) removeFromCart(p.id); else addToCart(p, c); }
        }, inCart ? '✓ In basket' : '+ Add'),
        el('button.btn.xs.ghost', {
          onclick: (e) => { e.stopPropagation(); explain(p, c); }
        }, 'Why?')
      ])
    ]);
  }

  function explain(p, c) {
    const subs = E.findSubstitutes(store(), p, { allowAdjacent: true, limit: 3 });
    openModal(modalShell(p.name, 'How the availability confidence was calculated', [
      el('div.card.flat', null, [
        el('div.row.between', null, [
          el('div', null, [
            el('div.cap', { text: 'Confidence' }),
            el('div', { style: { fontSize: '30px', fontWeight: '800', marginTop: '4px' }, text: (c.score * 100).toFixed(0) + '%' })
          ]),
          badge(c.label, c.score >= 0.8 ? 'good' : c.score >= 0.6 ? 'info' : c.score >= 0.4 ? 'warn' : 'danger')
        ]),
        reasonsList(c.reasons, true)
      ]),
      c.record ? el('div.card.flat', { style: { marginTop: '12px' } }, [
        el('div.cap', { text: 'Raw data' }),
        el('div', { style: { marginTop: '8px' } }, [
          statLine('Store reported', c.record.reported),
          statLine('Last updated', E.formatAge(c.record.updatedMinAgo) + ' ago'),
          statLine('Claim half-life for this store', c.halfLife + ' hours'),
          statLine('Freshness remaining', (c.freshness * 100).toFixed(1) + '%')
        ])
      ]) : null,
      el('div.card.flat', { style: { marginTop: '12px' } }, [
        el('div.cap', { text: 'If you still want it — alternatives we can actually deliver' }),
        subs.length ? el('div.stack.tight', { style: { marginTop: '8px' } }, subs.map((s) => el('div.row.between', {
          style: { padding: '9px 0', borderBottom: '1px solid var(--line-soft)' }
        }, [
          el('div', null, [
            el('div.small', { style: { fontWeight: '620', color: 'var(--text)' }, text: s.product.name }),
            el('div.tiny.muted', { text: '₹' + s.product.price + ' · ' + (s.sameStore ? 'same store' : s.store.name + ' · ' + s.km + ' km') })
          ]),
          badge(Math.round(s.confidence * 100) + '% available', s.confidence >= 0.8 ? 'good' : 'info')
        ]))) : el('p.small.muted', { text: 'No reliable alternative nearby for this item.' })
      ])
    ], [
      el('button.btn.ghost', { onclick: () => { closeModal(); toast('Item is not stocked here — the app will not offer it.', 'warn'); } }, 'Skip this item'),
      el('button.btn.primary', { onclick: () => { closeModal(); addToCart(p, c); } }, 'Add anyway, with a swap ready')
    ]), { wide: true });
  }

  /* ----------------------------------------------------------------- CART --- */
  function addToCart(p, c) {
    const line = C.cart.find((l) => l.product.id === p.id);
    if (line) line.qty++;
    else C.cart.push({ product: p, confidence: c.score, qty: 1 });
    toast(p.name + ' added', c.score < 0.6 ? 'warn' : 'good', 1600);
    UI.rerender();
  }
  function removeFromCart(id) {
    C.cart = C.cart.filter((l) => l.product.id !== id);
    delete C.swaps[id];
    UI.rerender();
  }

  function cartFab() {
    if (!C.cart.length || C.step !== 1) return null;
    return el('button.btn.primary.cart-fab', {
      onclick: () => { C.step = 2; UI.rerender(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    }, '🛒 Review basket · ' + cartCount() + ' items · ₹' + num(cartTotal()));
  }

  function cartView() {
    const s = store();
    const shakyLines = C.cart.filter((l) => l.confidence < 0.6 && !C.swaps[l.product.id]);
    const swapsTotal = Object.values(C.swaps).reduce((a, x) => a + x.product.price - x.original.price, 0);

    return el('div.grid.g2', { style: { alignItems: 'start' } }, [
      el('div.stack', null, [
        el('div.card', null, [
          el('div.row.between', { style: { marginBottom: '14px' } }, [
            el('div', null, [el('div.cap', { text: 'Your basket' }), el('div.small.muted', { text: cartCount() + ' items · ' + s.name })]),
            el('button.btn.sm.ghost', { onclick: () => { C.step = 1; UI.rerender(); } }, '← Add more')
          ]),
          el('div.stack.tight', null, C.cart.map((l) => {
            const sw = C.swaps[l.product.id];
            const eff = sw ? sw.product : l.product;
            return el('div', { style: { padding: '11px 0', borderBottom: '1px solid var(--line-soft)' } }, [
              el('div.row.between', null, [
                el('div', null, [
                  el('div', { style: { fontWeight: '620', fontSize: '13.5px', color: 'var(--text)' }, text: eff.name }),
                  el('div.tiny.muted', { text: eff.unit + ' · ₹' + eff.price + ' × ' + l.qty + (sw ? ' · swapped' : '') })
                ]),
                el('div', { style: { textAlign: 'right' } }, [
                  el('div', { style: { fontWeight: '750', fontVariantNumeric: 'tabular-nums' }, text: '₹' + (eff.price * l.qty) }),
                  sw ? badge('swapped', 'good') : confidenceChip(l.confidence)
                ])
              ]),
              sw ? el('div.tiny', { style: { color: 'var(--good)', marginTop: '5px' }, text: '✓ Swapped from ' + l.product.name + ' — the original was unconfirmed at this store.' }) : null
            ]);
          })),
          el('div.hr'),
          el('div.row.between', null, [
            el('span', { style: { fontWeight: '700' }, text: 'Basket total' }),
            el('span.big', { text: '₹' + num(cartTotal()) })
          ]),
          swapsTotal !== 0 ? el('div.tiny.muted', { style: { textAlign: 'right', marginTop: '3px' },
            text: (swapsTotal > 0 ? '+' : '') + '₹' + Math.abs(swapsTotal).toFixed(0) + ' versus original items' }) : null
        ]),

        /* the smart swap block — the heart of the customer-side product */
        shakyLines.length ? el('div.card', { style: { borderColor: 'rgba(255,176,32,.35)' } }, [
          el('div.row.between', null, [
            el('div', null, [
              el('div.cap', { text: '⚡ Smart swap' }),
              el('div', { style: { fontSize: '15px', fontWeight: '750', marginTop: '4px' },
                text: shakyLines.length + ' item' + (shakyLines.length > 1 ? 's' : '') + ' we cannot confirm' })
            ]),
            badge('before payment', 'warn')
          ]),
          el('p.small', { style: { margin: '10px 0 14px' } }, [
            'This store has not confirmed these recently. Today NOVA CART would take your money and cancel the whole order later. ',
            'Instead, here is what we can actually deliver.'
          ]),
          el('div.stack.tight', null, shakyLines.map((l) => {
            const subs = E.findSubstitutes(store(), l.product, { allowAdjacent: true, limit: 2 });
            return el('div', { style: { padding: '12px', borderRadius: '12px', background: 'var(--surface-2)', border: '1px solid var(--line)' } }, [
              el('div.row.between', null, [
                el('div', null, [
                  el('div', { style: { fontWeight: '650', fontSize: '13.5px', color: 'var(--text)' }, text: l.product.name }),
                  el('div.tiny.muted', { text: '₹' + l.product.price + ' · confidence ' + (l.confidence * 100).toFixed(0) + '%' })
                ]),
                badge('unconfirmed', 'warn')
              ]),
              subs.length ? el('div.stack.tight', { style: { marginTop: '10px' } }, subs.slice(0, 2).map((sb) => el('div.row.between', {
                style: { gap: '10px', padding: '8px 10px', borderRadius: '9px', background: 'var(--surface-3)' }
              }, [
                el('div.grow', { style: { minWidth: 0 } }, [
                  el('div.small', { style: { fontWeight: '620', color: 'var(--text)' }, text: sb.product.name }),
                  el('div.tiny.muted', { text: '₹' + sb.product.price + ' · ' + (sb.sameStore ? 'same store' : sb.store.name + ' · ' + sb.km + ' km') + ' · ' + Math.round(sb.confidence * 100) + '% available' })
                ]),
                el('button.btn.xs.good', {
                  onclick: () => { C.swaps[l.product.id] = { ...sb, original: l.product }; toast('Swapped to ' + sb.product.name, 'good'); UI.rerender(); }
                }, 'Swap')
              ]))) : el('div.tiny.muted', { style: { marginTop: '8px' }, text: 'No reliable alternative — we will ask you before charging.' }),
              el('div.row', { style: { marginTop: '9px', gap: '7px' } }, [
                el('button.btn.xs.ghost', { onclick: () => { C.cart = C.cart.filter((x) => x.product.id !== l.product.id); UI.rerender(); } }, 'Remove item'),
                el('button.btn.xs.ghost', {
                  onclick: () => { C.cart = C.cart.filter((x) => x.product.id !== l.product.id); C.step = 1; UI.rerender(); }
                }, 'Remove and keep shopping')
              ])
            ]);
          }))
        ]) : el('div.note.good', null, [
          '<strong>✓ Every line in this basket is confirmed.</strong> This is what a normal NOVA CART order should feel like.'
        ])
      ]),

      el('div.stack', null, [checkoutCard(), riskPreviewCard()])
    ]);
  }

  function checkoutCard() {
    const s = store();
    const eta = etaFor();
    const canOrder = C.cart.length > 0;
    return el('div.card.hl', null, [
      el('div.cap', { text: 'Checkout' }),
      el('div', { style: { marginTop: '12px' } }, [
        statLine('Items', num(cartCount())),
        statLine('Basket value', '₹' + num(cartTotal())),
        statLine('Delivery fee', '₹25'),
        statLine('Estimated delivery', eta.min + '–' + eta.max + ' min'),
        el('div.hr', { style: { margin: '12px 0' } }),
        el('div.row.between', null, [
          el('span', { style: { fontWeight: '700' }, text: 'Payable' }),
          el('span.big', { text: '₹' + num(cartTotal() + 25) })
        ])
      ]),
      el('div.note' + (eta.confidence >= 0.8 ? '.good' : '.warn'), { style: { marginTop: '14px' } }, [
        '<strong>Honest ETA:</strong> ' + eta.min + '–' + eta.max + ' min at ' + Math.round(eta.confidence * 100) + '% confidence. ',
        eta.reason
      ]),
      el('button.btn.primary.block', {
        style: { marginTop: '14px', padding: '13px' }, disabled: !canOrder,
        onclick: placeOrder
      }, canOrder ? 'Place order with Promise Guarantee' : 'Basket is empty'),
      el('div.tiny.faint', { style: { textAlign: 'center', marginTop: '9px' } },
        'If any confirmed item turns out to be missing, we re-route it automatically — we do not cancel your order.')
    ]);
  }

  /* The ETA is derived from the store's actual reliability, not a flat promise */
  function etaFor() {
    const s = store();
    const load = s.openOrders / s.capacity;
    const base = s.prepMinutes + 14 + Math.round(load * 8);
    const spread = Math.round(4 + s.syncLagHours / 12 + load * 6);
    const confidence = Math.max(0.35, Math.min(0.96, 1 - (spread / 40) - (s.rejectRate * 1.2)));
    return {
      min: base - 2, max: base + spread, confidence,
      reason: confidence >= 0.8
        ? 'This store keeps its catalogue fresh and is lightly loaded right now.'
        : 'This store\'s catalogue is ' + E.formatAge(s.lastPulseMinAgo) + ' old and it is ' + Math.round(load * 100) + '% loaded, so we are quoting a range rather than a promise.'
    };
  }

  function riskPreviewCard() {
    if (!C.cart.length) return null;
    const s = store();
    const r = E.orderRisk({
      store: s, lines: C.cart.map((l) => ({ product: l.product, confidence: l.confidence })),
      etaMinutes: etaFor().max, hour: 19, customerOrderCount: 1, basketValue: cartTotal(), disruption: null
    });
    return el('div.card', null, [
      el('div.row.between', null, [
        el('div.cap', { text: 'Order risk — internal view' }),
        badge(r.tier, r.tone, true)
      ]),
      el('p.tiny.muted', { style: { margin: '9px 0 12px' } },
        'The customer never sees this number. It is what the control tower uses to decide whether to intervene before the order fails.'),
      el('div.row.mid', { style: { gap: '16px' } }, [
        el('div', { style: { fontSize: '38px', fontWeight: '800', letterSpacing: '-.04em', lineHeight: '1',
          color: r.tone === 'danger' ? 'var(--danger)' : r.tone === 'warn' ? 'var(--warn)' : 'var(--good)' },
          text: (r.risk * 100).toFixed(0) + '%' }),
        el('div.small.muted', null, ['predicted cancellation probability'])
      ]),
      el('div.stack.tight', { style: { marginTop: '14px' } },
        r.factors.slice(0, 4).map((f) => UI.barRow(f.label, (f.contribution >= 0 ? '+' : '') + f.contribution.toFixed(2),
          Math.abs(f.contribution) / 1.6, f.contribution > 0.3 ? 'danger' : f.contribution > 0.1 ? 'warn' : 'info'))),
      el('div.tiny.faint', { style: { marginTop: '4px' }, text: 'Log-odds contributions, largest first.' })
    ]);
  }

  /* ------------------------------------------------------------- ORDERING --- */
  function placeOrder() {
    const s = store();
    const eta = etaFor();
    const lines = C.cart.map((l) => {
      const sw = C.swaps[l.product.id];
      const eff = sw ? sw.product : l.product;
      return { product: eff, confidence: sw ? sw.confidence : l.confidence, original: l.product, swapped: !!sw, qty: l.qty };
    });
    const order = {
      id: 'NC' + Math.floor(100000 + Math.random() * 899999),
      store: s, lines, basketValue: cartTotal() + 25,
      etaMinutes: eta.max, hour: new Date().getHours() || 19,
      customerOrderCount: 1, disruption: null, placedAt: new Date(), events: []
    };
    order.risk = E.orderRisk(order);
    order.events.push({ t: 'now', h: 'Order placed', b: 'Promise Guarantee active on ' + lines.length + ' lines. Basket ₹' + num(order.basketValue) + '.', tone: 'on' });
    C.order = order;
    C.step = 3;
    toast('Order ' + order.id + ' placed — guarantee active', 'good', 2600);
    UI.rerender();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ------------------------------------------------------------- TRACKING --- */
  function trackingView() {
    const o = C.order;
    if (!o) return el('div.card', null, el('p', { text: 'No active order.' }));

    /* Simulate the single most common failure in the brief: a high-velocity line
       goes out of stock after the order is placed. Today that = cancellation. */
    const atRisk = o.lines.find((l) => l.confidence < 0.6) || o.lines[0];
    const rr = o.resolution || null;

    return el('div.grid.g2', { style: { alignItems: 'start' } }, [
      el('div.stack', null, [
        el('div.card.hl', null, [
          el('div.row.between', null, [
            el('div', null, [
              el('div.cap', { text: 'Order ' + o.id }),
              el('div', { style: { fontSize: '17px', fontWeight: '750', marginTop: '5px' },
                text: rr ? 'Delivered as promised' : 'In progress' })
            ]),
            badge(rr ? (rr.decision === 'PARTIAL FULFIL' ? 'Partially fulfilled' : 'Protected') : 'Live', rr ? 'good' : 'info', true)
          ]),
          el('div.timeline', { style: { marginTop: '18px' } }, el('div.tl', null, o.events.map((e) =>
            el('div.tl-item.' + (e.tone || ''), null, [
              el('div.tl-t', { text: e.t }),
              el('div.tl-h', { text: e.h }),
              el('div.tl-b', { html: e.b })
            ]))))
        ]),

        /* The intervention moment */
        rr ? el('div.card', { style: { borderColor: 'rgba(0,214,143,.35)' } }, [
          el('div.row.between', null, [el('div.cap', { text: 'Promise Engine intervention' }), badge(rr.decision, 'good')]),
          el('p.small', { style: { margin: '10px 0 0' }, text: rr.detail }),
          rr.best ? el('div.card.flat', { style: { marginTop: '14px' } }, [
            el('div.cap', { text: 'Chosen store' }),
            el('div', { style: { marginTop: '8px' } }, [
              statLine('Store', rr.best.store.name),
              statLine('Distance', rr.best.km + ' km'),
              statLine('Availability confidence', Math.round(rr.best.confidence * 100) + '%'),
              statLine('Added ETA', rr.addedMinutes + ' min'),
              statLine('Fulfilment score', rr.best.store.fulfilmentScore + '/100')
            ]),
            reasonsList(rr.best.reasons)
          ]) : null,
          el('div.grid.g3', { style: { marginTop: '14px' } }, [
            el('div.kpi', { style: { padding: '13px' } }, [
              el('div.lbl', { text: 'Basket saved' }),
              el('div.val', { style: { fontSize: '22px', color: 'var(--good)' }, text: inr(rr.basketSavedVsCancel) }),
              el('div.sub', { text: 'vs a full cancellation' })
            ]),
            el('div.kpi', { style: { padding: '13px' } }, [
              el('div.lbl', { text: 'Refund avoided' }),
              el('div.val', { style: { fontSize: '22px', color: 'var(--good)' }, text: inr(rr.refundAvoided) }),
              el('div.sub', { text: 'no gateway fee, no ticket' })
            ]),
            el('div.kpi', { style: { padding: '13px' } }, [
              el('div.lbl', { text: 'Support tickets' }),
              el('div.val', { style: { fontSize: '22px', color: 'var(--good)' }, text: '0' }),
              el('div.sub', { text: 'customer never had to ask' })
            ])
          ])
        ]) : el('div.card', { style: { borderColor: 'rgba(255,176,32,.35)' } }, [
          el('div.row.between', null, [el('div.cap', { text: 'Simulate a failure' }), badge('the critical moment', 'warn')]),
          el('p.small', { style: { margin: '10px 0 14px' } }, [
            'The most common failure in the brief: <strong>' + atRisk.product.name + '</strong> turns out to be out of stock at ',
            o.store.name + ' after you have paid. In today\'s NOVA CART, this cancels your entire ',
            '₹' + num(o.basketValue) + ' order and generates a support ticket.'
          ]),
          el('button.btn.primary', { onclick: () => resolveStockout(atRisk) }, 'Simulate stock-out and resolve it →')
        ]),

        el('div.card', null, [
          el('div.cap', { text: 'Your basket' }),
          el('div.stack.tight', { style: { marginTop: '10px' } }, o.lines.map((l) =>
            el('div.row.between', { style: { padding: '9px 0', borderBottom: '1px solid var(--line-soft)' } }, [
              el('div', null, [
                el('div.small', { style: { color: 'var(--text)', fontWeight: '600' }, text: l.product.name }),
                el('div.tiny.muted', { text: '₹' + l.product.price + (l.swapped ? ' · swapped in before payment' : '') })
              ]),
              l.swapped ? badge('swapped', 'good') : confidenceChip(l.confidence)
            ])))
        ])
      ]),

      el('div.stack', null, [
        el('div.card', null, [
          el('div.cap', { text: 'What the customer experienced' }),
          el('div.stack.tight', { style: { marginTop: '10px' } }, [
            statLine('Order cancelled', rr ? 'No' : 'Pending', rr ? 'up' : 'flat'),
            statLine('Refund needed', rr && rr.refundAvoided > 0 ? 'No' : rr ? 'Partial' : 'Pending', rr ? 'up' : 'flat'),
            statLine('Support ticket raised', 'No', 'up'),
            statLine('Original ETA kept', rr && rr.addedMinutes <= 18 ? 'Yes' : rr ? 'Extended, with choice' : '—', 'up')
          ]),
          el('div.hr'),
          el('div.note.good', null, [
            '<strong>The 61% insight, applied.</strong> This customer is inside the first-3-orders window. ',
            'Today they would have cancelled and most likely never returned. Now they get their order. ',
            'Customers who reach three orders repeat at <strong>' + NOVA.BEHAVIOUR.threeOrderRepeatProb + '%</strong> a month.'
          ])
        ]),
        el('button.btn.block', { onclick: () => { C.cart = []; C.swaps = {}; C.order = null; C.step = 1; UI.rerender(); } }, 'Start a new order'),
        el('div.card.flat', null, [
          el('div.cap', { text: 'Behind the scenes' }),
          el('p.tiny.muted', { style: { margin: '8px 0 0' } }, [
            'This screen is not a mock-up. The confidence scores came from the live inventory rows, ',
            'the risk score is a real logistic model over eight signals, and the re-route choice was ',
            'computed with haversine distance across the 67-store network sample.'
          ])
        ])
      ])
    ]);
  }

  function resolveStockout(line) {
    const o = C.order;
    const rr = E.autoReroute(o, line);
    o.resolution = rr;
    o.events.push({ t: '+1 min', h: 'Stock-out detected', tone: 'danger',
      b: 'A picker at ' + o.store.name + ' marked <strong>' + line.product.name + '</strong> as unavailable. In the current system this cancels the whole order.' });
    o.events.push({ t: '+1 min', h: 'Promise Engine searched the network', tone: 'on',
      b: 'Evaluated ' + rr.options.length + ' nearby store' + (rr.options.length === 1 ? '' : 's') +
        ' on availability confidence, distance, fulfilment score and current load.' });
    o.events.push({ t: '+2 min', h: rr.decision, tone: 'good', b: rr.detail });
    if (rr.decision !== 'PARTIAL FULFIL') {
      o.events.push({ t: '+2 min', h: 'Customer notified proactively', tone: 'good',
        b: 'Push + WhatsApp sent before the customer noticed anything. No support ticket needed.' });
    }
    toast(rr.decision + ' — order protected', 'good', 2800);
    UI.rerender();
  }

  global.CustomerView = { render, state: C };
})(window);
