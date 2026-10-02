/* =============================================================================
   ops.js — the NOVA CART operations Control Tower
   -----------------------------------------------------------------------------
   The customer app stops bad orders before payment. The store app keeps the
   catalogue honest. This screen catches whatever still slips through — and it
   is where the money is, because every order here is one that would have become
   a cancellation, a refund and a support ticket.
   ========================================================================== */
(function (global) {
  'use strict';
  const { el, inr, inrFull, num, pct, mount, badge, note, toast, statLine, barRow,
          openModal, modalShell, closeModal, openDrawer, closeDrawer, reasonsList,
          barChart, legend } = UI;
  const N = NOVA, E = ENGINE;

  const O = { tab: 'queue', filter: 'all', sort: 'risk', selected: null, reroute: null, orders: null };
  global.OPS_STATE = O;

  /* ------------------------------------------------ BUILD A LIVE QUEUE ----- */
  /* Deterministically synthesise a realistic slice of live orders using the
     case's own operating numbers: 11% cancel, 13% late, 8% substituted. */
  const rng = N.mulberry32(77123);
  function buildOrders() {
    if (O.orders) return O.orders;
    const orders = [];
    for (let i = 0; i < 34; i++) {
      const store = N.STORES[Math.floor(rng() * N.STORES.length)];
      const pool = store.cats.flatMap((c) => N.PRODUCTS.filter((p) => p.category === c));
      const nLines = 3 + Math.floor(rng() * 5);
      const lines = [];
      for (let k = 0; k < nLines; k++) {
        const p = pool[Math.floor(rng() * pool.length)];
        const c = E.availabilityConfidence(store, p);
        if (c.band === 'none') continue;
        lines.push({ product: p, confidence: c.score, qty: 1 });
      }
      if (!lines.length) continue;
      const basket = lines.reduce((s, l) => s + l.product.price, 0);
      const peak = rng() < 0.42;
      const order = {
        id: 'NC' + (210000 + i * 137 + Math.floor(rng() * 90)),
        store, lines,
        basketValue: basket + 25,
        etaMinutes: 28 + Math.round(rng() * 34),
        hour: peak ? 18 + Math.floor(rng() * 4) : 9 + Math.floor(rng() * 8),
        customerOrderCount: 1 + Math.floor(rng() * 12),
        disruption: rng() < 0.14 ? 'Heavy rain' : null,
        placedMinAgo: Math.round(rng() * 22)
      };
      order.risk = E.orderRisk(order);
      order.status = order.risk.risk >= 0.6 ? 'intervene' : order.risk.risk >= 0.35 ? 'watch' : 'healthy';
      orders.push(order);
    }
    O.orders = orders.sort((a, b) => b.risk.risk - a.risk.risk);
    return O.orders;
  }

  /* --------------------------------------------------------------- RENDER --- */
  function render(root) {
    mount(root,
      headline(),
      el('div.tabs', { style: { marginTop: '18px' } }, [
        tabBtn('queue', '🚨 Live Order Risk'),
        tabBtn('reroute', '🔀 Auto-Reroute Console'),
        tabBtn('network', '🏪 Store Health Network'),
        tabBtn('support', '🎧 Support Deflection')
      ]),
      O.tab === 'queue' ? queueView() : O.tab === 'reroute' ? rerouteView()
        : O.tab === 'network' ? networkView() : supportView()
    );
  }
  function tabBtn(k, label) {
    return el('button', { class: O.tab === k ? 'on' : '', onclick: () => { O.tab = k; UI.rerender(); } }, label);
  }

  function headline() {
    const orders = buildOrders();
    const intervene = orders.filter((o) => o.status === 'intervene');
    const atRiskValue = intervene.reduce((s, o) => s + o.risk.expectedLoss, 0);
    const networkFresh = (() => {
      let tot = 0, fresh = 0;
      N.STORES.forEach((s) => s.cats.forEach((c) => N.PRODUCTS.filter((p) => p.category === c).forEach((p) => {
        const r = E.availabilityConfidence(s, p); if (r.band === 'none') return;
        tot++; if (r.score >= 0.8) fresh++;
      })));
      return fresh / tot;
    })();

    return el('div.grid.g4', null, [
      UI.kpi('Live orders scored', String(orders.length), 'every order, every store, continuously'),
      UI.kpi('Needs intervention now', String(intervene.length), 'high cancellation probability', atRiskValue > 0 ? 'act now' : 'clear', 'down'),
      UI.kpi('Value at risk this batch', inr(atRiskValue, { exact: true }), 'expected loss if nothing is done'),
      UI.kpi('Network catalogue freshness', Math.round(networkFresh * 100) + '%', 'items confirmed within half-life', networkFresh > 0.7 ? 'healthy' : 'needs a pulse push', networkFresh > 0.7 ? 'up' : 'down')
    ]);
  }

  /* ---------------------------------------------------------------- QUEUE --- */
  function queueView() {
    const orders = buildOrders();
    const filtered = orders.filter((o) => O.filter === 'all' || o.status === O.filter);
    const shown = filtered.slice(0, 20);

    const band = { all: orders.length, intervene: orders.filter((o) => o.status === 'intervene').length,
      watch: orders.filter((o) => o.status === 'watch').length,
      healthy: orders.filter((o) => o.status === 'healthy').length };

    return el('div.stack', { style: { gap: '18px' } }, [
      el('div.card', null, [
        el('div.row.between', { style: { marginBottom: '14px', gap: '14px' } }, [
          el('div', null, [
            el('div.cap', { text: 'Live order risk queue' }),
            el('div', { style: { fontSize: '15px', fontWeight: '750', marginTop: '4px' },
              text: 'Orders ranked by probability of failing' })
          ]),
          el('div.row', { style: { gap: '7px' } }, ['all', 'intervene', 'watch', 'healthy'].map((f) =>
            el('button.pill.click' + (O.filter === f ? '.on' : ''), { onclick: () => { O.filter = f; UI.rerender(); } },
              f.charAt(0).toUpperCase() + f.slice(1) + ' · ' + band[f])))
        ]),
        el('p.small', { style: { marginBottom: '14px' } }, [
          'Today NOVA CART finds out an order failed when the customer complains. This queue scores every live order ',
          'using eight signals and surfaces the ones that need help while there is still time to act.'
        ]),
        el('div.tbl-scroll', null, el('table', null, [
          el('thead', null, el('tr', null, [
            el('th', { text: 'Order' }), el('th', { text: 'Store' }), el('th.num', { text: 'Value' }),
            el('th.num', { text: 'ETA' }), el('th', { text: 'Top driver' }), el('th.num', { text: 'Risk' }), el('th', { text: '' })
          ])),
          el('tbody', null, shown.map((o) => el('tr', { style: { cursor: 'pointer' }, onclick: () => showOrder(o) }, [
            el('td', null, [
              el('div', { style: { color: 'var(--text)', fontWeight: '650', fontFamily: 'var(--mono)', fontSize: '12.5px' }, text: o.id }),
              el('div.tiny.muted', { text: o.lines.length + ' lines · ' + o.placedMinAgo + ' min ago' })
            ]),
            el('td', null, [
              el('div', { style: { color: 'var(--text)', fontSize: '13px' }, text: o.store.name }),
              el('div.tiny.muted', { text: o.store.area + ' · stale ' + o.store.syncLagHours.toFixed(0) + 'h' })
            ]),
            el('td.num', { text: '₹' + num(o.basketValue) }),
            el('td.num', null, [
              el('div', { text: o.etaMinutes + ' min' }),
              el('div.tiny.' + (o.etaMinutes > 40 ? 'down' : 'muted'), { text: o.etaMinutes > 40 ? 'over promise' : 'within range' })
            ]),
            el('td', null, el('span.small', { style: { color: 'var(--text-2)' }, text: o.risk.topDriver.label })),
            el('td.num', null, el('span.badge.' + (o.risk.tone === 'danger' ? 'b-danger' : o.risk.tone === 'warn' ? 'b-warn' : o.risk.tone === 'info' ? 'b-info' : 'b-good'),
              { text: (o.risk.risk * 100).toFixed(0) + '%' })),
            el('td', null, el('button.btn.xs', { onclick: (e) => { e.stopPropagation(); showOrder(o); } }, 'Inspect'))
          ])))
        ])),
        el('div.tiny.faint', { style: { marginTop: '12px' } },
          'Showing top 20 of ' + filtered.length + '. Risk is a logistic function of the eight weighted signals in engine.js — click any row to see every contribution.')
      ]),

      el('div.grid.g3', null, [
        el('div.card', null, [
          el('div.cap', { text: 'Why orders fail' }),
          el('div.stack.tight', { style: { marginTop: '12px' } }, (() => {
            const agg = {};
            orders.forEach((o) => o.risk.factors.forEach((f) => { agg[f.label] = (agg[f.label] || 0) + f.contribution; }));
            const tot = Object.values(agg).reduce((a, b) => a + b, 0) || 1;
            return Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 6)
              .map(([l, v]) => barRow(l, (v / tot * 100).toFixed(0) + '%', v / tot,
                v / tot > 0.2 ? 'danger' : v / tot > 0.12 ? 'warn' : 'info'));
          })())
        ]),
        el('div.card', null, [
          el('div.cap', { text: 'If we do nothing' }),
          el('div', { style: { marginTop: '12px' } }, [
            statLine('Orders in this batch', String(orders.length)),
            statLine('Expected cancellations', (orders.reduce((s, o) => s + o.risk.risk, 0)).toFixed(1), 'down'),
            statLine('Expected refund value', inr(orders.reduce((s, o) => s + o.risk.expectedLoss, 0), { exact: true }), 'down'),
            statLine('Support tickets generated', (orders.reduce((s, o) => s + o.risk.risk, 0) * 0.55).toFixed(0), 'flat'),
            el('div.hr', { style: { margin: '10px 0' } }),
            statLine('Rider legs wasted', (orders.reduce((s, o) => s + o.risk.risk, 0)).toFixed(1) + ' trips', 'down')
          ]),
          el('div.note.danger', { style: { marginTop: '12px' } },
            'At scale this is <strong>' + inr(N.DERIVED.gmvLostToCancels) + ' of GMV</strong> and roughly <strong>' +
            inr(N.DERIVED.wasteOnCancelledOrders) + '</strong> of promo subsidy, rider capacity and refund handling, every single month.')
        ]),
        el('div.card', null, [
          el('div.cap', { text: 'With the Promise Engine' }),
          el('div', { style: { marginTop: '12px' } }, [
            statLine('Prevented before payment', num(Math.round(2245 * 0.45)) + ' orders', 'up'),
            statLine('Converted by Smart Swap', num(Math.round(2245 * 0.30)) + ' orders', 'up'),
            statLine('Rescued by auto-reroute', num(Math.round((2245 * 0.25 + 1143) * 0.55)) + ' orders', 'up'),
            el('div.hr', { style: { margin: '10px 0' } }),
            statLine('Cancellation rate', '11% → 4.9%', 'up'),
            statLine('Support tickets / month', '5,900 → 4,494', 'up')
          ]),
          el('button.btn.block.primary', { style: { marginTop: '14px' }, onclick: () => { O.tab = 'reroute'; UI.rerender(); } },
            'Open the auto-reroute console →')
        ])
      ])
    ]);
  }

  function showOrder(o) {
    O.selected = o;
    const rr = E.autoReroute(o, o.lines.slice().sort((a, b) => a.confidence - b.confidence)[0]);
    openModal(modalShell('Order ' + o.id, o.store.name + ' · ' + o.store.area + ', ' + o.store.city, [
      el('div.grid.g4', { style: { gap: '10px' } }, [
        el('div.kpi', { style: { padding: '12px' } }, [
          el('div.lbl', { text: 'Risk' }),
          el('div.val', { style: { fontSize: '24px', color: o.risk.tone === 'danger' ? 'var(--danger)' : o.risk.tone === 'warn' ? 'var(--warn)' : 'var(--good)' },
            text: (o.risk.risk * 100).toFixed(0) + '%' })
        ]),
        el('div.kpi', { style: { padding: '12px' } }, [el('div.lbl', { text: 'Basket' }), el('div.val', { style: { fontSize: '24px' }, text: '₹' + num(o.basketValue) })]),
        el('div.kpi', { style: { padding: '12px' } }, [el('div.lbl', { text: 'Expected loss' }), el('div.val', { style: { fontSize: '24px' }, text: '₹' + num(o.risk.expectedLoss) })]),
        el('div.kpi', { style: { padding: '12px' } }, [el('div.lbl', { text: 'ETA' }), el('div.val', { style: { fontSize: '24px' }, text: o.etaMinutes + 'm' })])
      ]),
      el('div.card.flat', { style: { marginTop: '12px' } }, [
        el('div.cap', { text: 'Every risk contribution, largest first' }),
        el('div.stack.tight', { style: { marginTop: '12px' } }, o.risk.factors.map((f) =>
          barRow(f.label, (f.contribution >= 0 ? '+' : '') + f.contribution.toFixed(3),
            Math.abs(f.contribution) / 1.6, f.contribution > 0.3 ? 'danger' : f.contribution > 0.1 ? 'warn' : 'info',
            el('span.tiny.faint', { text: f.detail })))),
        el('div.hr'),
        el('div.tiny.mono.faint', { text: 'z = ' + o.risk.logOdds.toFixed(3) + '   →   risk = 1 / (1 + e^(-z)) = ' + (o.risk.risk * 100).toFixed(1) + '%' })
      ]),
      el('div.card.flat', { style: { marginTop: '12px' } }, [
        el('div.cap', { text: 'Basket lines' }),
        el('div.stack.tight', { style: { marginTop: '10px' } }, o.lines.map((l) => el('div.row.between', {
          style: { padding: '7px 0', borderBottom: '1px solid var(--line-soft)' }
        }, [
          el('div', null, [
            el('span.small', { style: { color: 'var(--text)' }, text: l.product.name }),
            el('span.tiny.muted', { style: { marginLeft: '8px' }, text: '₹' + l.product.price })
          ]),
          badge(Math.round(l.confidence * 100) + '% confidence', l.confidence >= 0.8 ? 'good' : l.confidence >= 0.6 ? 'info' : l.confidence >= 0.4 ? 'warn' : 'danger')
        ])))
      ]),
      el('div.card.flat', { style: { marginTop: '12px', borderColor: rr.decision === 'PARTIAL FULFIL' ? 'rgba(255,176,32,.3)' : 'rgba(0,214,143,.3)' } }, [
        el('div.row.between', null, [
          el('div.cap', { text: 'Recommended intervention' }),
          badge(rr.decision, rr.decision === 'PARTIAL FULFIL' ? 'warn' : 'good')
        ]),
        el('p.small', { style: { margin: '10px 0 0' }, text: rr.detail }),
        rr.best ? el('div', { style: { marginTop: '10px' } }, [
          statLine('Best alternative', rr.best.store.name + ' · ' + rr.best.km + ' km'),
          statLine('Availability confidence', Math.round(rr.best.confidence * 100) + '%'),
          statLine('Fulfilment score', rr.best.store.fulfilmentScore + '/100'),
          statLine('Basket protected', inr(rr.basketSavedVsCancel))
        ]) : null
      ])
    ], [
      el('button.btn.ghost', { onclick: closeModal }, 'Close'),
      el('button.btn', { onclick: () => { closeModal(); O.tab = 'reroute'; O.selected = o; UI.rerender(); } }, 'Open in reroute console'),
      el('button.btn.primary', {
        onclick: () => {
          toast(rr.decision === 'PARTIAL FULFIL' ? 'Line refunded proactively — rest of basket preserved' : 'Order re-routed to ' + rr.best.store.name + ' — customer notified', 'good', 3000);
          o.status = 'healthy'; o.risk.risk = 0.06; o.risk.tone = 'good'; o.risk.tier = 'Healthy';
          closeModal(); UI.rerender();
        }
      }, 'Apply intervention')
    ]), { wide: true });
  }

  /* -------------------------------------------------------------- REROUTE --- */
  function rerouteView() {
    const orders = buildOrders();
    const candidates = orders.filter((o) => o.lines.some((l) => l.confidence < 0.6)).slice(0, 12);
    const sel = O.selected && candidates.includes(O.selected) ? O.selected : candidates[0];

    if (!sel) return el('div.card', null, el('p', { text: 'No orders currently need re-routing. Every basket is confirmed.' }));

    const worstLine = sel.lines.slice().sort((a, b) => a.confidence - b.confidence)[0];
    const rr = E.autoReroute(sel, worstLine);

    return el('div.grid.g2', { style: { alignItems: 'start', gap: '18px' } }, [
      el('div.stack', null, [
        el('div.card', null, [
          el('div.cap', { text: 'Order needing rescue' }),
          el('div.stack.tight', { style: { marginTop: '12px' } }, candidates.map((o) => {
            const l = o.lines.slice().sort((a, b) => a.confidence - b.confidence)[0];
            return el('button.card.flat', {
              style: { display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', color: 'inherit',
                borderColor: sel.id === o.id ? 'var(--brand)' : 'var(--line)' },
              onclick: () => { O.selected = o; UI.rerender(); }
            }, [
              el('div.row.between', null, [
                el('div', null, [
                  el('div', { style: { fontWeight: '650', fontSize: '13px', color: 'var(--text)', fontFamily: 'var(--mono)' }, text: o.id }),
                  el('div.tiny.muted', { text: o.store.name + ' · ₹' + num(o.basketValue) })
                ]),
                badge(Math.round(l.confidence * 100) + '% line', 'warn')
              ])
            ]);
          }))
        ]),
        el('div.card', null, [
          el('div.cap', { text: 'The problem' }),
          el('div', { style: { marginTop: '12px' } }, [
            statLine('Store', sel.store.name),
            statLine('Line at risk', worstLine.product.name),
            statLine('Line confidence', Math.round(worstLine.confidence * 100) + '%', 'down'),
            statLine('Basket value', '₹' + num(sel.basketValue)),
            statLine('Current behaviour', 'Cancel the whole order', 'down'),
            statLine('Support ticket generated', 'Yes', 'down'),
            statLine('Customer churn risk', sel.customerOrderCount < 3 ? 'High — inside first-3-orders window' : 'Moderate', 'down')
          ])
        ])
      ]),

      el('div.stack', null, [
        el('div.card.hl', null, [
          el('div.row.between', null, [
            el('div.cap', { text: 'Engine decision' }),
            badge(rr.decision, rr.decision === 'PARTIAL FULFIL' ? 'warn' : 'good', true)
          ]),
          el('p.small', { style: { margin: '12px 0 0' }, text: rr.detail }),
          el('div.grid.g3', { style: { marginTop: '16px', gap: '10px' } }, [
            el('div.kpi', { style: { padding: '12px' } }, [
              el('div.lbl', { text: 'Basket saved' }),
              el('div.val', { style: { fontSize: '21px', color: 'var(--good)' }, text: inr(rr.basketSavedVsCancel) })
            ]),
            el('div.kpi', { style: { padding: '12px' } }, [
              el('div.lbl', { text: 'Added ETA' }),
              el('div.val', { style: { fontSize: '21px' }, text: rr.addedMinutes + ' min' })
            ]),
            el('div.kpi', { style: { padding: '12px' } }, [
              el('div.lbl', { text: 'Options found' }),
              el('div.val', { style: { fontSize: '21px' }, text: String(rr.options.length) })
            ])
          ])
        ]),

        el('div.card', null, [
          el('div.cap', { text: 'Candidate stores, scored' }),
          el('div.stack.tight', { style: { marginTop: '12px' } }, rr.options.length ? rr.options.slice(0, 6).map((opt, i) =>
            el('div', { style: { padding: '12px', borderRadius: '12px', border: '1px solid ' + (i === 0 ? 'rgba(0,214,143,.4)' : 'var(--line)'), background: i === 0 ? 'var(--good-soft)' : 'var(--surface-2)' } }, [
              el('div.row.between', null, [
                el('div', null, [
                  el('div', { style: { fontWeight: '650', fontSize: '13.5px', color: 'var(--text)' }, text: opt.store.name }),
                  el('div.tiny.muted', { text: opt.store.area + ' · ' + opt.km + ' km · ' + opt.eta + ' min added' })
                ]),
                el('div', { style: { textAlign: 'right' } }, [
                  badge('score ' + opt.score.toFixed(3), i === 0 ? 'good' : 'mute'),
                  el('div.tiny.muted', { style: { marginTop: '4px' }, text: 'confidence ' + Math.round(opt.confidence * 100) + '%' })
                ])
              ]),
              el('div.bar', { style: { marginTop: '9px' } }, el('i' + (i === 0 ? '.good' : ''), { style: { width: opt.score * 100 + '%' } })),
              el('div.tiny.faint', { style: { marginTop: '7px' }, text: opt.reasons.join(' · ') })
            ])) : el('p.small.muted', { text: 'No store within range can supply this item reliably.' }))
        ]),

        el('div.card', null, [
          el('div.cap', { text: 'Scoring formula' }),
          el('ul.reasons.mono', { style: { marginTop: '10px' } }, [
            el('li', { text: 'score = 0.45 × availability confidence' }),
            el('li', { text: '      + 0.22 × (1 - distance ÷ 5 km)' }),
            el('li', { text: '      + 0.20 × (fulfilment score ÷ 100)' }),
            el('li', { text: '      + 0.13 × (1 - current load)' })
          ]),
          el('div.hr'),
          el('div.tiny.muted', null, [
            'Decision thresholds: added ETA ≤ 18 min → auto re-route. ≤ 30 min → offer the customer a choice with a credit. ',
            'Beyond that → proactive partial refund plus account credit, so the customer is told before they notice.'
          ])
        ]),

        el('div.row', null, [
          el('button.btn.primary.grow', {
            onclick: () => {
              toast(rr.decision === 'PARTIAL FULFIL'
                ? 'Line refunded instantly, rest of basket preserved, customer credited ₹40'
                : 'Re-routed to ' + rr.best.store.name + ' — customer notified proactively', 'good', 3200);
              sel.status = 'healthy'; sel.risk.risk = 0.05; sel.risk.tone = 'good';
              O.orders = O.orders.map((x) => x.id === sel.id ? sel : x);
              UI.rerender();
            }
          }, 'Execute intervention'),
          el('button.btn.ghost', { onclick: () => { O.selected = null; UI.rerender(); } }, 'Skip')
        ])
      ])
    ]);
  }

  /* -------------------------------------------------------------- NETWORK --- */
  function networkView() {
    const rows = N.STORES.map((s) => {
      let tot = 0, fresh = 0, phantom = 0, exposure = 0;
      s.cats.forEach((c) => N.PRODUCTS.filter((p) => p.category === c).forEach((p) => {
        const r = E.availabilityConfidence(s, p); if (r.band === 'none') return;
        tot++;
        if (r.score >= 0.8) fresh++;
        if (r.record && r.record.truth === 'out' && r.record.reported === 'in') {
          phantom++; exposure += p.price * (p.velocity / 206) * 3;
        }
      }));
      return { s, tot, fresh, freshness: tot ? fresh / tot : 0, phantom, exposure,
        riskScore: Math.round((1 - (tot ? fresh / tot : 0)) * 55 + phantom * 4 + s.rejectRate * 100) };
    }).sort((a, b) => b.riskScore - a.riskScore);

  const totalPhantom = rows.reduce((a, r) => a + r.phantom, 0);
  const totalExposure = rows.reduce((a, r) => a + r.exposure, 0);
  const worst = rows.filter((r) => r.freshness < 0.4).length;

  return el('div.stack', { style: { gap: '18px' } }, [
    el('div.grid.g4', null, [
      UI.kpi('Stores in sample', String(N.STORES.length), 'representative of the 620-store network'),
      UI.kpi('Phantom stock lines', num(totalPhantom), 'advertised but physically gone', 'caught', 'down'),
      UI.kpi('Exposure per day', inr(totalExposure), 'revenue sitting behind those lines', 'at risk', 'down'),
      UI.kpi('Stores needing help', String(worst), 'below 40% catalogue freshness', 'priority outreach', 'down')
    ]),

    el('div.card', null, [
      el('div.row.between', { style: { marginBottom: '14px' } }, [
        el('div', null, [
          el('div.cap', { text: 'Store health network' }),
          el('div', { style: { fontSize: '15px', fontWeight: '750', marginTop: '4px' }, text: 'Which partners are putting promises at risk' })
        ]),
        el('div.small.muted', { style: { maxWidth: '320px', textAlign: 'right' } },
          'This is the Partner Manager\'s new worklist — targeted help instead of a blanket email to 620 stores.')
      ]),
      el('div.tbl-scroll', { style: { maxHeight: '520px', overflowY: 'auto' } }, el('table', null, [
        el('thead', null, el('tr', null, [
          el('th', { text: 'Store' }), el('th', { text: 'Area' }), el('th.num', { text: 'Stale' }),
          el('th.num', { text: 'Freshness' }), el('th.num', { text: 'Phantom lines' }),
          el('th.num', { text: 'Reject rate' }), el('th.num', { text: 'Score' }), el('th', { text: '' })
        ])),
        el('tbody', null, rows.map((r) => el('tr', null, [
          el('td', null, [
            el('div', { style: { color: 'var(--text)', fontWeight: '620', fontSize: '13px' }, text: r.s.name }),
            el('div.tiny.muted', { text: r.s.kind + (r.s.consideringExit ? ' · ⚠ considering exit' : '') })
          ]),
          el('td', { text: r.s.area }),
          el('td.num', { text: r.s.syncLagHours.toFixed(1) + 'h' }),
          el('td.num', null, [
            el('div', { style: { fontWeight: '700', color: r.freshness > 0.7 ? 'var(--good)' : r.freshness > 0.4 ? 'var(--warn)' : 'var(--danger)' },
              text: Math.round(r.freshness * 100) + '%' }),
            el('div.bar.thin', { style: { marginTop: '4px', width: '52px', marginLeft: 'auto' } },
              el('i.' + (r.freshness > 0.7 ? 'good' : r.freshness > 0.4 ? 'warn' : 'danger'), { style: { width: r.freshness * 100 + '%' } }))
          ]),
          el('td.num', null, el('strong', { style: { color: r.phantom > 4 ? 'var(--danger)' : r.phantom > 1 ? 'var(--warn)' : 'var(--muted)' }, text: String(r.phantom) })),
          el('td.num', { text: (r.s.rejectRate * 100).toFixed(1) + '%' }),
          el('td.num', null, el('span.badge.' + (r.riskScore > 55 ? 'b-danger' : r.riskScore > 30 ? 'b-warn' : 'b-good'), { text: String(r.riskScore) })),
          el('td', null, el('button.btn.xs', {
            onclick: () => toast('Pulse request sent to ' + r.s.name + ' on WhatsApp', 'good')
          }, 'Nudge'))
        ])))
      ])),
      el('div.note', { style: { marginTop: '14px' } }, [
        '<strong>This turns the partner problem into a partner programme.</strong> Instead of asking 620 stores to try harder, ',
        'we rank them by how much promise-risk they create and send targeted help — a pulse reminder, a training nudge, ',
        'or a reliability incentive payment. The 18% considering exit are flagged before they leave.'
      ])
    ])
  ]);
  }

  /* -------------------------------------------------------------- SUPPORT --- */
  function supportView() {
    const S = N.SUPPORT;
    const truthShare = (19 + 29) / 100;
    const deflectable = Math.round(S.total * truthShare * 0.65);
    const costPer = 75;

    return el('div.stack', { style: { gap: '18px' } }, [
      el('div.grid.g4', null, [
        UI.kpi('Tickets / month', num(S.total), 'up from 3,100 six months ago', '+90%', 'down'),
        UI.kpi('Avg resolution time', S.avgResolutionHours + ' h', 'across separate systems'),
        UI.kpi('Proactively deflectable', num(deflectable), 'refund status + missing items'),
        UI.kpi('Monthly cost recovered', inr(deflectable * costPer), 'at ₹' + costPer + ' blended per ticket', 'up', 'up')
      ]),

      el('div.grid.g2', { style: { alignItems: 'start' } }, [
        el('div.card', null, [
          el('div.row.between', null, [el('div.cap', { text: 'Ticket mix' }), badge('n = 5,900', 'mute')]),
          el('div.stack.tight', { style: { marginTop: '12px' } }, S.categories.map((c, i) =>
            barRow(c.label, c.pct + '%', c.pct / 32, ['danger', 'warn', 'danger', 'info', 'mute', 'mute'][i]))),
          el('div.note.danger', { style: { marginTop: '10px' } }, [
            '<strong>' + Math.round(truthShare * 100) + '% of all support volume is caused by the same root cause.</strong> ',
            'Refund status (29%) and missing/unavailable products (19%) are both the inventory-truth problem ',
            'arriving in the support queue hours later.'
          ])
        ]),
        el('div.card', null, [
          el('div.cap', { text: 'How each ticket type gets deflected' }),
          el('div.stack', { style: { marginTop: '12px' } }, [
            ['Refund status', 'The engine already knows a refund is due the moment a line fails. Push the status to the customer with the amount and a timestamp, before they think to ask.', 'good'],
            ['Missing / unavailable products', 'Never happens — the item was caught before payment, or re-routed after it.', 'good'],
            ['Delayed delivery', 'Honest ETAs mean fewer surprises. When a delay does occur, we tell the customer first and offer a choice.', 'good'],
            ['Coupon problems', 'Not addressed by this product. Left for the promotions team.', 'mute'],
            ['Incorrect orders', 'Reduced indirectly: accurate stock means fewer last-minute substitutions.', 'warn']
          ].map(([t, d, tone]) => el('div', { style: { padding: '11px 13px', borderRadius: '11px', background: 'var(--surface-2)', border: '1px solid var(--line)' } }, [
            el('div.row.between', null, [el('div', { style: { fontWeight: '650', fontSize: '13px', color: 'var(--text)' }, text: t }), badge(tone === 'good' ? 'deflected' : tone === 'warn' ? 'reduced' : 'unchanged', tone === 'good' ? 'good' : tone === 'warn' ? 'warn' : 'mute')]),
            el('div.tiny.muted', { style: { marginTop: '5px', lineHeight: '1.5' }, text: d })
          ])))
        ])
      ]),

      el('div.card', null, [
        el('div.cap', { text: 'Ticket volume, six months' }),
        el('div', { style: { marginTop: '16px' } }, barChart(
          ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'],
          (() => {
            const m = ENGINE.impactModel();
            return [
              { name: 'Without Promise Engine', colour: '#ff4d5e', values: [5900, 5900, 5900, 5900, 5900, 5900] },
              { name: 'With Promise Engine', colour: '#00d68f', values: m.rows.map((r) => r.tickets) }
            ];
          })(), { height: 140, max: 6400 })),
        el('div', { style: { marginTop: '12px' } }, legend([
          { name: 'Do nothing (flat at 5,900)', colour: '#ff4d5e' },
          { name: 'With Promise Engine', colour: '#00d68f' }
        ])),
        el('div.note.good', { style: { marginTop: '14px' } }, [
          '<strong>Tickets fall to ' + num(ENGINE.impactModel().totals.month6Tickets) + ' by month 6</strong> without adding a single support agent. ',
          'We are not handling tickets faster — we are stopping the events that create them.'
        ])
      ])
    ]);
  }

  global.OpsView = { render, state: O, buildOrders };
})(window);
