/* =============================================================================
   store.js — the partner-store half of the Promise Engine
   -----------------------------------------------------------------------------
   The diagnosis says 39% of stores find catalogue upkeep harder than it is
   worth. So this screen is designed around ONE constraint: the owner must be
   able to fix the whole day in about thirty seconds, on a phone, standing up.

   Everything here writes to the same NOVA.INVENTORY rows the customer app reads,
   so a pulse here visibly repairs the customer experience in the other tab.
   ========================================================================== */
(function (global) {
  'use strict';
  const { el, inr, num, mount, badge, confidenceChip, note, toast, statLine,
          barRow, barChart, legend, openModal, modalShell, closeModal, reasonsList } = UI;
  const N = NOVA, E = ENGINE;

  const S = {
    storeId: N.DEMO_STORE_ID,
    pulseDone: {},
    parsed: null,
    freeText: 'no milk, 3 paneer left, tomatoes finished, aashirvaad atta low, maggi khatam',
    tab: 'pulse',
    log: []
  };
  global.STORE_STATE = S;

  const store = () => N.STORES.find((s) => s.id === S.storeId);
  const rowOf = (p) => N.INVENTORY[`${S.storeId}:${p.id}`];
  const confOf = (p) => E.availabilityConfidence(store(), p);
  const carried = () => store().cats.flatMap((c) => N.PRODUCTS.filter((p) => p.category === c))
    .filter((p) => rowOf(p));

  /* ------------------------------------------------------------- PRIORITY --- */
  /* Which items deserve the owner's attention? Rank by how much revenue is
     exposed: how fast it sells x how little we can vouch for it. */
  function priorityList() {
    return carried().map((p) => {
      const c = confOf(p);
      const exposure = (p.velocity / 300) * (1 - c.score);
      return { p, c, exposure, value: Math.round((p.velocity / 300) * p.price * (1 - c.score) * 4) };
    }).sort((a, b) => b.exposure - a.exposure);
  }

  /* --------------------------------------------------------------- RENDER --- */
  function render(root) {
    mount(root,
      storeHeader(),
      el('div.tabs', { style: { marginTop: '18px' } }, [
        tabBtn('pulse', '⚡ 30-Second Pulse'),
        tabBtn('radar', '📈 Demand Radar'),
        tabBtn('typing', '💬 Zero-Typing Update'),
        tabBtn('score', '🏅 Store Score')
      ]),
      S.tab === 'pulse' ? pulseView() : S.tab === 'radar' ? radarView()
        : S.tab === 'typing' ? typingView() : scoreView()
    );
  }
  function tabBtn(k, label) {
    return el('button', { class: S.tab === k ? 'on' : '', onclick: () => { S.tab = k; UI.rerender(); } }, label);
  }

  function storeHeader() {
    const s = store();
    const all = carried();
    const fresh = all.filter((p) => confOf(p).score >= 0.8).length;
    const flagged = all.length - fresh;
    const lag = s.syncLagHours;
    const tone = lag < 6 ? 'good' : lag < 24 ? 'warn' : 'danger';
    return el('div.card', { style: { display: 'flex', gap: '18px', flexWrap: 'wrap', alignItems: 'center' } }, [
      el('div', { style: { width: '46px', height: '46px', borderRadius: '13px', background: 'var(--surface-3)',
        display: 'grid', placeItems: 'center', fontSize: '21px', flex: 'none' }, text: '🏪' }),
      el('div.grow', { style: { minWidth: '190px' } }, [
        el('div', { style: { fontWeight: '750', fontSize: '15.5px' }, text: s.name }),
        el('div.small.muted', { text: s.kind + ' · ' + s.area + ', ' + s.city })
      ]),
      el('div.row', { style: { gap: '18px' } }, [
        el('div', { style: { textAlign: 'right' } }, [
          el('div.lbl', { style: { fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--muted)', fontWeight: '700' }, text: 'Catalogue freshness' }),
          el('div', { style: { fontWeight: '750', fontSize: '16px' }, text: E.formatAge(s.lastPulseMinAgo) })
        ]),
        el('div', { style: { textAlign: 'right' } }, [
          el('div.lbl', { style: { fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--muted)', fontWeight: '700' }, text: 'Items confirmed' }),
          el('div', { style: { fontWeight: '750', fontSize: '16px' }, text: fresh + ' / ' + all.length })
        ])
      ]),
      badge(flagged + ' need a pulse', tone, true),
      el('button.btn.sm.ghost', {
        onclick: () => {
          openModal(modalShell('Switch store', 'Every partner sees the same 30-second interface.', [
            el('div.stack.tight', { style: { maxHeight: '52vh', overflowY: 'auto' } }, N.STORES.slice(0, 24).map((st) =>
              el('button.card', {
                style: { display: 'flex', gap: '12px', alignItems: 'center', cursor: 'pointer', textAlign: 'left', width: '100%',
                  fontFamily: 'inherit', color: 'inherit', borderColor: st.id === S.storeId ? 'var(--brand)' : 'var(--line)' },
                onclick: () => { S.storeId = st.id; S.pulseDone = {}; S.parsed = null; closeModal(); UI.rerender(); }
              }, [
                el('div.grow', null, [
                  el('div', { style: { fontWeight: '680', fontSize: '13.5px' }, text: st.name }),
                  el('div.tiny.muted', { text: st.area + ' · ' + st.kind })
                ]),
                badge(E.formatAge(st.lastPulseMinAgo), st.syncLagHours < 6 ? 'good' : st.syncLagHours < 24 ? 'warn' : 'danger')
              ])))
          ]));
        }
      }, 'Switch')
    ]);
  }

  /* ----------------------------------------------------------- 30s PULSE --- */
  function pulseView() {
    const list = priorityList().filter((x) => x.c.score < 0.92);
    const top = list.slice(0, 12);
    const doneCount = top.filter((x) => S.pulseDone[x.p.id]).length;
    const exposure = list.reduce((s, x) => s + x.value, 0);
    const remainingExposure = top.filter((x) => !S.pulseDone[x.p.id]).reduce((s, x) => s + x.value, 0);

    return el('div.stack', { style: { gap: '18px' } }, [
      el('div.grid.g4', null, [
        UI.kpi('Items needing attention', num(list.length), 'of ' + carried().length + ' in your catalogue'),
        UI.kpi('Revenue at risk today', inr(exposure, { exact: true }), 'if these are wrong and orders cancel'),
        UI.kpi('Confirmed in this pulse', doneCount + ' / ' + top.length, 'tap to clear'),
        UI.kpi('Still exposed', inr(remainingExposure, { exact: true }), 'keep tapping', remainingExposure === 0 ? 'clear' : 'down', remainingExposure === 0 ? 'up' : 'down')
      ]),

      el('div.card', null, [
        el('div.row.between', { style: { marginBottom: '6px' } }, [
          el('div', null, [
            el('div.cap', { text: 'Today\'s pulse' }),
            el('div', { style: { fontSize: '15px', fontWeight: '750', marginTop: '4px' },
              text: top.length + ' items matter today. Tap three buttons each.' })
          ]),
          el('div', { style: { textAlign: 'right' } }, [
            el('div.tiny.muted', { text: 'Progress' }),
            el('div.bar', { style: { width: '120px', marginTop: '5px' } },
              el('i.good', { style: { width: (top.length ? doneCount / top.length * 100 : 0) + '%' } }))
          ])
        ]),
        el('p.small', { style: { margin: '4px 0 16px' } }, [
          'You are not being asked to maintain a catalogue. NOVA CART has already worked out which ',
          '<strong>' + top.length + '</strong> of your ' + carried().length + ' items will actually sell today and which ones the app ',
          'cannot currently vouch for. Everything else is left alone.'
        ]),
        el('div.stack.tight', null, top.map((x) => pulseRow(x)))
      ]),

      el('div.note.good', null, [
        '<strong>Why this works where the old dashboard did not.</strong> The old store dashboard showed all ' + carried().length + ' SKUs and asked for a full ',
        'inventory count. This asks for ' + top.length + ' taps. The brief says 39% of stores find online inventory ',
        'upkeep harder than the extra business is worth — so we removed ' + Math.round((1 - top.length / carried().length) * 100) + '% of the work.'
      ])
    ]);
  }

  function pulseRow(x) {
    const { p, c } = x;
    const done = S.pulseDone[p.id];
    const row = rowOf(p);
    const live = row.reported === 'out' ? 'out' : row.reported === 'low' ? 'low' : 'in';
    return el('div', {
      style: {
        padding: '12px 14px', borderRadius: '12px', border: '1px solid ' + (done ? 'rgba(0,214,143,.35)' : 'var(--line)'),
        background: done ? 'var(--good-soft)' : 'var(--surface-2)', transition: '.2s'
      }
    }, [
      el('div.row.between', { style: { gap: '12px', alignItems: 'center', flexWrap: 'wrap' } }, [
        el('div.grow', { style: { minWidth: '190px' } }, [
          el('div.row.mid', { style: { gap: '8px' } }, [
            el('span', { style: { fontSize: '16px' }, text: N.categoryById(p.category).icon }),
            el('span', { style: { fontWeight: '650', fontSize: '14px', color: 'var(--text)' }, text: p.name }),
            p.localOnly ? badge('local only', 'good') : null
          ]),
          el('div.tiny.muted', { style: { marginTop: '3px' },
            text: '₹' + p.price + ' · sells ~' + (p.velocity / 206).toFixed(1) + '/day in your city · ' +
              (done ? 'just confirmed' : 'last checked ' + E.formatAge(row.updatedMinAgo) + ' ago') })
        ]),
        el('div.row.mid', { style: { gap: '6px' } }, [
          el('button.btn.xs' + (live === 'in' ? '.good' : ''), { onclick: () => setStock(p, 'in') }, '✓ In stock'),
          el('button.btn.xs' + (live === 'low' ? '.good' : ''), { onclick: () => setStock(p, 'low') }, '◐ Low'),
          el('button.btn.xs' + (live === 'out' ? '.good' : ''), { onclick: () => setStock(p, 'out') }, '✕ Out')
        ])
      ]),
      el('div.row.between', { style: { marginTop: '9px', gap: '12px' } }, [
        el('div.row.mid', { style: { gap: '8px', flexWrap: 'wrap' } }, [
          el('span.tiny.muted', { text: 'App confidence:' }),
          confidenceChip(c.score, c.label),
          done ? badge('customer app updated', 'good') : badge('customers see uncertainty', 'warn')
        ]),
        el('button.btn.xs.ghost', { onclick: () => showWhy(x) }, 'Why this item?')
      ])
    ]);
  }

  function setStock(p, status) {
    const row = rowOf(p);
    row.reported = status;
    row.updatedMinAgo = 0;
    S.pulseDone[p.id] = status;
    S.log.push({ at: new Date(), product: p, status, via: 'pulse' });

    const c = confOf(p);
    const msg = status === 'out'
      ? p.name + ' hidden from customers across the city — no more cancelled orders'
      : status === 'low'
        ? p.name + ' marked low stock — customers see a caution'
        : p.name + ' confirmed — confidence now ' + Math.round(c.score * 100) + '%';
    toast(msg, status === 'out' ? 'warn' : 'good', 2400);
    UI.rerender();
  }

  function showWhy(x) {
    const { p, c } = x;
    openModal(modalShell(p.name, 'Why the engine surfaced this item today', [
      el('div.grid.g3', null, [
        el('div.kpi', { style: { padding: '13px' } }, [
          el('div.lbl', { text: 'Current confidence' }),
          el('div.val', { style: { fontSize: '24px' }, text: Math.round(c.score * 100) + '%' }),
          el('div.sub', { text: c.label })
        ]),
        el('div.kpi', { style: { padding: '13px' } }, [
          el('div.lbl', { text: 'Revenue exposure' }),
          el('div.val', { style: { fontSize: '24px' }, text: inr(x.value, { exact: true }) }),
          el('div.sub', { text: 'if this is wrong today' })
        ]),
        el('div.kpi', { style: { padding: '13px' } }, [
          el('div.lbl', { text: 'City demand' }),
          el('div.val', { style: { fontSize: '24px' }, text: p.velocity }),
          el('div.sub', { text: 'orders/day across 3 cities' })
        ])
      ]),
      el('div.card.flat', { style: { marginTop: '12px' } }, [
        el('div.cap', { text: 'How the score was built' }),
        reasonsList(c.reasons, true)
      ]),
      el('div.card.flat', { style: { marginTop: '12px' } }, [
        el('div.cap', { text: 'How we ranked it against your other items' }),
        reasonsList([
          'Exposure = city demand share x (1 - confidence) = ' + x.exposure.toFixed(4),
          'This puts it in the top ' + (priorityList().findIndex((y) => y.p.id === p.id) + 1) + ' of ' + carried().length + ' items we ask you to check.',
          'Items with high demand and low confidence are ranked first, because that is where a mistake costs the most orders.'
        ], true)
      ])
    ]), { wide: true });
  }

  /* --------------------------------------------------------- DEMAND RADAR --- */
  function radarView() {
    const s = store();
    const dow = new Date().getDay();
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const rows = carried().map((p) => ({ p, f: E.reorderPoint(s, p, dow), c: confOf(p) }))
      .sort((a, b) => b.f.forecast.units - a.f.forecast.units);
    const top = rows.slice(0, 12);
    const risky = rows.filter((r) => r.c.score < 0.6 && r.f.forecast.units > 0.4);

    return el('div.stack', { style: { gap: '18px' } }, [
      el('div.grid.g3', null, [
        UI.kpi('Forecast for today', num(rows.reduce((a, r) => a + r.f.forecast.units, 0), 1) + ' units', DAYS[dow] + ' · ' + s.area),
        UI.kpi('Items likely to sell out', num(rows.filter((r) => r.f.forecast.units > 1.2).length), 'stock these before noon'),
        UI.kpi('High-demand, low-confidence', num(risky.length), 'your biggest risk today', risky.length ? 'act now' : 'clear', 'down')
      ]),

      el('div.card', null, [
        el('div.row.between', { style: { marginBottom: '16px' } }, [
          el('div', null, [
            el('div.cap', { text: 'Demand radar' }),
            el('div', { style: { fontSize: '15px', fontWeight: '750', marginTop: '4px' }, text: 'What will actually sell here today' })
          ]),
          el('div.small.muted', { style: { maxWidth: '330px', textAlign: 'right' } },
            '28% of stores told NOVA CART they cannot predict what sells online. This is that prediction, per SKU, per day.')
        ]),
        el('div.tbl-scroll', null, el('table', null, [
          el('thead', null, el('tr', null, [
            el('th', { text: 'Item' }), el('th.num', { text: 'Forecast today' }), el('th.num', { text: '7-day' }),
            el('th.num', { text: 'Keep in stock' }), el('th', { text: 'Confidence' }), el('th', { text: 'Action' })
          ])),
          el('tbody', null, top.map((r) => el('tr', null, [
            el('td', null, [
              el('div', { style: { color: 'var(--text)', fontWeight: '600' }, text: r.p.name }),
              el('div.tiny.muted', { text: r.p.unit + ' · ₹' + r.p.price })
            ]),
            el('td.num', { text: r.f.forecast.units.toFixed(2) }),
            el('td.num', { text: r.f.forecast.units7d.toFixed(1) }),
            el('td.num', null, el('strong', { style: { color: 'var(--brand-2)' }, text: r.f.recommended + ' units' })),
            el('td', null, confidenceChip(r.c.score)),
            el('td', null, r.c.score < 0.6
              ? el('button.btn.xs', { onclick: () => { S.tab = 'pulse'; UI.rerender(); } }, 'Confirm now')
              : el('span.tiny.muted', { text: 'Verified' }))
          ])))
        ])),
        el('div.note', { style: { marginTop: '14px' } }, [
          '<strong>Forecast formula:</strong> city demand ÷ stores in city, scaled by this store\'s pull index, ',
          'a day-of-week shape per category, and a hyperlocal-exclusive bonus. Open any row\'s tooltip for the full working.'
        ])
      ]),

      el('div.card', null, [
        el('div.cap', { text: 'Category shape across the week' }),
        el('div', { style: { marginTop: '16px' } }, barChart(
          DAYS,
          N.CATEGORIES.filter((c) => s.cats.includes(c.id)).slice(0, 4).map((c) => {
            return {
              name: c.name, colour: c.colour,
              values: [0, 1, 2, 3, 4, 5, 6].map((d) => {
                const p = N.PRODUCTS.find((pp) => pp.category === c.id);
                return p ? E.forecastDemand(s, p, d).units : 0;
              })
            };
          }), { height: 130 })),
        el('div', { style: { marginTop: '12px' } }, legend(
          N.CATEGORIES.filter((c) => s.cats.includes(c.id)).slice(0, 4).map((c) => ({ name: c.name, colour: c.colour })))),
        el('div.tiny.faint', { style: { marginTop: '10px' } },
          'Each bar is the forecast for a representative item in that category. Friday and Saturday carry the peak for fresh, bakery and snacks.')
      ])
    ]);
  }

  /* ------------------------------------------------------- ZERO-TYPING ------ */
  function typingView() {
    const updates = S.parsed || [];
    return el('div.stack', { style: { gap: '18px' } }, [
      el('div.card', null, [
        el('div.cap', { text: 'Zero-typing update' }),
        el('div', { style: { fontSize: '15px', fontWeight: '750', margin: '5px 0 8px' },
          text: 'Just tell us what you are out of. In your own words.' }),
        el('p.small', { style: { marginBottom: '14px' } }, [
          'The single biggest reason catalogues go stale is that updating them feels like paperwork. ',
          'So we removed the forms. Type it like you would message a supplier — Hindi, English or mixed.'
        ]),
        el('textarea', {
          value: S.freeText, rows: 3, placeholder: 'e.g. no milk, 3 paneer left, atta khatam',
          oninput: (e) => { S.freeText = e.target.value; }
        }),
        el('div.row', { style: { marginTop: '12px' } }, [
          el('button.btn.primary', { onclick: () => { S.parsed = E.parseStockMessage(S.freeText, store()); UI.rerender(); } }, 'Parse update →'),
          el('button.btn.ghost', {
            onclick: () => { S.freeText = 'milk finished, curd low, 2 bread left, ors available, maggi khatam, tomatoes no'; UI.rerender(); }
          }, 'Try another example')
        ]),
        el('div.row', { style: { marginTop: '14px', gap: '8px' } }, [
          el('span.tiny.muted', { text: 'Try:' }),
          ...['no milk, 3 paneer left', 'atta khatam, chawal low', 'bread finished, eggs available'].map((t) =>
            el('button.pill.click', { onclick: () => { S.freeText = t; UI.rerender(); } }, t))
        ])
      ]),

      updates.length ? el('div.card', null, [
        el('div.row.between', null, [
          el('div.cap', { text: 'Parsed result' }),
          badge(updates.filter((u) => u.product).length + ' items recognised', 'good')
        ]),
        el('div.stack.tight', { style: { marginTop: '14px' } }, updates.map((u) => el('div', {
          style: { padding: '12px 14px', borderRadius: '12px', border: '1px solid ' +
            (u.status === 'unmatched' ? 'rgba(255,176,32,.3)' : 'var(--line)'), background: 'var(--surface-2)' }
        }, [
          el('div.row.between', { style: { gap: '12px', flexWrap: 'wrap' } }, [
            el('div', null, [
              el('div', { style: { fontWeight: '650', fontSize: '13.5px', color: 'var(--text)' },
                text: u.product ? u.product.name : u.raw }),
              el('div.tiny.muted', { text: 'read from: “' + u.raw + '”' + (u.qty !== null && u.qty !== undefined ? ' · qty ' + u.qty : '') })
            ]),
            el('div.row.mid', { style: { gap: '8px' } }, [
              u.product ? badge(u.matchConfidence >= 0.85 ? 'match ' + Math.round(u.matchConfidence * 100) + '%' : 'match ' + Math.round(u.matchConfidence * 100) + '%',
                u.matchConfidence >= 0.85 ? 'good' : 'warn') : badge('no match', 'warn'),
              badge(u.status === 'out' ? '✕ Out of stock' : u.status === 'low' ? '◐ Low stock' : u.status === 'in' ? '✓ In stock' : 'Needs mapping',
                u.status === 'out' ? 'danger' : u.status === 'low' ? 'warn' : u.status === 'in' ? 'good' : 'mute')
            ])
          ]),
          u.product ? el('div.tiny', { style: { marginTop: '7px', color: 'var(--text-2)' }, text: u.note }) : null,
          el('button.btn.xs.ghost', { style: { marginTop: '8px' }, onclick: () => showParseWhy(u) }, 'Why this reading?')
        ]))),
        el('div.row', { style: { marginTop: '16px' } }, [
          el('button.btn.primary', {
            onclick: () => {
              let n = 0;
              updates.forEach((u) => {
                if (!u.product) return;
                const row = rowOf(u.product);
                if (!row) return;
                row.reported = u.status; row.updatedMinAgo = 0;
                S.pulseDone[u.product.id] = u.status;
                S.log.push({ at: new Date(), product: u.product, status: u.status, via: 'message' });
                n++;
              });
              toast(n + ' items updated from one message', 'good');
              S.parsed = null; S.tab = 'pulse'; UI.rerender();
            }
          }, 'Apply ' + updates.filter((u) => u.product).length + ' updates'),
          el('button.btn.ghost', { onclick: () => { S.parsed = null; UI.rerender(); } }, 'Discard')
        ])
      ]) : null,

      el('div.note', null, [
        '<strong>Why this is not a gimmick.</strong> The brief says many stores update stock only once every 1–3 days. ',
        'A form is why. A one-line message is something a shop owner will actually do between customers — ',
        'and it can be sent on WhatsApp, which they already have open.'
      ])
    ]);
  }

  function showParseWhy(u) {
    openModal(modalShell(u.product ? u.product.name : 'Unrecognised item',
      'How the parser read your message', [
      el('div.card.flat', null, [
        el('div.cap', { text: 'Input segment' }),
        el('div', { style: { marginTop: '6px', fontFamily: 'var(--mono)', fontSize: '13px', color: 'var(--text)' }, text: '“' + u.raw + '”' })
      ]),
      el('div.card.flat', { style: { marginTop: '12px' } }, [
        el('div.cap', { text: 'Parsing steps' }),
        reasonsList(u.reasons || [
          'No catalogue token matched this phrase above the 40% threshold.',
          'The owner can map it once and the engine remembers the alias for this store permanently.'
        ], true)
      ])
    ]));
  }

  /* ---------------------------------------------------------- STORE SCORE --- */
  function scoreView() {
    const s = store();
    const all = carried();
    const fresh = all.filter((p) => confOf(p).score >= 0.8).length;
    const freshness = all.length ? fresh / all.length : 0;
    const log = S.log;
    const cancelledPrevented = log.filter((l) => l.status === 'out').length * 3;

    const components = [
      ['Catalogue freshness', freshness, 'share of items confirmed in the last few hours', 'good'],
      ['Fulfilment reliability', s.fulfilmentScore / 100, 'orders delivered without incident', s.fulfilmentScore > 70 ? 'good' : 'warn'],
      ['Peak-hour responsiveness', 1 - s.rejectRate * 5, 'orders rejected during busy periods', s.rejectRate < 0.06 ? 'good' : 'warn'],
      ['Inventory upkeep effort', 1 - Math.min(1, s.syncLagHours / 72), 'how much admin this store carries', s.syncLagHours < 12 ? 'good' : 'danger']
    ];

    return el('div.stack', { style: { gap: '18px' } }, [
      el('div.grid.g4', null, [
        UI.kpi('Store score', Math.round(components.reduce((a, [l, v]) => a + v, 0) / components.length * 100) + '/100', 'used for network ranking'),
        UI.kpi('Items confirmed', fresh + ' / ' + all.length, 'live catalogue health'),
        UI.kpi('Updates sent today', String(log.length), 'pulse + messages'),
        UI.kpi('Cancellations prevented', String(cancelledPrevented), 'estimated from out-of-stock signals', 'up', 'up')
      ]),

      el('div.card', null, [
        el('div.cap', { text: 'Your score breakdown' }),
        el('div.stack.tight', { style: { marginTop: '14px' } }, components.map(([l, v, d, tone]) =>
          barRow(l, Math.round(v * 100) + '%', v, tone, el('span.tiny.faint', { text: d })))),
        el('div.hr'),
        el('div.row.between', null, [
          el('div.small.muted', { text: 'Reliability incentive earned this month' }),
          el('span.big', { style: { color: 'var(--good)' },
            text: inr(Math.round(components.reduce((a, [l, v]) => a + v, 0) / components.length * 900)) })
        ]),
        el('div.tiny.faint', { style: { marginTop: '6px' } },
          'The ₹4L reliability pool in the business case is paid out on this score — accurate stock earns real money, so the incentive is aligned.')
      ]),

      el('div.card', null, [
        el('div.cap', { text: 'Today\'s update log' }),
        log.length ? el('div.stack.tight', { style: { marginTop: '12px' } }, log.slice().reverse().slice(0, 14).map((l) =>
          el('div.row.between', { style: { padding: '8px 0', borderBottom: '1px solid var(--line-soft)' } }, [
            el('div', null, [
              el('div.small', { style: { color: 'var(--text)', fontWeight: '600' }, text: l.product.name }),
              el('div.tiny.muted', { text: 'via ' + (l.via === 'pulse' ? '30-second pulse' : 'message parser') + ' · ' +
                l.at.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) })
            ]),
            badge(l.status === 'out' ? 'Out' : l.status === 'low' ? 'Low' : 'In stock',
              l.status === 'out' ? 'danger' : l.status === 'low' ? 'warn' : 'good')
          ]))) : el('p.small.muted', { style: { marginTop: '10px' } },
            'No updates yet today. Run a 30-second pulse or send a message to see entries appear here.')
      ])
    ]);
  }

  global.StoreView = { render, state: S };
})(window);
