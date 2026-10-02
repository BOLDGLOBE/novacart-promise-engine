# NOVA CART — Promise Engine

**PromptWars Business Rescue Challenge · Submission**

> *Make every promise the app makes one the store can actually keep.*

---

## 0. What this is

NOVA CART is the fictional quick-commerce platform from the challenge brief. On the surface it looks
healthy — registered users up 46%, revenue up 20%. But repeat purchase rate has collapsed from 41%
to **27%**, cancellations have nearly doubled to **11%**, and support tickets have almost doubled to
**5,900/month**.

We asked one question: **what is actually breaking?** This repository contains the diagnosis, the
reasoning behind it, and a working prototype that addresses it.

---

## 1. Run it

OPEN THE URL-https://boldglobe.github.io/novacart-promise-engine/index.html

No build step, no dependencies, no API keys.

```bash
# option A — just open it
open index.html          # or double-click it

# option B — serve it (recommended, avoids any file:// quirks)
python3 -m http.server 8080
# then visit http://localhost:8080
```

| Page | What it is |
|---|---|
| `index.html` | **Problem diagnosis** — the evidence, the ratios, the root cause |
| `app.html` | **The working prototype** — three roles on one live dataset |
| `stores.html` | **Local stores near you** — every partner serving your PIN code |
| `auth.html` | **Sign in / create account** — with delivery location |
| `impact.html` | **Business impact** — 6-month model with every assumption as a slider |
| `docs/README.html` | Submission checklist mapped to the seven required deliverables |

Nothing is mocked up for the demo. Every confidence score, risk score and re-route decision is
computed live by `assets/js/engine.js` from the inventory rows in `assets/js/data.js`.

### Accounts & delivery location

The prototype behaves like a real commerce app: you create an account once, and it stays signed in
across every page and reloads.

- **Sign up** with name, gender, email, optional mobile, a delivery PIN code and a password.
- **State is derived from the PIN code**, never typed by hand, so it can never contradict your
  address. Enter `560102` and the form tells you it is HSR Layout, Bengaluru, Karnataka before you
  commit.
- **Your location drives the whole site.** The store list shows only partners inside your delivery
  radius, sorted by how much we can trust their stock rather than by raw distance — a 3 km shop
  with a fresh catalogue beats a 300 m shop that has not updated in two days.
- **"Shop here" hands off to the prototype** with that store preselected, and the customer view's
  *Change store* dialog is scoped to your area, because a store outside your radius cannot deliver
  to you.
- The **nav location chip** is clickable on every page and switches delivery location instantly.

15 serviceable areas across Karnataka, Maharashtra and Telangana, with real PIN codes and real
coordinates, so all distances are genuine haversine calculations rather than a city filter.

> **Security note, stated plainly.** This is a front-end prototype with no backend. Accounts live in
> `localStorage` and passwords are salted and SHA-256 hashed (verified: no plaintext ever reaches
> storage), but local-only storage is *not* real authentication — anyone with access to the browser
> can read or tamper with it. Before production this must move to a server with a real identity
> provider, server-side sessions and rate limiting. Never put a real password in it.

### Suggested 4-minute demo walkthrough

1. **auth.html (45s).** Create an account — name, gender, PIN code. Show that the state is derived
   from the PIN (type `560102` and it tells you it is HSR Layout, Bengaluru, Karnataka).
2. **stores.html (45s).** Show the local store list generated from that PIN. Drag the delivery
   radius from 1.5 km to 12 km and watch the count move. Point out that ranking is by trust, not
   distance. Press "Shop here" on the top store.
3. **index.html (45s).** Scroll to *Six ratios that expose the real problem*. Land on the flat
   revenue-per-active-user figure and the 65% promo-to-revenue ratio. Then jump to the 61%
   statistic in the root-cause section.
4. **app.html → Customer app (60s).** Add four items. One arrives unconfirmed — accept the Smart
   Swap at the basket. Note the honest ETA is a *range* with a confidence, not a flat promise.
5. **Place the order, then press "Simulate stock-out" (60s).** Watch the engine search the network,
   re-route the line to a nearby store, and notify the customer proactively. Order protected,
   ₹413 basket preserved, zero support tickets.
6. **app.html → Partner store (45s).** Run the 30-second pulse — twelve taps. Or paste
   `no milk, 3 paneer left, maggi khatam` into Zero-Typing and apply it.
7. **Back to Customer app (30s).** Press *Reveal ground truth*. The items you just confirmed now
   show higher confidence, and the confirmed-out item is no longer advertised. Same rows, two views.
8. **impact.html (30s).** Drag the retention lever to zero, then to four. Point out the break-even
   calculation and the "all to zero" proof that no baseline gain is baked in.

---

## 2. Problem diagnosis

### 2.1 Absolute numbers flatter NOVA CART. Ratios do not.

All of these are derived from the brief alone — no external assumptions.

| Ratio | 6 months ago | Now | Change |
|---|---|---|---|
| Revenue per ₹1 of promo spend | ₹2.29 | ₹1.54 | **−33%** |
| Revenue per monthly active user | ₹55.9 | ₹56.7 | **flat** |
| Activation rate (MAU ÷ registered) | 47.6% | 38.3% | **−9.3 pp** |
| Support tickets per 100 orders | 9.9 | 15.3 | **+55%** |
| Marketplace take rate | 15.5% | 13.9% | **−1.6 pp** |
| Promo spend as a share of revenue | 43.6% | 65.1% | **+21.5 pp** |

**The single most damning number:** revenue per monthly active user is flat. NOVA CART added
38,000 registered users and 7,000 monthly actives, and each active user is worth exactly what they
were worth before. Every rupee of the extra ₹7.5 lakh monthly promotional spend bought *volume*,
not *value*.

### 2.2 The funnel is not leaking at the top

| Stage | Per month |
|---|---|
| New registrations | 6,333 |
| Place a first order (54%) | 3,420 |
| Place a second order in 30 days (31%) | 1,060 |
| Reach the loyal tier, 3+ orders (~58%) | ~615 |

About **5,718 of every 6,333 registrations never become loyal customers.** Registration growth is
the one thing money reliably buys. Everything after it depends on whether the promise held.

### 2.3 Where the damage happens

38% of orders do not land cleanly. Of the 11% that cancel:

- **35%** — product unavailable
- **18%** — store rejected the order
- **27%** — customer cancelled because of a delay

Read together: **53% of all cancellations trace back to a stock promise the store could not keep.**

### 2.4 Root cause

The app promises things the store cannot deliver.

> A store that has not touched its catalogue for two or three days cannot respond to demand, so
> fast-moving items genuinely run out — but its catalogue still says "available", because nobody
> told it otherwise.

The mechanism, end to end:

1. **Store is busy.** Updating an online catalogue earns a shop owner nothing, so stock goes stale.
2. **App keeps selling.** Customers order items that are already gone.
3. **Order fails.** 53% of cancellations are exactly this.
4. **Whole basket dies.** One missing line cancels the entire ₹486 order, plus a refund.
5. **Trust breaks.** The customer blames the platform, not the shop. Support ticket. Then churn.

### 2.5 The two pieces of evidence that settle it

**61% of customers who stopped ordering had previously rated NOVA CART 4★ or higher.**
This is the most important number in the brief. Customers do not churn because they dislike the
app — they churn because the app broke a promise. A discount cannot repair a broken promise; it
only buys another disappointed person. This is why acquisition spend is producing flat revenue per
user.

**Customers who complete three orders have a 72% probability of ordering again the following month.**
Retention is not a slow curve — it is a threshold. Survive the first three orders and the customer
is loyal. Fail during them and they are gone. The fight is won or lost in exactly the window where
stock errors do the most damage.

### 2.6 Why this problem and not another

We scored each of the six management positions against four tests: does the evidence support it, is
it upstream of the other symptoms, can it be fixed inside ₹25 lakh with no warehouses and no mass
hiring, and does it compound?

| Position | Verdict |
|---|---|
| **Partner Manager** — "inventory accuracy and store experience are the real bottlenecks" | **Chosen.** Both sides name it. Largest single cancellation driver. Fixable without capex. |
| Finance Head — "quality and cost of growth" | Confirmed by the ratios. |
| CEO — "improve retention" | Correct — and it is the symptom we target. |
| Operations Head — "delivery reliability" | True, but 27% of cancellations are delay-driven and much of that delay is caused by stock problems discovered mid-pick. Partly upstream. |
| Product Head — "give customers a reason to choose local" | Right instinct. Kept as a second-order feature — trust must exist before differentiation can matter. |
| Marketing Head — "more acquisition, better promotions" | Rejected. This is the current strategy, and it is producing a 27% repeat rate on 79% more spend. |

---

## 3. Prompt journey

The prompts below are the ones that actually changed the outcome. We are not submitting every
conversation — these are the pivot points, with what each one corrected.

**P1 — Establishing the frame**
> "Here is the full NOVA CART brief. Before proposing any solution: compute the ratios the brief
> implies but does not state. Which number is most alarming and why?"

*What it changed:* produced the flat revenue-per-active-user finding and the promo-to-revenue ratio.
Without this, the obvious story is "growth is slowing". The real story is "growth quality collapsed".

**P2 — Stress-testing the obvious answer**
> "The instinct is to say delivery speed. Argue against that using only the cancellation reasons.
> Is delay a cause or a symptom?"

*What it changed:* revealed that a large share of "delay" is itself caused by stock problems
discovered mid-pick. This moved delay from a root cause to a downstream symptom, and promoted
inventory truth to the top.

**P3 — Finding the contradiction**
> "39% of stores say inventory upkeep is too much effort, and 29% of customers say items shown as
> available are not. Are these two complaints or one? Show the mechanism connecting them."

*What it changed:* merged the store-side and customer-side evidence into a single causal chain.
This is the moment the problem became *one* problem rather than two.

**P4 — The counter-argument we had to survive**
> "Strongest case against building inventory tooling: stores are independent businesses, they will
> not adopt it, and NOVA CART cannot force them. How does the solution fail and what would we
> build instead?"

*What it changed:* produced the 30-second pulse design. The first version asked stores to maintain
a catalogue with better UX — which fails for the same reason. The redesign asks for roughly twelve
taps on items the system has already prioritised, delivered over WhatsApp.

**P5 — Calibrating the business case honestly**
> "Build the 6-month impact model. Then argue the retention lift is overstated. What is the
> smallest retention improvement that still justifies ₹25 lakh, and what evidence in the brief
> supports it?"

*What it changed:* set the default retention lift at +1.6pp (monthly churn 7.4% → 5.8%) rather than
an optimistic number, added the break-even calculation to the impact page, and made every lever a
slider so a judge can attack the assumption directly.

**P6 — Refusing the wrong product**
> "Should the customer app hide every item below 60% confidence?"

*What it changed:* no. Only 35% of flagged items are genuinely out of stock, so hiding them all
would delete real orders. The correct behaviour is: verify with the store, show a caution badge,
and offer a swap before payment. Hide is reserved for items that are confirmed out.

---

## 4. The solution

**Promise Engine** — one system, three users, one shared dataset.

### For the partner store — remove the effort

- **30-Second Pulse.** The engine ranks the catalogue by revenue exposure (city demand ×
  uncertainty) and surfaces only the ~12 items that matter today. The owner taps In / Low / Out.
  Everything else is left alone. This removes roughly 80% of the work the 39% complained about.
- **Demand Radar.** Per-SKU, per-day forecast addressing the 28% who cannot predict what sells.
- **Zero-Typing Update.** `no milk, 3 paneer left, atta khatam` parses into structured stock
  updates, including Hindi/English mixed phrasing. Delivered over WhatsApp, which they already have.
- **Reliability incentive.** Store score drives a payout from the ₹4L pool, so accuracy earns money.

### For the customer — never break a promise

- **Availability confidence on every item**, with its age. High-confidence items are marked
  confirmed; shaky ones carry a caution. Nothing is silently hidden.
- **Smart Swap before payment.** An unconfirmed line gets a same-store substitute offer at the cart.
  This converts a future cancellation into a completed order.
- **Honest ETA.** A range with a stated confidence, derived from the store's actual reliability and
  current load — not a flat promise.
- **Auto-reroute after payment.** If an item fails post-order, the engine searches nearby stores on
  confidence, distance, fulfilment score and load, then re-routes instead of cancelling.

### For operations — act before the order fails

- **Live order risk queue.** Every order scored by a logistic model over eight signals, each with a
  visible contribution and the reasoning behind it.
- **Store health network.** Partners ranked by how much promise-risk they create, turning partner
  management into a targeted worklist instead of a blanket email to 620 stores.
- **Support deflection.** Refund-status and missing-item tickets stop being created, because the
  events that cause them stop happening.

### What makes it a *functional* prototype

Input → processing → action, on real data:

| Input | Processing | Action |
|---|---|---|
| 67-store sample network, 1,711 inventory rows, 61 SKUs | Availability-confidence model | Per-item badges, auto-pause of confirmed-out items |
| Store pulse tap or free-text message | Demand forecast + parser | Catalogue updated; customer view changes instantly |
| Basket contents | Substitution matcher | Same-store swap offers before payment |
| Order + store + time + load | Logistic risk model | Ranked intervention queue |
| Stock-out event | Haversine re-route optimiser | Re-route / offer choice / proactive partial refund |

**The demo moment that proves it:** run a 30-second pulse in the *Partner store* tab, then switch
to *Customer app* and press *Reveal ground truth*. The confidence scores you just repaired are the
same rows the customer is reading.

### Accuracy of the model

Measured against the simulated ground truth across the whole network:

- **99.0%** of items we mark high-confidence were genuinely available
- **35.5%** of flagged items were genuinely out of stock

That second number is why we do not hide flagged items. The model is a *prioritisation* signal for
verification, not an oracle — which is exactly why the product asks the store to confirm rather
than silently delisting.

---

## 5. Business impact

Full model with live sliders: `impact.html`.

| Metric | Result |
|---|---|
| Budget used | **₹25.0L** of the ₹25L ceiling |
| 6-month benefit | **₹22.6L** (revenue gained + cost avoided) |
| Month-6 run rate | **₹4.51L/month** → ₹54.1L annualised |
| Ongoing cost | ₹0.92L/month → **4.9× coverage** |
| One-time build | ₹19.5L of the ₹25L |
| Cancellation rate | 11% → **4.9%** |
| Support tickets | 5,900 → **4,494/month** |
| Monthly active orderers | 46,000 → **49,820** by month 6 |

### Where the benefit comes from

Four of the five streams are **cost avoidance**, not new revenue. That is the point — NOVA CART is
already spending this money, badly.

| Stream | 6 months |
|---|---|
| Support tickets avoided | ₹6.95L |
| Rider capacity not wasted on cancelled orders | ₹5.37L |
| Refund processing avoided | ₹3.35L |
| Promo subsidy not burned on cancelled orders | ₹2.95L |
| Revenue from retained users | ₹3.95L |
| **Total** | **₹22.58L** |

### The honest part

**The retention lift is the biggest assumption and it is modelled, not measured.** The +1.6pp
default is inferred from the brief's own finding that 61% of churners had rated us 4★+ — evidence
that much churn is caused by broken promises rather than poor product fit. It is an inference, and
it is the first thing on the page you should attack.

So the impact page exposes it:

- Every lever is a slider; drag it and everything recomputes.
- **"All to zero"** shows a ₹25L cost with no return — there is no hidden baseline gain.
- The page computes and displays the **break-even retention lift** under your current settings
  (**+2.2pp** at the defaults — still well inside what the 61% evidence supports, and the levers
  make that sensitivity visible rather than hidden).
- Month-1 revenue is deliberately **negative**, because we stop bad orders from being placed.
 Those orders were going to cancel and generate ₹0 anyway, but the honest curve starts below the line.

### Budget allocation

| Item | Amount | Type |
|---|---|---|
| Build & integrate Promise Engine (3-person squad, 6 months) | ₹12,00,000 | one-time |
| Store onboarding kit & pulse training (620 × ₹200) | ₹1,24,000 | one-time |
| Unified support & refund-status tooling | ₹2,50,000 | one-time |
| Measurement, analytics & experimentation | ₹1,50,000 | one-time |
| Contingency (10%) | ₹2,26,000 | one-time |
| Store reliability incentive pool (top 300) | ₹4,00,000 | recurring |
| Messaging & notification infrastructure | ₹1,50,000 | recurring |
| **Total** | **₹25,00,000** | within ceiling |

Headcount added: **0**. Warehouses: **0**. Discount depth: **reduced, not increased**.

Note what dominates: ₹12L is the build itself, and ongoing cost is only ₹0.92L/month — about
**5.4%** of current promotional spend. We are not asking for a bigger budget; we are asking to spend
a sliver of the existing one differently.

---

## 6. Risks we would manage

| Risk | Severity | Mitigation |
|---|---|---|
| Stores do not adopt the pulse | High | Ship on WhatsApp. Cap the ask at 12 taps. Pay for accuracy from the ₹4L pool. Track per-store pulse rate from week 1. |
| Hiding unconfirmed items reduces volume | Medium | Only act below a 40% confidence floor, always offer a swap first. Month 1 already models this dip. |
| Re-route adds delivery cost | Medium | Auto-re-route only within 5 km and ≤18 added minutes; beyond that offer the customer a choice with a credit. |
| Customers distrust a visible confidence score | Low | A/B a numeric score against a simple "confirmed / unconfirmed" label. |
| Retention lift does not materialise | Medium | Run the first-3-orders cohort as a controlled experiment from week one. Reliability work still pays for itself through cost avoidance alone. |

---

## 7. Technology choices

Plain HTML, CSS and JavaScript. No framework, no build step, no API keys, no backend.

This was a deliberate constraint, not a limitation. The brief says paid API keys and custom ML are
*not mandatory*, and that technology should serve the problem. Every model here is deterministic,
explainable and auditable — a judge can open `engine.js` and read the formula that produced any
number on screen. A black-box model would have been weaker, not stronger.

The one place we reached beyond the brief was the Indian numbering and currency formatting, and a
haversine implementation for real distance maths in the re-route optimiser. Both are a few lines.

---

## 8. File map

```
novacart/
├── index.html              Problem diagnosis
├── app.html                The prototype (3 roles)
├── stores.html             Local stores near your delivery location
├── auth.html               Sign in / create account
├── impact.html             Business impact simulator
├── README.md               This file
├── docs/
│   └── README.html         Submission checklist
└── assets/
    ├── css/app.css         Design system
    └── js/
        ├── data.js         Brief + 620-store network sample + inventory generator + locations
        ├── engine.js       The models (confidence, risk, forecast, swap, reroute, parser, impact, location)
        ├── ui.js           View helpers, charts, modal, drawer
        ├── auth.js         Accounts, persistent session, delivery location
        ├── customer.js     Customer app
        ├── store.js        Partner store app
        └── ops.js          Ops control tower
```

---

*NOVA CART is a fictional company. All figures derive from the PromptWars Business Rescue
Challenge brief.*
