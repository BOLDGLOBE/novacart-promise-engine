/* =============================================================================
   NOVA CART — PROMISE ENGINE
   engine.js — the reasoning layer
   -----------------------------------------------------------------------------
   Six explainable models. No black boxes, no API keys, no training runs — every
   number the UI shows can be traced back to a formula in this file.

     1. availabilityConfidence()  how much should we trust a stock report?
     2. orderRisk()               will this order fail before it is delivered?
     3. forecastDemand()          what will this store sell today?
     4. findSubstitutes()         what else could the customer happily accept?
     5. autoReroute()             which nearby store can actually fulfil this?
     6. parseStockMessage()       turn "no milk, 3 paneer left" into structured stock
     7. impactModel()             6-month business impact simulation

   Every model returns a `reasons` array so the product can *show its work* to
   the store owner, the customer and the ops manager.
   ========================================================================== */
(function (global) {
  'use strict';

  const N = global.NOVA;
  const { clamp, round, haversineKm } = N;

  /* ==========================================================================
     1. AVAILABILITY CONFIDENCE
     --------------------------------------------------------------------------
     A stock report is not a fact, it is a *claim with an expiry date*.
     Two things erode a claim: what the store said, and how long ago they said it.

       confidence = statusWeight  x  (FLOOR + (1 - FLOOR) x freshness)
       freshness  = 2 ^ ( -ageHours / halfLife )

     `halfLife` is learned per store: stores that only touch their catalogue
     every few days get a short half-life, so their claims decay fast and the
     app stops promising things they cannot deliver.
     ========================================================================== */
  const STATUS_WEIGHT = { in: 0.97, low: 0.70, out: 0.03, unknown: 0.40 };
  const FLOOR = 0.35;

  function halfLifeHours(store) {
    // Effort-averse stores have historically unreliable catalogues -> shorter memory.
    // Half-lives are deliberately generous: a store that pulsed 12h ago still gets
    // partial credit. We only hard-flag what we genuinely cannot vouch for.
    return store.effortAverse ? 13 : 6;
  }

  function availabilityConfidence(store, product) {
    const record = N.inv(store.id, product.id);
    if (!record) {
      return { score: 0.15, band: 'none', label: 'Not carried', action: 'hide', record: null,
        reasons: ['This store does not stock this item.'] };
    }
    const ageHours = record.updatedMinAgo / 60;
    const hl = halfLifeHours(store);
    const freshness = Math.pow(2, -ageHours / hl);
    const statusWeight = STATUS_WEIGHT[record.reported] ?? 0.4;
    const score = clamp(statusWeight * (FLOOR + (1 - FLOOR) * freshness), 0.01, 0.99);

    let band, label, action;
    if (score >= 0.80)      { band = 'high';   label = 'Verified in stock';  action = 'show'; }
    else if (score >= 0.60) { band = 'medium'; label = 'Likely available';   action = 'show'; }
    else if (score >= 0.40) { band = 'low';    label = 'Unconfirmed';        action = 'warn'; }
    else                    { band = 'stale';  label = 'Not verified today'; action = 'confirm'; }

    const reasons = [
      `Store last reported "${record.reported}" ${formatAge(record.updatedMinAgo)} ago.`,
      `Claim half-life for this store is ${hl}h, so freshness is ${(freshness * 100).toFixed(0)}%.`,
      `Status weight for "${record.reported}" is ${statusWeight.toFixed(2)}.`,
      `Combined confidence = ${(statusWeight).toFixed(2)} x (${FLOOR} + ${(1 - FLOOR).toFixed(2)} x ${freshness.toFixed(3)}) = ${(score * 100).toFixed(0)}%.`
    ];
    if (store.effortAverse) reasons.push('Store is in the effort-averse segment (39% of partners) — catalogue upkeep is a known pain point.');

    return { score, band, label, action, record, freshness, ageHours, halfLife: hl, reasons };
  }

  function formatAge(min) {
    if (min < 60) return `${Math.round(min)} min`;
    const h = min / 60;
    if (h < 48) return `${h.toFixed(1)} h`;
    return `${(h / 24).toFixed(1)} days`;
  }

  /* ==========================================================================
     2. ORDER RISK
     --------------------------------------------------------------------------
     A logistic model over eight signals the case study hands us. Calibrated so a
     healthy order lands near the 11% baseline cancellation rate and a bad order
     lands above 80%.
     ========================================================================== */
  const RISK_WEIGHTS = {
    intercept: -3.20,
    unverifiedLines: 1.55,   // share of basket lines we cannot vouch for
    staleness: 0.035,        // per hour of catalogue age beyond 4h
    rejectPropensity: 2.20,  // store's historical order-rejection rate
    promiseGap: 0.055,       // per minute of ETA beyond the 29-min baseline
    peakHour: 0.42,
    newCustomer: 0.30,       // still inside the fragile first-3-orders window
    storeLoad: 0.90,         // open orders / capacity
    disruption: 0.35         // rain, festival, bandh
  };

  function orderRisk(order) {
    const store = order.store;
    const w = RISK_WEIGHTS;
    const factors = [];
    let z = w.intercept;

    // --- unverified lines
    const unverified = order.lines.filter((l) => l.confidence < 0.60).length;
    const unverifiedShare = order.lines.length ? unverified / order.lines.length : 0;
    const f1 = w.unverifiedLines * unverifiedShare;
    z += f1;
    factors.push({ key: 'unverifiedLines', label: 'Unconfirmed basket lines', value: unverifiedShare,
      contribution: f1, detail: `${unverified} of ${order.lines.length} lines below 60% confidence` });

    // --- catalogue staleness
    const staleHours = Math.max(0, store.syncLagHours - 4);
    const f2 = Math.min(w.staleness * staleHours, 1.40);
    z += f2;
    factors.push({ key: 'staleness', label: 'Catalogue staleness', value: staleHours,
      contribution: f2, detail: `${store.syncLagHours.toFixed(1)}h since last stock sync (4h tolerance)` });

    // --- store rejection propensity
    const f3 = w.rejectPropensity * store.rejectRate;
    z += f3;
    factors.push({ key: 'rejectPropensity', label: 'Store rejection history', value: store.rejectRate,
      contribution: f3, detail: `${(store.rejectRate * 100).toFixed(1)}% of this store's orders get rejected` });

    // --- promise gap
    const gap = Math.max(0, order.etaMinutes - 29);
    const f4 = Math.min(w.promiseGap * gap, 1.60);
    z += f4;
    factors.push({ key: 'promiseGap', label: 'ETA beyond baseline', value: gap,
      contribution: f4, detail: `${order.etaMinutes} min promised vs 29 min 6-month baseline` });

    // --- peak hour
    const peak = order.hour >= 18 && order.hour <= 22;
    const f5 = peak ? w.peakHour : 0;
    z += f5;
    factors.push({ key: 'peakHour', label: 'Evening peak window', value: peak ? 1 : 0,
      contribution: f5, detail: peak ? `Order placed at ${order.hour}:00 — peak load window` : 'Off-peak order' });

    // --- new customer
    const isNew = order.customerOrderCount < 3;
    const f6 = isNew ? w.newCustomer : 0;
    z += f6;
    factors.push({ key: 'newCustomer', label: 'Inside first-3-orders window', value: isNew ? 1 : 0,
      contribution: f6, detail: isNew ? `Customer has placed ${order.customerOrderCount} order(s) — the fragile trust window` : 'Established customer (3+ orders, 72% monthly repeat)' });

    // --- store load
    const load = store.openOrders / store.capacity;
    const f7 = w.storeLoad * load;
    z += f7;
    factors.push({ key: 'storeLoad', label: 'Store load right now', value: load,
      contribution: f7, detail: `${store.openOrders} open orders against capacity ${store.capacity}` });

    // --- disruption
    const f8 = order.disruption ? w.disruption : 0;
    z += f8;
    factors.push({ key: 'disruption', label: 'Weather / demand disruption', value: order.disruption ? 1 : 0,
      contribution: f8, detail: order.disruption ? `${order.disruption} in ${store.city}` : 'No disruption flagged' });

    const risk = 1 / (1 + Math.exp(-z));

    let tier, tone;
    if (risk >= 0.60)      { tier = 'Critical'; tone = 'danger'; }
    else if (risk >= 0.35) { tier = 'Elevated'; tone = 'warn'; }
    else if (risk >= 0.18) { tier = 'Watch';    tone = 'info'; }
    else                   { tier = 'Healthy';  tone = 'good'; }

    factors.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
    return { risk, tier, tone, logOdds: z, factors,
      expectedLoss: round(risk * order.basketValue, 0),
      topDriver: factors[0] };
  }

  /* ==========================================================================
     3. DEMAND FORECAST
     --------------------------------------------------------------------------
     Base demand for a SKU at one store, then modulated by day-of-week and
     category seasonality. This is what lets a store owner answer "what should I
     keep in stock today?" without doing any analysis at all.
     ========================================================================== */
  const DOW_SHAPE = {
    produce:   [1.05, 0.95, 0.98, 1.00, 1.06, 1.22, 1.14],
    dairy:     [1.00, 0.98, 0.99, 1.00, 1.04, 1.12, 1.09],
    bakery:    [0.96, 0.98, 1.00, 1.02, 1.12, 1.24, 1.16],
    staples:   [1.16, 1.02, 0.98, 0.98, 1.02, 1.08, 1.04],
    snacks:    [0.98, 0.96, 0.99, 1.01, 1.14, 1.26, 1.18],
    care:      [0.94, 0.97, 1.00, 1.02, 1.08, 1.14, 1.10],
    home:      [1.08, 1.00, 0.98, 1.00, 1.04, 1.10, 1.06],
    pharma:    [1.10, 0.98, 0.97, 0.99, 1.03, 1.05, 1.04],
    stationery:[1.14, 1.00, 0.98, 1.00, 1.02, 0.96, 0.92]
  };
  const AVG_STORE_ORDERS_PER_DAY = (N.BRIEF.monthlyOrders.now / 30) / (N.BRIEF.stores / N.BRIEF.cities);

  function forecastDemand(store, product, dowIndex) {
    const storesInCity = N.BRIEF.stores / N.BRIEF.cities;
    const cityUnits = product.velocity / storesInCity;           // units/day for an average store
    const storePull = (store.monthlyOrders / 30) / AVG_STORE_ORDERS_PER_DAY;
    const shape = DOW_SHAPE[product.category] || DOW_SHAPE.staples;
    const dow = shape[dowIndex % 7];
    // Hyperlocal exclusives over-index at specialist stores
    const localBoost = product.localOnly && store.cats.length <= 4 ? 1.45 : 1;
    // Cross-category shoppers buy more from supermarkets
    const breadthBoost = 1 + (store.cats.length - 3) * 0.05;
    const units = Math.max(0, cityUnits * storePull * dow * localBoost * breadthBoost);
    return {
      units: round(units, 2),
      units7d: round(units * 7, 1),
      dowIndex,
      reasons: [
        `City demand ${product.velocity} orders/day ÷ ${Math.round(storesInCity)} stores in city = ${round(cityUnits, 2)} units/store`,
        `Store pull index ${round(storePull, 2)} (this store does ${store.monthlyOrders} orders/month)`,
        `Day-of-week factor ${dow} for ${product.category}`,
        localBoost > 1 ? `Hyperlocal exclusive bonus x${localBoost}` : `Standard assortment`,
        breadthBoost > 1 ? `Multi-category store bonus x${round(breadthBoost, 2)}` : `Narrow assortment`
      ]
    };
  }

  /* Recommended cover level: 2 days of demand, minimum 2 units */
  function reorderPoint(store, product, dowIndex) {
    const f = forecastDemand(store, product, dowIndex);
    const safety = product.localOnly ? 2.2 : 1.8;
    return { forecast: f, recommended: Math.max(2, Math.ceil(f.units * safety)), safetyFactor: safety, reasons: f.reasons };
  }

  /* ==========================================================================
     4. SUBSTITUTION ENGINE
     --------------------------------------------------------------------------
     The moment of highest value is *before* payment, not after. If we can swap
     a shaky line for something the store definitely has, we convert a future
     cancellation into a completed order.
     ========================================================================== */
  function priceSimilarity(a, b) {
    const d = Math.abs(a - b) / Math.max(a, b);
    return clamp(1 - d / 0.6, 0, 1);           // within 60% price difference
  }
  function unitSimilarity(a, b) {
    const fam = (u) => (/kg|g\b/.test(u) ? 'weight' : /ml|l\b/i.test(u) ? 'volume' : /pcs|unit|set|pads|tabs|caps|sachets|rolls|sheets/.test(u) ? 'count' : 'other');
    return fam(a) === fam(b) ? 1 : 0.25;
  }

  function findSubstitutes(store, product, opts = {}) {
    const maxKm = opts.maxKm ?? 4.0;
    const limit = opts.limit ?? 3;
    const minConfidence = opts.minConfidence ?? 0.62;
    const candidates = [];

    N.STORES.forEach((other) => {
      const km = haversineKm(store, other);
      if (other.id !== store.id && km > maxKm) return;
      if (other.id === store.id && !other.cats.includes(product.category)) return;
      N.PRODUCTS.forEach((cand) => {
        if (cand.id === product.id) return;
        const sameCat = cand.category === product.category;
        const adjacent = !sameCat && opts.allowAdjacent && (
          (product.category === 'dairy' && cand.category === 'bakery') ||
          (product.category === 'bakery' && cand.category === 'dairy') ||
          (product.category === 'produce' && cand.category === 'staples') ||
          (product.category === 'care' && cand.category === 'pharma'));
        if (!sameCat && !adjacent) return;

        const c = availabilityConfidence(other, cand);
        if (c.score < minConfidence) return;              // only offer things we can actually deliver

        const proximity = other.id === store.id ? 1 : clamp(1 - km / maxKm, 0, 1);
        const score =
          0.30 * (sameCat ? 1 : 0.55) +
          0.24 * priceSimilarity(product.price, cand.price) +
          0.14 * unitSimilarity(product.unit, cand.unit) +
          0.20 * c.score +
          0.12 * proximity;

        candidates.push({
          product: cand, store: other, confidence: c.score, km,
          sameStore: other.id === store.id, score: round(score, 3),
          priceDelta: cand.price - product.price,
          reasons: [
            sameCat ? `Same category (${cand.category})` : `Adjacent category (${cand.category})`,
            `Price similarity ${(priceSimilarity(product.price, cand.price) * 100).toFixed(0)}% (₹${product.price} → ₹${cand.price})`,
            `Unit compatibility ${(unitSimilarity(product.unit, cand.unit) * 100).toFixed(0)}%`,
            `Availability confidence ${(c.score * 100).toFixed(0)}% at ${other.name}`,
            other.id === store.id ? 'Same store — no extra delivery leg' : `${km} km away`
          ]
        });
      });
    });

    candidates.sort((a, b) => b.score - a.score);

    // Prefer same-store options: they cost nothing operationally
    const sameStore = candidates.filter((c) => c.sameStore).slice(0, limit);
    const crossStore = candidates.filter((c) => !c.sameStore).slice(0, limit);
    // Same-store swaps first — they cost nothing operationally and keep the
    // delivery promise intact, which is the whole point.
    const ordered = [...sameStore, ...crossStore];
    return ordered.slice(0, limit + 3);
  }

  /* ==========================================================================
     5. AUTO-REROUTE
     --------------------------------------------------------------------------
     The order is already placed and paid. The item has just gone out of stock.
     Today that means a cancellation. Instead: find the nearest store that can
     actually deliver it and decide whether the extra minutes are worth it.
     ========================================================================== */
  function autoReroute(order, line, opts = {}) {
    const maxKm = opts.maxKm ?? 5.0;
    const minConfidence = opts.minConfidence ?? 0.70;
    const original = order.store;
    const product = line.product;

    const options = N.STORES
      .filter((s) => s.id !== original.id && s.cats.includes(product.category))
      .map((s) => {
        const km = haversineKm(original, s);
        const c = availabilityConfidence(s, product);
        const load = s.openOrders / s.capacity;
        const eta = Math.round(km / 0.35 + s.prepMinutes + 6);      // 0.35 km/min effective speed
        const score = 0.45 * c.score + 0.22 * clamp(1 - km / maxKm, 0, 1)
                    + 0.20 * (s.fulfilmentScore / 100) + 0.13 * (1 - load);
        return { store: s, km, confidence: c.score, eta, load, score: round(score, 3),
          reasons: [
            `Availability confidence ${(c.score * 100).toFixed(0)}%`,
            `${km} km away — ${eta} min for this delivery leg`,
            `Fulfilment score ${s.fulfilmentScore}/100`,
            `Current load ${(load * 100).toFixed(0)}% (${s.openOrders}/${s.capacity})`
          ] };
      })
      .filter((o) => o.confidence >= minConfidence && o.km <= maxKm)
      .sort((a, b) => b.score - a.score);

    const best = options[0] || null;
    let decision, detail, addedMinutes = 0;
    if (!best) {
      decision = 'PARTIAL FULFIL';
      detail = `No store within ${maxKm} km can reliably supply this item. Deliver the rest of the basket, refund the missing line instantly and proactively, credit the account, and log the demand gap for the category team.`;
    } else {
      addedMinutes = Math.max(0, best.eta - original.prepMinutes);
      if (addedMinutes <= 18) {
        decision = 'AUTO-REROUTE';
        detail = `Reassign this line to ${best.store.name} (${best.km} km) and dispatch immediately. The customer keeps the order and barely notices — added ETA ${addedMinutes} min.`;
      } else if (addedMinutes <= 30) {
        decision = 'OFFER CHOICE';
        detail = `Ask the customer: accept a ${addedMinutes}-minute delay from ${best.store.name}, or take an instant refund on the line plus a ₹40 credit. Giving the choice converts better than cancelling for them.`;
      } else {
        decision = 'PARTIAL FULFIL';
        detail = `Delay of ${addedMinutes} min is too large to ask of the customer. Refund the line instantly, deliver the rest, and credit the account.`;
      }
    }

    // A single missing line currently cancels the WHOLE basket (11% order
    // cancellation rate). Rerouting or proactively refunding preserves it.
    const basketProtected = decision === 'PARTIAL FULFIL'
      ? Math.max(0, order.basketValue - product.price)
      : order.basketValue;

    return {
      options, best, decision, detail, addedMinutes, basketProtected,
      orderValueAtRisk: order.basketValue,
      lineValue: product.price,
      // Rupees of basket value that would have been lost to a full cancellation
      basketSavedVsCancel: basketProtected,
      refundAvoided: decision === 'PARTIAL FULFIL' ? 0 : product.price
    };
  }

  /* ==========================================================================
     6. NATURAL-LANGUAGE STOCK PARSER
     --------------------------------------------------------------------------
     The single biggest barrier to inventory accuracy is *typing*. A shop owner
     will happily tell you "milk khatam, 3 paneer left" — so we parse that.
     Rule-based, runs offline, zero API cost.
     ========================================================================== */
  const NEGATIVE = ['no', 'not', 'out', 'over', 'finished', 'khatam', 'khalas', 'sold out', 'empty', 'nil', 'unavailable', 'gone', 'zero', '0'];
  const LOW = ['low', 'few', 'kam', 'almost', 'last', 'only', 'running out', 'less', 'limited'];
  const POSITIVE = ['available', 'have', 'in stock', 'full', 'plenty', 'yes', 'ok', 'restocked', 'back'];

  function normalise(s) { return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim(); }

  /* Shop owners do not speak in SKU codes. They say "doodh khatam" or
     "2 paneer left". This index maps colloquial words onto the catalogue so the
     update works in the language the store actually uses. */
  const EXTRA_TOKENS = {
    'Sourdough Loaf': 'bread artisan', 'Whole Wheat Bread': 'bread pav',
    'Multigrain Buns': 'bun bread pav', 'Butter Croissant': 'bakery french croissant',
    'Chocolate Truffle Pastry': 'cake dessert pastry', 'Fresh Paneer Puff': 'bakery snack puff',
    'Heritage Greek Yogurt': 'curd dahi yogurt', 'Nandini Curd': 'dahi yogurt curd',
    'Farm Eggs (Brown)': 'egg anda', 'Amul Taaza Toned Milk': 'doodh milk',
    'Cold-Pressed Groundnut Oil': 'oil tel', 'Fortune Sunflower Oil': 'oil tel',
    'Toor Dal': 'dal pulses arhar', 'Madhur Sugar': 'cheeni sugar',
    'Tata Salt': 'namak salt', 'Tata Tea Gold': 'chai tea',
    'Bru Instant Coffee': 'coffee kaapi', 'Filter Coffee Decoction': 'coffee kaapi',
    'Bananas (Robusta)': 'banana kela', 'Alphonso Mangoes': 'mango aam',
    'Tomatoes': 'tamatar tomato', 'Onions': 'pyaz onion', 'Potatoes': 'aloo potato',
    'Baby Spinach': 'palak greens', 'Coriander & Mint Bunch': 'dhania pudina herbs',
    'Paracetamol 650 mg': 'dolo fever tablet', 'ORS Electrolyte Sachets': 'electral dehydration',
    'Colgate Strong Teeth': 'toothpaste', 'Dove Shampoo': 'shampoo',
    'Classmate Notebook': 'copy register khata', 'Cello Butterflow Pen': 'ballpoint pen',
    'A4 Print Paper': 'printer xerox sheet', 'Whisper Ultra Clean': 'sanitary pads',
    'Surf Excel Matic': 'detergent washing powder', 'Vim Dishwash Gel': 'dishwash bar soap',
    'Maggi 2-Minute Noodles': 'noodles instant', 'Britannia Good Day': 'biscuit cookies',
    'Haldiram Aloo Bhujia': 'namkeen bhujia', 'Thums Up': 'cold drink cola soda',
    'Tropicana Orange Juice': 'juice squash', 'Dark Chocolate 70%': 'chocolate bar',
    'Gillette Mach3 Cartridges': 'razor blade shave', 'Whisper Ultra Clean ': 'pads',
    'Dettol Antiseptic Liquid': 'sanitizer germ', 'Harpic Toilet Cleaner': 'toilet flush',
    'Bamboo Kitchen Towels': 'tissue napkin', 'Sona Masoori Rice': 'chawal rice',
    'Aashirvaad Atta': 'flour gehu', 'Organic Quinoa': 'quinoa grain',
    'MTR Sambar Powder': 'masala sambar', 'Amul Butter': 'makhan butter',
    'Britannia Cheese Slices': 'cheese slice', 'Nivea Body Lotion': 'lotion moisturiser',
    'Vitamin D3 60K': 'supplement capsule', 'Digital Thermometer': 'fever thermometer',
    'Ayurvedic Cough Syrup': 'cough kof syrup', 'Sketch Pens (12 shades)': 'colors crayon',
    'Sticky Notes Assorted': 'postit memo', 'Permanent Marker': 'marker sketchpen'
  };

  const STOPWORDS = new Set(['no', 'not', 'and', 'the', 'a', 'an', 'is', 'are', 'was', 'were', 'have', 'has', 'had',
    'left', 'only', 'low', 'out', 'over', 'few', 'almost', 'last', 'less', 'running', 'empty', 'finished',
    'khatam', 'khalas', 'sold', 'nil', 'zero', 'gone', 'available', 'stock', 'in', 'on', 'at', 'to', 'of',
    'for', 'please', 'pls', 'sir', 'bhai', 'there', 'get', 'give', 'want', 'need', 'more', 'much', 'any',
    'some', 'do', 'we', 'it', 'this', 'that', 'very', 'now', 'today', 'yes', 'ok', 'okay', 'full', 'plenty',
    'back', 'restocked', 'have', 'piece', 'pieces', 'pcs', 'unit', 'units', 'kg', 'gram', 'grams', 'ltr', 'litre']);

  function wordVariants(w) {
    const out = new Set([w]);
    if (w.length > 3) {
      if (w.endsWith('s')) out.add(w.slice(0, -1));
      else out.add(w + 's');
      if (w.endsWith('es')) out.add(w.slice(0, -2));
    }
    return out;
  }

  const SEARCH_INDEX = N.PRODUCTS.map((p) => {
    const set = new Set();
    normalise(p.name).split(' ').forEach((w) => { if (w.length > 1) wordVariants(w).forEach((v) => set.add(v)); });
    normalise(p.category).split(' ').forEach((w) => set.add(w));
    const extra = EXTRA_TOKENS[p.name] || EXTRA_TOKENS[p.name.trim()];
    if (extra) extra.split(' ').forEach((w) => set.add(normalise(w)));
    return { product: p, tokens: set };
  });

  function matchProducts(text) {
    const t = normalise(text);
    // Meaningful query words only — status words like "no", "low", "left" must
    // never be allowed to match a product, or "no milk" would match nothing.
    const qWords = t.split(' ')
      .filter((w) => w.length > 1 && !STOPWORDS.has(w) && !/^[0-9]+$/.test(w));
    if (!qWords.length) return [];
    const scored = SEARCH_INDEX.map((entry) => {
      let hits = 0;
      qWords.forEach((q) => {
        const qv = wordVariants(q);
        if ([...qv].some((v) => entry.tokens.has(v))) hits++;
      });
      const coverage = hits / qWords.length;
      const exact = t.includes(normalise(entry.product.name)) ? 0.35 : 0;
      return { product: entry.product, score: coverage * 0.9 + exact };
    })
      .filter((x) => x.score >= 0.40)
      .sort((a, b) => b.score - a.score || b.product.velocity - a.product.velocity);
    return scored.slice(0, 2);
  }

  function parseStockMessage(text, store) {
    const segments = text.split(/[\n,;]|\band\b|\bplus\b/).map((s) => s.trim()).filter(Boolean);
    const updates = [];
    segments.forEach((seg) => {
      const s = normalise(seg);
      const matches = matchProducts(seg);
      if (!matches.length) {
        updates.push({ status: 'unmatched', raw: seg, confidence: 0,
          note: 'No catalogue item matched. The store can map it once and we remember it forever.' });
        return;
      }
      const qtyMatch = s.match(/(\d+)\s*(left|remaining|pcs|kg|units|pieces)?/);
      const hasNeg = NEGATIVE.some((n) => new RegExp(`(^|\\s)${n}($|\\s)`).test(s) || s.includes(n));
      const hasLow = LOW.some((l) => s.includes(l));
      const hasPos = POSITIVE.some((p) => s.includes(p));

      let status;
      if (hasNeg && !hasLow) status = 'out';
      else if (hasLow || (qtyMatch && Number(qtyMatch[1]) <= 4)) status = 'low';
      else if (hasPos) status = 'in';
      else status = 'low';

      const qty = status === 'out' ? 0 : qtyMatch ? Number(qtyMatch[1]) : null;

      if (status === 'unmatched') return;

      matches.forEach((m) => {
        updates.push({
          status, raw: seg, qty,
          product: m.product,
          matchConfidence: round(Math.min(m.score, 1), 2),
          note: status === 'out' ? 'Will be hidden from customers city-wide immediately.'
              : status === 'low' ? 'Shown to customers with a "low stock" caution badge.'
              : 'Marked verified in stock.',
          reasons: [
            `Matched "${m.product.name}" at ${(Math.min(m.score, 1) * 100).toFixed(0)}% confidence`,
            hasNeg ? 'Negation phrase detected ("khatam" / "finished" / "no")'
              : hasLow ? 'Low-stock phrase detected ("kam" / "few" / "last")'
              : hasPos ? 'Positive availability phrase detected'
              : 'No explicit status — defaulted to low as the safe choice',
            qty !== null ? `Quantity read as ${qty}` : 'No explicit quantity found'
          ]
        });
      });
    });
    return updates;
  }

  /* ==========================================================================
     7. IMPACT MODEL
     --------------------------------------------------------------------------
     A six-month, month-by-month simulation. Every lever is a stated assumption
     the user can move with a slider. Nothing is hidden.

     Flow:  levers -> cancellation mechanics -> active-base retention -> money
     ========================================================================== */
  const DEFAULTS = {
    hideEffect: 0.45,      // share of truth-driven bad orders prevented before payment
    swapEffect: 0.30,      // share converted into a completed substitute order
    rerouteEffect: 0.55,   // share of post-order stockouts rescued by re-route
    etaEffect: 0.30,       // share of delay-driven cancellations removed
    ticketEffect: 0.28,    // support ticket reduction
    // Deliberately conservative. 61% of churners had rated us 4*+, which says the
    // churn is caused by broken promises rather than by product-market fit. Removing
    // roughly half of broken first-experiences is modelled as a 1.6pp retention lift,
    // i.e. monthly churn falls from 7.4% to 5.8% (-22% relative) — not a heroic claim.
    retentionLift: 1.6,    // percentage points added to monthly active-orderer retention
    localAdvantageLift: 0.9, // % lift in orders per active user from cross-category discovery
    promoReallocation: 0.25  // share of promo budget moved from broad discount to reliability
  };

  const BUDGET = [
    { item: 'Build & integrate Promise Engine (3-person squad, 6 months)', amount: 1200000, kind: 'one-time' },
    { item: 'Store onboarding kit & pulse training (620 stores x ₹200)', amount: 124000, kind: 'one-time' },
    { item: 'Store reliability incentive pool (top-300 performers)', amount: 400000, kind: 'recurring' },
    { item: 'Messaging & notification infrastructure (WhatsApp / SMS / push)', amount: 150000, kind: 'recurring' },
    { item: 'Unified support & refund-status tooling', amount: 250000, kind: 'one-time' },
    { item: 'Measurement, analytics & experiment instrumentation', amount: 150000, kind: 'one-time' },
    { item: 'Contingency (10%)', amount: 226000, kind: 'one-time' }
  ];

  function impactModel(cfg = {}) {
    const C = { ...DEFAULTS, ...cfg };
    const B = N.BRIEF;
    const D = N.DERIVED;

    const AOV = B.aov.now;
    const TAKE_PER_ORDER = round(B.revenue.now / B.monthlyOrders.now, 2);   // ₹ earned per order placed
    // Blended unit costs. These are the four ways an order that fails still costs money.
    const TICKET_COST = 75;        // ₹ to handle one support ticket end to end
    const DELIVERY_LEG = 40;       // ₹ of rider capacity burned on an order that never delivers
    const REFUND_PROCESSING = 25;  // ₹ of payment-gateway + ops effort per refund
    // Only ~half of promo spend is order-attached discount (the rest is social,
    // influencer and referral spend that is not recoverable by fixing reliability),
    // so we only claim back the order-attached half.
    const PROMO_PER_ORDER = round(D.promoPerOrder.now * 0.5, 0);
    const MONTHS = 6;

    // ---- baseline month (constant, the "do nothing" world) ----
    const basePlaced = B.monthlyOrders.now;
    const baseCancel = Math.round(basePlaced * B.cancelRate.now / 100);
    const baseCompleted = basePlaced - baseCancel;
    const baseTickets = B.supportTickets.now;
    const basePromo = B.promoSpend.now;
    const baseRevenue = B.revenue.now;
    const baseActive = B.mau.now;
    const    baseOrdersPerActive = D.ordersPerMau.now;
    // Fit the retention rate that reproduces the observed MAU trajectory exactly.
    // 46,000 = 46,000 x r + (6,333 new registrations x 54% activation)  ->  r = 92.57%
    const newFirstOrders = D.newUsersPerMonth * (N.BEHAVIOUR.firstOrderCompletion / 100);
    const baseRetention = (baseActive - newFirstOrders) / baseActive;

    // baseline cancellation split
    const truthCancels = baseCancel * (D.cancelsFromTruth / 100);
    const delayCancels = baseCancel * (D.cancelsFromDelay / 100);
    const otherCancels = baseCancel - truthCancels - delayCancels;

    const rows = [];
    let cumRevenueDelta = 0, cumCostAvoided = 0, cumGmvDelta = 0, cumTicketsSaved = 0;

    for (let m = 1; m <= MONTHS; m++) {
      /* --- 1. cancellation mechanics ------------------------------------- */
      const prevented = truthCancels * C.hideEffect;                  // never placed -> no bad experience
      const swapped = truthCancels * C.swapEffect;                    // converted into a completed substitute
      const truthLeft = truthCancels - prevented - swapped;
      const delayLeft = delayCancels * (1 - C.etaEffect);
      const otherLeft = otherCancels * (1 - C.rerouteEffect * 0.45);
      const cancels = truthLeft + delayLeft + otherLeft;

      const placedBase = basePlaced - prevented;      // bad orders we never let happen
      const completedBase = placedBase - cancels;

      /* --- 2. active-base retention -------------------------------------- */
      const retention = Math.min(0.995, baseRetention + C.retentionLift / 100);
      const ordersPerActive = baseOrdersPerActive * (1 + C.localAdvantageLift / 100);

      // Replay the 6-month window: a more reliable platform keeps more of its base.
      let active = baseActive;
      for (let k = 1; k <= m; k++) active = active * retention + newFirstOrders;
      const extraActive = active - baseActive;

      // Retained cohorts order like everyone else, and they do not cancel
      // abnormally — they are simply still here.
      const extraOrders = Math.max(0, extraActive * ordersPerActive);
      const orders = placedBase + extraOrders;
      const completedTotal = completedBase + extraOrders;
      const cancelRate = orders > 0 ? (cancels / orders) * 100 : 0;
      const cancelsRemoved = Math.max(0, baseCancel - cancels);

      /* --- 3. money ------------------------------------------------------ */
      const gmv = completedTotal * AOV;
      const revenue = orders * TAKE_PER_ORDER;
      const promo = basePromo * (1 - C.promoReallocation * 0.12);       // reallocated, not deleted
      const tickets = Math.round(baseTickets * (1 - C.ticketEffect) * (orders / basePlaced));
      const ticketsSaved = baseTickets - tickets;

      // Four independent cost streams stop bleeding once orders stop failing.
      const costAvoided = Math.round(
        ticketsSaved * TICKET_COST +
        cancelsRemoved * DELIVERY_LEG +
        cancelsRemoved * REFUND_PROCESSING +
        cancelsRemoved * PROMO_PER_ORDER
      );
      const costBreakdown = {
        support: ticketsSaved * TICKET_COST,
        riderCapacity: cancelsRemoved * DELIVERY_LEG,
        refundProcessing: cancelsRemoved * REFUND_PROCESSING,
        promoSubsidy: cancelsRemoved * PROMO_PER_ORDER
      };

      const revenueDelta = revenue - baseRevenue;
      const gmvDelta = gmv - baseCompleted * AOV;

      cumRevenueDelta += revenueDelta;
      cumCostAvoided += costAvoided;
      cumGmvDelta += gmvDelta;
      cumTicketsSaved += ticketsSaved;

      rows.push({
        month: m,
        placed: Math.round(orders),
        completed: Math.round(completedTotal),
        cancels: Math.round(cancels),
        cancelRate: round(cancelRate, 1),
        active: Math.round(active),
        tickets,
        ticketsSaved,
        gmv: Math.round(gmv),
        revenue: Math.round(revenue),
        revenueDelta: Math.round(revenueDelta),
        promo: Math.round(promo),
        aov: AOV,
        costAvoided: Math.round(costAvoided),
        costBreakdown,
        extraActive: Math.round(extraActive),
        truthCancelsPrevented: Math.round(prevented),
        linesSwapped: Math.round(swapped),
        cancelsRemoved: Math.round(cancelsRemoved),
        wastedLegsSaved: Math.round(cancelsRemoved * DELIVERY_LEG)
      });
    }

    const last = rows[rows.length - 1];
    const totalSpend = BUDGET.reduce((s, b) => s + b.amount, 0);
    const totalBenefit = cumRevenueDelta + cumCostAvoided;
    const runRateBenefit = last.revenueDelta * 12 + last.costAvoided * 12;

    // Promo efficiency: 44% of coupons are never redeemed, so a slice of the
    // ₹17L/month promotional budget is buying nothing. Reallocation value is the
    // portion we move from broad discount depth into reliability-linked retention.
    const promoReallocated = basePromo * C.promoReallocation * 6;
    const promoWastedMonthly = basePromo * (N.BEHAVIOUR.couponWaste / 100);

    return {
      config: C,
      rows,
      assumptions: {
        AOV, TAKE_PER_ORDER, TICKET_COST, DELIVERY_LEG, REFUND_PROCESSING, PROMO_PER_ORDER,
        baselineRetention: round(baseRetention * 100, 2),
        baselineCancelSplit: {
          truth: Math.round(truthCancels), delay: Math.round(delayCancels), other: Math.round(otherCancels)
        },
        newFirstOrders,
        baseOrdersPerActive
      },
      budget: BUDGET,
      totals: {
        spend: totalSpend,
        budget: B.budget,
        withinBudget: totalSpend <= B.budget,
        revenueDelta: Math.round(cumRevenueDelta),
        costAvoided: Math.round(cumCostAvoided),
        gmvDelta: Math.round(cumGmvDelta),
        ticketsSaved: Math.round(cumTicketsSaved),
        benefit: Math.round(totalBenefit),
        roiMultiple: round(totalBenefit / totalSpend, 2),
        paybackMonth: (() => {
          let cum = 0;
          for (const r of rows) { cum += r.revenueDelta + r.costAvoided; if (cum >= totalSpend) return r.month; }
          return null;
        })(),
        runRateAnnualBenefit: Math.round(runRateBenefit),
        month6CancelRate: last.cancelRate,
        month6Tickets: last.tickets,
        month6Active: last.active,
        month6RevenueDelta: last.revenueDelta,
        month6CostAvoided: last.costAvoided,
        promoReallocated,
        promoWastedMonthly,
        cancelsRemovedMonth6: last.cancelsRemoved,
        oneTimeSpend: BUDGET.filter((b) => b.kind === 'one-time').reduce((s, b) => s + b.amount, 0),
        recurringSpend: BUDGET.filter((b) => b.kind === 'recurring').reduce((s, b) => s + b.amount, 0)
      },
      /* The honest way to judge an infrastructure build: what does it cost to KEEP
         running once it is built, versus what it returns every month forever. */
      steadyState: {
        monthlyBenefit: last.revenueDelta + last.costAvoided,
        monthlyOngoingCost: 400000 / 6 + 150000 / 6,
        coverage: round((last.revenueDelta + last.costAvoided) / (400000 / 6 + 150000 / 6), 1),
        annualBenefit: Math.round(runRateBenefit),
        oneTimeBuild: BUDGET.filter((b) => b.kind === 'one-time').reduce((s, b) => s + b.amount, 0)
      }
    };
  }

  /* ==========================================================================
     8. LOCATION AWARENESS
     --------------------------------------------------------------------------
     A delivery location is not a label, it is a centre point. Everything the
     customer sees — which shops exist for them, how far they are, which one the
     Promise Engine would re-route to — is computed from it with real distance.
     ========================================================================== */
  const DEFAULT_RADIUS_KM = 4;

  function nearbyStores(location, opts = {}) {
    const radius = opts.radiusKm ?? DEFAULT_RADIUS_KM;
    const rows = N.STORES.map((s) => {
      const km = haversineKm(location, s);
      const loc = N.storeLocation(s);
      return { store: s, km, location: loc, inArea: loc.id === location.id, withinRadius: km <= radius };
    });
    let out = opts.all ? rows : rows.filter((r) => r.withinRadius);
    out.sort((a, b) => a.km - b.km);

    // Rank the way a customer actually shops: trust first, then closeness.
    // A 2 km shop whose catalogue is a day old is a worse bet than a 3 km one
    // that keeps its stock honest.
    if (opts.rank !== 'distance') {
      const score = (r) => (r.store.fulfilmentScore / 100) * 1.4 - Math.min(r.km / radius, 1) * 0.9;
      out = out.slice().sort((a, b) => score(b) - score(a) || a.km - b.km);
    }
    return out;
  }

  function nearestStores(location, n = 3) {
    return nearbyStores(location, { rank: 'distance' }).slice(0, n);
  }

  /* Catalogue health for every store serving a location — powers the store list. */
  function storeHealth(store) {
    let total = 0, verified = 0, phantom = 0;
    store.cats.forEach((c) => N.PRODUCTS.filter((p) => p.category === c).forEach((p) => {
      const rec = N.INVENTORY[`${store.id}:${p.id}`];
      if (!rec) return;
      total++;
      const c2 = availabilityConfidence(store, p);
      if (c2.score >= 0.6) verified++;
      if (rec.reported === 'in' && rec.truth === 'out') phantom++;
    }));
    return {
      total, verified, phantom,
      freshness: total ? verified / total : 0,
      etaMinutes: store.prepMinutes + 14 + Math.round((store.openOrders / store.capacity) * 8)
    };
  }

  function deliveryEstimate(location, store) {
    const km = haversineKm(location, store);
    return { km, minutes: Math.round(km / 0.35) + store.prepMinutes + 6 };
  }

  /* -------------------------------------------------------------- exports -- */
  global.ENGINE = {
    availabilityConfidence, orderRisk, forecastDemand, reorderPoint,
    findSubstitutes, autoReroute, parseStockMessage, impactModel,
    nearbyStores, nearestStores, storeHealth, deliveryEstimate,
    RISK_WEIGHTS, DEFAULTS, BUDGET, formatAge, matchProducts, DEFAULT_RADIUS_KM
  };
})(window);
