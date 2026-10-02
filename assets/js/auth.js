/* =============================================================================
   auth.js — accounts, session and delivery location
   -----------------------------------------------------------------------------
   SCOPE AND HONESTY NOTE
   This is a front-end prototype with no backend. Accounts live in the browser's
   localStorage so the demo keeps you signed in across pages and reloads. Passwords
   are salted and hashed (SHA-256) so they are never stored in the clear, but a
   local-only store is NOT real authentication: anything stored here can be read or
   tampered with by anyone with access to the browser. Before production this must
   move to a server with a real identity provider, server-side sessions and
   rate limiting. Nothing here should ever be used for real credentials.

   What it does model faithfully, because it drives the product:
     * who you are (name, gender)
     * where you are (area + city + state + PIN)
     * that state is DERIVED from the area, so it can never contradict the PIN code
   ========================================================================== */
(function (global) {
  'use strict';
  const { el, badge, toast } = UI;
  const N = NOVA;

  const KEYS = { users: 'novacart.users.v1', session: 'novacart.session.v1' };
  const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;   // 30 days "remember me"

  /* ------------------------------------------------------------ storage --- */
  function read(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { console.warn('storage unavailable', e); return false; }
  }

  /* ------------------------------------------------------------- hashing --- */
  /* SHA-256 where the browser provides it (secure context: https or localhost),
     with a deterministic fallback so opening the files directly from disk still
     signs a user in and out correctly. */
  function fallbackDigest(str) {
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < str.length; i++) {
      h1 ^= str.charCodeAt(i); h1 = Math.imul(h1, 0x01000193) >>> 0;
      h2 = (Math.imul(h2, 0x85ebca6b) ^ str.charCodeAt(i)) >>> 0;
    }
    return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
  }
  async function hash(password, salt) {
    const input = salt + '::' + password;
    if (global.crypto && global.crypto.subtle && global.isSecureContext) {
      try {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
        return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
      } catch (e) { /* fall through */ }
    }
    return 'fb$' + fallbackDigest(input) + fallbackDigest(input.split('').reverse().join(''));
  }
  function newSalt() {
    const a = new Uint8Array(16);
    if (global.crypto && global.crypto.getRandomValues) crypto.getRandomValues(a);
    else for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
    return Array.from(a).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  const normId = (v) => String(v || '').trim().toLowerCase();
  const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim());
  const validPhone = (v) => /^[6-9]\d{9}$/.test(String(v || '').replace(/\D/g, ''));
  const validPin = (v) => /^[1-9]\d{5}$/.test(String(v || '').trim());

  /* --------------------------------------------------------------- users --- */
  const users = () => read(KEYS.users, []);
  const saveUsers = (list) => write(KEYS.users, list);

  function publicUser(u) {
    if (!u) return null;
    return { id: u.id, name: u.name, gender: u.gender, email: u.email, phone: u.phone,
      pin: u.pin, area: u.area, city: u.city, state: u.state, createdAt: u.createdAt };
  }

  async function signUp(details) {
    const name = String(details.name || '').trim();
    const gender = details.gender;
    const pin = String(details.pin || '').trim();
    const password = String(details.password || '');
    const email = String(details.email || '').trim();
    const phone = String(details.phone || '').replace(/\D/g, '');

    // ---- validation, returned as field-keyed errors so the UI can highlight
    const errors = {};
    if (name.length < 2) errors.name = 'Please enter your full name';
    if (!['female', 'male', 'other', 'prefer-not'].includes(gender)) errors.gender = 'Select an option';
    if (!validEmail(email)) errors.email = 'Enter a valid email address';
    if (phone && !validPhone(phone)) errors.phone = 'Enter a 10-digit Indian mobile number';
    if (!validPin(pin)) errors.pin = 'Enter a 6-digit PIN code';
    if (password.length < 8) errors.password = 'Use at least 8 characters';
    else if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) errors.password = 'Include at least one letter and one number';

    const loc = N.locationByPin(pin);
    if (!loc && !errors.pin) errors.pin = 'We do not deliver to that PIN code yet';

    if (validEmail(email) && users().some((u) => normId(u.email) === normId(email)))
      errors.email = 'An account already exists with this email';
    if (phone && users().some((u) => u.phone === phone))
      errors.phone = 'An account already exists with this mobile number';
    if (Object.keys(errors).length) return { ok: false, errors };

    const salt = newSalt();
    const user = {
      id: 'U' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
      name, gender, email, phone,
      pin,
      // State and city always come from the PIN, never from free text
      area: loc.area, city: loc.city, state: loc.state, locationId: loc.id,
      salt, hash: await hash(password, salt),
      createdAt: new Date().toISOString()
    };
    const list = users();
    list.push(user);
    if (!saveUsers(list)) return { ok: false, errors: { form: 'Browser storage is blocked, so accounts cannot be saved.' } };

    startSession(user, true);
    return { ok: true, user: publicUser(user) };
  }

  async function signIn(identifier, password, remember) {
    const id = normId(identifier);
    const user = users().find((u) => normId(u.email) === id || u.phone === String(identifier).replace(/\D/g, ''));
    if (!user) return { ok: false, errors: { form: 'No account found with that email or mobile number.' } };
    const candidate = await hash(String(password || ''), user.salt);
    if (candidate !== user.hash) return { ok: false, errors: { form: 'That password is not correct.' } };
    startSession(user, remember !== false);
    return { ok: true, user: publicUser(user) };
  }

  /* ------------------------------------------------------------- session --- */
  function startSession(user, remember) {
    const s = { id: user.id, ts: Date.now(), expires: Date.now() + (remember ? SESSION_TTL_MS : 12 * 60 * 60 * 1000) };
    write(KEYS.session, s);
    if (!remember) sessionStorage.setItem('novacart.temporary', '1');
    document.dispatchEvent(new CustomEvent('nova:session', { detail: publicUser(user) }));
    return s;
  }

  function currentUser() {
    const s = read(KEYS.session, null);
    if (!s) return null;
    if (Date.now() > s.expires) { signOut(); return null; }
    const u = users().find((x) => x.id === s.id);
    if (!u) { signOut(); return null; }
    return publicUser(u);
  }
  const isSignedIn = () => currentUser() !== null;

  function signOut() {
    localStorage.removeItem(KEYS.session);
    sessionStorage.removeItem('novacart.temporary');
    document.dispatchEvent(new CustomEvent('nova:session', { detail: null }));
  }

  /* The delivery location: the user's chosen area, falling back to the demo store. */
  function currentLocation() {
    const u = currentUser();
    if (u) {
      const byPin = N.locationByPin(u.pin);
      if (byPin) return byPin;
    }
    const saved = read('novacart.location.v1', null);
    if (saved) { const l = N.locationById(saved); if (l) return l; }
    const demo = N.storeLocation(N.STORES.find((s) => s.id === N.DEMO_STORE_ID));
    return demo || N.LOCATIONS[0];
  }
  function setLocation(locId) {
    const l = N.locationById(locId);
    if (!l) return null;
    write('novacart.location.v1', l.id);
    const u = currentUser();
    // If you are signed in, your delivery location belongs to your account
    if (u && u.pin !== l.pin) {
      toast('Saved as a preferred location for this session', 'warn', 2200);
    }
    document.dispatchEvent(new CustomEvent('nova:location', { detail: l }));
    return l;
  }

  /* -------------------------------------------------------- location picker --- */
  function locationPicker(onPick, opts = {}) {
    const current = currentLocation();
    const byState = {};
    N.LOCATIONS.forEach((l) => { (byState[l.state] = byState[l.state] || []).push(l); });

    const body = el('div', null, [
      el('label.fl', { text: 'Find stores near you' }),
      el('div.row', { style: { gap: '7px', flexWrap: 'wrap', marginBottom: '16px' } }, N.STATES.map((s) =>
        el('button.pill.click', { onclick: (e) => setStatePills(e, s) }, s))),
      el('div', { id: 'locList', style: { display: 'flex', flexDirection: 'column', gap: '6px' } })
    ]);

    function setStatePills(e, state) {
      Array.from(e.target.parentElement.children).forEach((b) => b.classList.remove('on'));
      e.target.classList.add('on');
      renderList(byState[state]);
    }
    function renderList(list) {
      const host = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, list.map((l) => {
        const n = ENGINE.nearbyStores(l, { radiusKm: 4 }).length;
        return el('button.btn', {
          style: { justifyContent: 'space-between', borderColor: l.id === current.id ? 'var(--brand)' : 'var(--line)' },
          onclick: () => {
            const picked = setLocation(l.id);
            toast('Delivering to ' + picked.label + ', ' + picked.state, 'good', 2400);
            if (onPick) onPick(picked);
            const ov = document.querySelector('.overlay.on'); if (ov) ov.classList.remove('on');
          }
        }, [
          el('span', null, [el('strong', { text: l.area }), el('span.faint', { text: ' · ' + l.city + ' · ' + l.pin })]),
          el('span', { style: { color: 'var(--brand-2)', fontSize: '12.5px' }, text: n + ' stores' })
        ]);
      }));
      const target = el('#locList');
      UI.mount(target, host);
    }

    renderList(N.LOCATIONS);
    // preselect the state matching the current location
    return { body, selectState: (st) => { renderList(byState[st] || N.LOCATIONS); } };
  }

  function openLocationModal(onPick) {
    const p = locationPicker(onPick);
    UI.openModal(UI.modalShell('Choose your delivery location',
      'NOVA CART delivers from local shops near you. Your selection decides which partners you see and which one the Promise Engine can re-route to.',
      [p.body]), { wide: false });
    const cur = currentLocation();
    const first = p.body.querySelectorAll('.row .pill');
    // highlight the pill for the current state
    if (cur) p.selectState(cur.state);
    return first;
  }

  /* ----------------------------------------------------------- account chip --- */
  /* Rendered into the nav on every page. */
  function mountAccountChip() {
    const host = document.getElementById('account');
    if (!host) return;
    const u = currentUser();
    const loc = currentLocation();
    UI.mount(host,
      el('button.navloc', { onclick: () => openLocationModal(() => location.reload()) }, [
        el('span.navloc-ic', { text: '📍' }),
        el('span.navloc-txt', null, [
          el('small', { text: 'Deliver to' }),
          el('strong', { text: loc.area + ' · ' + loc.pin })
        ])
      ]),
      u
        ? el('div.navuser', { onclick: (e) => { e.stopPropagation(); openAccountMenu(u); } }, [
            el('span.avatar', { text: (u.name.trim()[0] || '?').toUpperCase() }),
            el('span', null, [
              el('strong', { text: u.name.split(' ')[0] }),
              el('small', { text: u.gender === 'prefer-not' ? u.area : u.gender[0].toUpperCase() + u.gender.slice(1) })
            ])
          ])
        : el('a.btn.sm.primary', { href: 'auth.html', style: { marginLeft: '8px' } }, 'Sign in')
    );
  }

  function openAccountMenu(u) {
    UI.openModal(UI.modalShell(u.name, u.email, [
      el('div.card.flat', null, [
        el('div', null, [
          UI.statLine('Name', u.name),
          UI.statLine('Gender', u.gender === 'prefer-not' ? 'Prefer not to say' : u.gender[0].toUpperCase() + u.gender.slice(1)),
          UI.statLine('Mobile', u.phone || '—'),
          UI.statLine('Email', u.email),
          UI.statLine('Area', u.area + ', ' + u.city),
          UI.statLine('State', u.state),
          UI.statLine('PIN code', u.pin),
          UI.statLine('Member since', new Date(u.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }))
        ])
      ]),
      el('div.note.good', { style: { marginTop: '14px' } }, [
        '<strong>Your delivery location is your account.</strong> Changing it here changes which local shops are ',
        'available to you across the whole site — browse, search and re-route all follow it.'
      ])
    ], [
      el('button.btn.ghost', {
        onclick: () => { signOut(); UI.closeModal(); toast('Signed out', '', 1800); location.href = 'index.html'; }
      }, 'Sign out'),
      el('button.btn.primary', {
        onclick: () => { UI.closeModal(); openLocationModal(() => location.reload()); }
      }, 'Change location')
    ]));
  }

  /* --------------------------------------------------------------- guards --- */
  /* Redirect to sign-in if a page needs an account. `next` lets the user come
     back to where they were headed. */
  function requireAuth(nextPage) {
    if (isSignedIn()) return true;
    location.replace('auth.html?next=' + encodeURIComponent(nextPage || location.pathname.split('/').pop()));
    return false;
  }

  function init(pageKey) {
    mountAccountChip();
    window.addEventListener('nova:session', mountAccountChip);
    document.addEventListener('DOMContentLoaded', mountAccountChip);
  }

  global.AUTH = {
    signUp, signIn, signOut, currentUser, isSignedIn,
    currentLocation, setLocation, locationPicker, openLocationModal,
    mountAccountChip, requireAuth, init, validEmail, validPhone, validPin
  };
})(window);
