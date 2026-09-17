// The portal: a mockup of an Instagram profile that the people working on it
// share.
//
// Everything on screen is drawn from two calls: who is signed in, and what the
// open grid holds. Twenty-four slots, one picture each, and a post that wants
// to be a carousel keeps the rest of its pictures behind the first one.
//
// Who may do what is decided on the server (see api/grid.js). What the server
// says about the open grid arrives as canEdit, and this file only uses it to
// decide what to draw: a client never sees a control that would be refused.
(() => {
    'use strict';

    const SLOTS = 24;
    const MAX_IMAGES = 10;
    const LOGIN = 'login.html';

    const ROLE_NAMES = { admin: 'Διαχειριστής', partner: 'Συνεργάτης', client: 'Πελάτης' };

    const $ = (id) => document.getElementById(id);

    // Every name, caption and note on this page was typed by somebody, and all
    // of it is put on screen through innerHTML, so all of it goes through here.
    const esc = (value) => String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    // Just the time, for a message that already sits under a day.
    const clock = (iso) => {
        try {
            return new Intl.DateTimeFormat('el-GR', { hour: '2-digit', minute: '2-digit' })
                .format(new Date(iso));
        } catch { return ''; }
    };

    // How long ago, in the words somebody would use out loud. Anything past a
    // day is better said as the date, which is what when() gives.
    const ago = (iso) => {
        const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
        if (!Number.isFinite(seconds)) return '';
        if (seconds < 90) return 'μόλις τώρα';
        if (seconds < 3600) return `πριν ${Math.round(seconds / 60)}′`;
        if (seconds < 86400) return `πριν ${Math.round(seconds / 3600)} ώρες`;
        return when(iso);
    };

    // Which day a run of messages belongs to, said the way somebody would say
    // it rather than as a date nobody reads.
    const dayOf = (iso) => {
        const day = new Date(iso);
        const midnight = new Date();
        midnight.setHours(0, 0, 0, 0);
        const days = Math.floor((midnight - day) / 86400000);

        if (days < 0) return 'Σήμερα';
        if (days < 1) return 'Χθες';
        try {
            return new Intl.DateTimeFormat('el-GR', { weekday: 'long', day: 'numeric', month: 'long' })
                .format(day);
        } catch { return ''; }
    };

    const when = (iso) => {
        if (!iso) return '';
        try {
            return new Intl.DateTimeFormat('el-GR', {
                day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
            }).format(new Date(iso));
        } catch { return ''; }
    };

    // Which grid was open last time. A browser in private mode throws rather
    // than answering, and that is not worth a broken page.
    const remember = {
        read() { try { return localStorage.getItem('nelyce-grid'); } catch { return null; } },
        write(id) {
            try { id ? localStorage.setItem('nelyce-grid', id) : localStorage.removeItem('nelyce-grid'); }
            catch { /* nothing to remember with */ }
        }
    };

    const initials = (name) => String(name || '?').trim().slice(0, 1).toUpperCase();

    // --- a knock when something lands ----------------------------------------
    // Short enough to be felt rather than heard about. A picture being picked
    // up and a picture landing are the two moments a hand wants told about,
    // because both of them are the hand's own doing.
    const PICK_UP = 8;
    const PUT_DOWN = 16;

    // Android, and whatever else answers. An iPhone does not: a web page there
    // has no vibration to ask for and no way round it either, and a hidden
    // switch flipped in the hope of tapping the Taptic engine was tried here
    // and felt by nobody. It is a knock where a knock is possible and silence
    // where it is not, which is all a page can honestly do.
    const knock = (ms) => {
        if (!navigator.vibrate) return;
        try { navigator.vibrate(ms); } catch { /* refused, and never mind */ }
    };

    // And the thing that does reach an iPhone: the one that moved settles into
    // its new place. The class is taken off again as soon as it is over, so
    // landing in the same place twice running is felt twice.
    const landed = (node) => {
        if (!node) return;
        node.classList.remove('is-landed');
        void node.offsetWidth;
        node.classList.add('is-landed');
        node.addEventListener('animationend', () => node.classList.remove('is-landed'), { once: true });
    };

    // --- faces ---------------------------------------------------------------
    // Eight tones, and which one somebody gets is worked out from their own id,
    // so it never changes and it is never stored. A list of five accounts is
    // five colours, which is the whole point: a column of identical orange
    // circles tells you nothing about who is who.
    const TONES = [
        '232, 137, 74', '224, 100, 138', '91, 185, 140', '91, 159, 224',
        '160, 122, 224', '217, 164, 65', '79, 182, 182', '196, 116, 96'
    ];

    // FNV-1a and a round of mixing after it. A plainer hash would do for ids
    // that are random, which these are, but it puts ids that look alike on the
    // same colour, and two accounts made a second apart should not come out
    // matching.
    const toneOf = (id) => {
        const said = String(id || '');
        let n = 0x811c9dc5;

        for (let i = 0; i < said.length; i += 1) {
            n ^= said.charCodeAt(i);
            n = Math.imul(n, 0x01000193) >>> 0;
        }

        n ^= n >>> 16;
        n = Math.imul(n, 0x7feb352d) >>> 0;
        n ^= n >>> 15;

        return TONES[(n >>> 0) % TONES.length];
    };

    // Everything that draws somebody, or a project, draws it through here: the
    // picture if there is one, the coloured initial if there is not.
    const faceOf = (who, klass, inside = '') => {
        const picture = who && (who.avatar || who.icon);
        return `<span class="${klass}${picture ? ' has-photo' : ''}" style="--face: ${toneOf(who && who.id)}">`
            + (picture ? `<img src="${esc(picture)}" alt="">` : esc(initials(who && who.name)))
            + `${inside}</span>`;
    };

    // A dot in the corner of somebody's face: green at their screen, grey
    // away. Nothing at all where there is no person to be either, which is
    // what a grid's own square is.
    const away = (person) =>
        person.seenAt ? `Ήταν εδώ ${ago(person.seenAt)}` : 'Δεν έχει μπει ποτέ';

    const here = (person) => (person.online ? 'Σε σύνδεση' : away(person));

    const dot = (person) => !person || typeof person.online !== 'boolean' ? ''
        : `<span class="chat-live${person.online ? '' : ' is-away'}"
                 title="${esc(here(person))}"></span>`;

    // --- talking to the server ------------------------------------------
    const api = async (url, { method = 'GET', body } = {}) => {
        const res = await fetch(url, {
            method,
            credentials: 'same-origin',
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined
        });

        const data = await res.json().catch(() => ({}));

        // A session that has run out, or an account that has been removed,
        // both land here. There is nothing on this page to see without one.
        if (res.status === 401) {
            location.replace(LOGIN);
            throw new Error('not-signed-in');
        }
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
    };

    // --- small bits of chrome --------------------------------------------
    let toastTimer = null;
    const toast = (message, kind = 'ok') => {
        const box = $('toast');
        box.textContent = message;
        box.className = `toast toast-${kind}`;
        box.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { box.hidden = true; }, 3200);
    };

    const busy = (message) => { $('app-status').textContent = message || ''; };

    const ERRORS = {
        'not-allowed': 'Δεν έχεις δικαίωμα για αυτή την αλλαγή.',
        'no-such-grid': 'Το grid δεν βρέθηκε.',
        'no-such-client': 'Ο πελάτης δεν βρέθηκε.',
        'no-account': 'Σύνδεσε πρώτα έναν λογαριασμό με τον πελάτη: η φωτογραφία είναι του λογαριασμού.',
        'no-such-sub': 'Η συνδρομή δεν βρέθηκε.',
        'no-such-entry': 'Η χρέωση δεν βρέθηκε.',
        'bad-amount': 'Γράψε ένα ποσό, π.χ. 150 ή 150,50.',
        'bad-date': 'Η ημερομηνία δεν βγάζει νόημα. Η λήξη δεν μπορεί να είναι πριν την έναρξη.',
        'bad-link': 'Ο σύνδεσμος πρέπει να ξεκινάει με https://',
        'too-many-clients': 'Πάρα πολλοί πελάτες.',
        'too-many-subs': 'Πάρα πολλές συνδρομές σε έναν πελάτη.',
        'too-many-entries': 'Πάρα πολλές χρεώσεις σε έναν πελάτη.',
        'no-such-post': 'Η ανάρτηση δεν βρέθηκε.',
        'too-large': 'Η εικόνα είναι πολύ μεγάλη.',
        'bad-type': 'Δεκτές είναι εικόνες JPG, PNG και WebP.',
        'username-taken': 'Αυτό το όνομα χρήστη υπάρχει ήδη.',
        'bad-username': 'Το όνομα χρήστη θέλει 3 ως 32 χαρακτήρες, χωρίς κενά.',
        'short-password': 'Ο κωδικός θέλει τουλάχιστον 8 χαρακτήρες.',
        'last-admin': 'Πρέπει να μείνει τουλάχιστον ένας διαχειριστής.',
        'not-yourself': 'Τον δικό σου λογαριασμό δεν μπορείς να τον σβήσεις.',
        'bad-name': 'Χρειάζεται όνομα.',
        'not-empty': 'Το κουτάκι έχει φωτογραφία. Διάγραψε πρώτα την ανάρτηση.',
        'grid-full': 'Το grid είναι γεμάτο, 24 αναρτήσεις.',
        'not-yours': 'Μόνο όποιος έγραψε το σχόλιο μπορεί να το αλλάξει.',
        'no-such-note': 'Το σχόλιο δεν βρέθηκε.',
        'empty-note': 'Το σχόλιο δεν μπορεί να είναι κενό.',
        'bad-link': 'Ο σύνδεσμος δεν φαίνεται σωστός.',
        'bad-address': 'Αυτή η διεύθυνση δεν επιτρέπεται.',
        'not-an-image': 'Ο σύνδεσμος δεν δίνει εικόνα. Αν είναι Google Drive, άνοιξε τα δικαιώματα του αρχείου σε "όποιος έχει τον σύνδεσμο".',
        'link-too-large': 'Η εικόνα ξεπερνάει τα 4 MB. Κατέβασέ την και ανέβασέ την ως αρχείο.',
        'link-refused': 'Η σελίδα αρνήθηκε να δώσει την εικόνα.',
        'link-unreachable': 'Δεν άνοιξε ο σύνδεσμος.',
        'too-many-redirects': 'Ο σύνδεσμος γυρίζει σε πολλές ανακατευθύνσεις.',
        'empty-message': 'Το μήνυμα δεν μπορεί να είναι κενό.',
        'no-such-message': 'Το μήνυμα δεν βρέθηκε.',
        'not-on-project': 'Αυτός δεν δουλεύει σε αυτό το project.',
        'no-such-link': 'Ο σύνδεσμος δεν βρέθηκε.',
        'board-full': 'Ο πίνακας είναι γεμάτος. Σβήσε κάτι πρώτα.',
        'bad-action': 'Αυτή η ενέργεια δεν αναγνωρίστηκε.',
        'nothing-to-undo': 'Αυτό δεν γίνεται να επανέλθει πια.',
        'sheet-unreadable': 'Μια από τις εικόνες δεν φορτώθηκε. Δοκίμασε ξανά.',
        'sheet-blocked': 'Ο browser δεν επέτρεψε την αποθήκευση της εικόνας.',
        'sheet-failed': 'Η εικόνα δεν φτιάχτηκε. Δοκίμασε με λιγότερες εικόνες.'
    };

    // Known faults get their own sentence. Anything else that arrived as a
    // whole sentence rather than a code came from the deployment itself (a
    // store that is not connected, say), and is worth showing as it is instead
    // of being flattened into "something went wrong".
    const explain = (err) => ERRORS[err.message]
        || (/\s/.test(err.message || '') ? err.message : 'Κάτι πήγε στραβά. Δοκίμασε ξανά.');

    // --- state ------------------------------------------------------------
    const state = {
        me: null,
        grids: [],
        grid: null,     // the open grid, as the server described it
        posts: [],      // twenty-four slots, null where empty
        viewing: null,  // { slot, index } while the viewer is open
        draft: null,    // { slot, images } while the post editor is open
        highlight: null,// { id, name, url } while the highlight panel is open
        replyTo: null,  // the note the next comment answers
        editingNote: null,
        moving: null,   // the slot waiting to be swapped with another
        dragging: null, // the slot being carried by the mouse
        feed: [],       // what everybody else has been doing
        unread: 0,      // how much of it arrived since the bell was last opened
        // The messages view. picked is null for the project thread and the id
        // of the other person for a private one, which is the only difference
        // between the two as far as this file is concerned.
        // Every conversation this account has, and which one is open. None of
        // it depends on which grid is being looked at.
        chat: { kind: 'teams', teams: [], people: [], open: null, gridId: null,
                messages: [], loading: false, answering: null }
    };

    const canEdit = () => Boolean(state.grid && state.grid.canEdit);

    // --- taking it back -----------------------------------------------------
    // What this account has done in this sitting that can be undone, newest
    // last. It lives in memory and goes when the tab does, which is right: undo
    // is for the hand that slipped a moment ago, not a history of the project.
    //
    // Only what can be put back exactly goes on here. A deleted post is not on
    // it, because its pictures are deleted from the store with it and no undo
    // can fetch them back; saying otherwise with a shortcut that half worked
    // would be worse than not offering it.
    const undoable = [];
    const MAX_UNDO = 30;

    // While a step is being undone, whatever it does must not become a step of
    // its own, or undo and redo would chase each other up the stack.
    let undoing = false;

    const keepUndo = (step) => {
        if (undoing) return;
        undoable.push(step);
        if (undoable.length > MAX_UNDO) undoable.shift();
    };

    const undo = async () => {
        const step = undoable.pop();
        if (!step) { toast('Δεν υπάρχει κάτι να αναιρεθεί.'); return; }

        // A step that was done on a grid has to be undone on that grid, which
        // may not be the one being looked at any more.
        if (step.gridId && (!state.grid || state.grid.id !== step.gridId)) {
            await openGrid(step.gridId);
            if (!state.grid || state.grid.id !== step.gridId) return;
        }

        undoing = true;
        try { await step.run(); toast(step.what); }
        catch (err) { toast(explain(err), 'bad'); }
        finally { undoing = false; }
    };

    // --- boot --------------------------------------------------------------
    const boot = async () => {
        let session;
        try { session = await api('/api/session'); }
        catch { return; }

        if (!session.user) { location.replace(LOGIN); return; }

        state.me = session.user;
        $('me-name').textContent = state.me.name;
        $('me-role').textContent = ROLE_NAMES[state.me.role] || '';
        renderMe();
        $('app-admin-nav').hidden = state.me.role !== 'admin';

        await loadGrids();
        await loadClients();
        loadFeed();
        loadChats();

        // What the address bar says, if it still says anything this account can
        // be shown. Otherwise the grid that was open last time, which is what
        // the portal opened on before any of it had a name.
        const [view, kind, id] = where.read();

        if (view === 'chat') {
            openChat(kind && id ? { kind, id } : null);
            return;
        }

        if (view === 'accounts' && state.me.role === 'admin') { openAccounts(); return; }
        if (view === 'client' && kind && purse.list.some(one => one.id === kind)) { openClient(kind); return; }

        // A grid address has two parts, so the id of the grid is the second of
        // them. It was being read as the third, which meant a link somebody
        // sent opened whatever grid this browser had open last.
        if (view === 'grid' && kind && state.grids.some(g => g.id === kind)) { openGrid(kind); return; }

        const remembered = remember.read();
        const first = state.grids.find(g => g.id === remembered) || state.grids[0];

        if (first) openGrid(first.id);
        else if (state.me.role === 'admin') openAccounts();
        // Nothing to work on, but an account to read: a client who is with us
        // for something that never had a grid still has somewhere to land.
        else if (purse.list.length) openClient(purse.list[0].id);
        else showView('blank');
    };

    const loadGrids = async () => {
        try {
            const data = await api('/api/grid');
            state.grids = data.grids || [];
        } catch (err) {
            toast(explain(err), 'bad');
            state.grids = [];
        }
        renderSidebar();
    };

    // --- sidebar -----------------------------------------------------------
    const renderSidebar = () => {
        const list = $('app-grids');

        renderChatBadge();

        if (!state.grids.length) {
            list.innerHTML = '<li class="app-grids-empty">Κανένα ακόμα</li>';
            return;
        }

        list.innerHTML = state.grids.map(grid => `
            <li>
                <button class="app-nav-item${state.grid && state.grid.id === grid.id ? ' is-on' : ''}"
                        type="button" data-grid="${esc(grid.id)}">
                    ${faceOf(grid, 'app-nav-dot')}
                    <span class="app-nav-text">
                        <strong>${esc(grid.name)}</strong>
                        <small>${grid.filled}/${SLOTS} θέσεις</small>
                    </span>
                    ${grid.openNotes && grid.canEdit
                        ? `<span class="app-nav-badge" title="Σχόλια πελάτη που περιμένουν">${grid.openNotes}</span>`
                        : ''}
                </button>
            </li>
        `).join('');
    };

    // --- the screen a keyboard has left behind --------------------------------
    // A phone does not make room for its keyboard: it slides the page up from
    // under itself, so the box being written in ends up behind the keys.
    // visualViewport is the browser saying how much screen is actually left,
    // and the page is given exactly that much to be.
    //
    // Everything below is about not doing it too often. A phone fires these
    // events all through the keyboard's animation and again on every keystroke,
    // and a stylesheet rewritten on each of them is a page that shakes. So:
    // once a frame at most, and only when the numbers have actually moved.
    const root = document.documentElement;
    let frame = null;

    // What the browser's number turns out to be wrong by, measured from where
    // the box actually landed rather than from anything it said.
    //
    // A keyboard, an accessory bar over it and a browser's own toolbars are
    // three layers this end cannot see, and every unit invented for guessing at
    // them is wrong on some phone in some state. So none of them are guessed
    // at: the page is given a height, the box is asked where that put it, and
    // the difference is kept. The lie is a different size with a keyboard up
    // than with it down, so it is remembered separately for each.
    const slack = { idle: 0, typing: 0 };
    const atKeys = () => document.body.classList.contains('is-typing');

    // Kept between visits. The correction is a fact about this browser on this
    // phone, and it does not change between one opening of the portal and the
    // next; measuring it again from scratch every time is what made the box
    // arrive in the wrong place and then hop into the right one.
    //
    // Filed under the height the browser was claiming when it was worked out,
    // so a phone turned on its side, or one with its toolbars in another
    // state, starts again rather than applying somebody else's number.
    const FIT = 'nelyce-fit';

    const rememberFit = () => {
        try { localStorage.setItem(FIT, JSON.stringify({ ...slack, at: window.innerHeight })); }
        catch { /* a browser in private mode, and a hop on every visit */ }
    };

    (() => {
        try {
            const kept = JSON.parse(localStorage.getItem(FIT) || 'null');
            if (kept && kept.at === window.innerHeight) {
                slack.idle = Number(kept.idle) || 0;
                slack.typing = Number(kept.typing) || 0;
            }
        } catch { /* nothing remembered, and one hop to learn it again */ }
    })();

    const measure = () => {
        frame = null;

        const chatting = !$('view-chat').hidden && matchMedia('(max-width: 900px)').matches;

        if (!chatting) {
            document.body.classList.remove('is-chatting', 'is-lifted', 'is-typing', 'is-inroom');
            delete root.dataset.vvh;
            delete root.dataset.vvtop;
            root.style.removeProperty('--vvh');
            root.style.removeProperty('--vvtop');
            return;
        }

        const view = window.visualViewport;

        // The height the browser says is showing, and where that showing part
        // starts. Both are asked of it rather than worked out from pixels here,
        // because a keyboard, an accessory bar above it and a browser's own
        // toolbars are three things this end cannot see and it can.
        const said = view ? view.height : window.innerHeight;
        const tall = String(Math.round(said + (atKeys() ? slack.typing : slack.idle)));
        const lift = String(Math.round(view ? Math.max(0, view.offsetTop) : 0));

        // Writing the same number again is a reflow for nothing, and a reflow
        // in the middle of a keyboard animation is what shaking looks like.
        if (root.dataset.vvh !== tall) {
            root.dataset.vvh = tall;
            root.style.setProperty('--vvh', `${tall}px`);
        }

        if (root.dataset.vvtop !== lift) {
            root.dataset.vvtop = lift;
            root.style.setProperty('--vvtop', `${lift}px`);
        }

        document.body.classList.add('is-chatting');
    };

    // now: work it out before the next paint rather than after it, for the
    // moments when something has just changed what is on the screen and a frame
    // of the old size would be seen.
    const fitToKeyboard = (now) => {
        if (now) {
            if (frame) { cancelAnimationFrame(frame); frame = null; }
            measure();
            return;
        }

        if (frame) return;
        frame = requestAnimationFrame(measure);
    };

    if (window.visualViewport) {
        // Both. A keyboard sliding up is a resize, and a browser moving the
        // showing part of the page under it is a scroll, and the accessory bar
        // over the keys arrives after both. Coalescing to one frame is what
        // keeps answering all of them from turning into a shake.
        window.visualViewport.addEventListener('resize', fitToKeyboard);
        window.visualViewport.addEventListener('scroll', fitToKeyboard);
    }

    window.addEventListener('orientationchange', fitToKeyboard);

    // Whatever the browser said, this is where the box actually is. A band of
    // nothing under it means the page is that much shorter than the screen, and
    // the difference is kept and added to every measurement after it.
    const trueUp = () => {
        const view = window.visualViewport;
        if (!view || !document.body.classList.contains('is-chatting')) return;

        const form = $('chat-form');
        if (!form.offsetParent) return;

        // Where the box ends against where the showing part of the screen does.
        // A band of nothing under it is a page that came out short, and this is
        // the only number in here that is a fact rather than a claim.
        const out = Math.round(view.height - form.getBoundingClientRect().bottom);
        if (Math.abs(out) < 2) return;

        // Only ever a nudge. Anything further out than this is something else
        // going on, and guessing harder at it would make a worse mess.
        const which = atKeys() ? 'typing' : 'idle';
        slack[which] = Math.max(-260, Math.min(260, slack[which] + out));

        measure();
        rememberFit();
    };

    // A keyboard takes about a third of a second to arrive and its accessory
    // bar lands after it, so the answer is asked for again as they settle, and
    // then checked against where things actually ended up. The same check runs
    // with no keyboard at all, because a browser's own bars are just as capable
    // of leaving a band under the box.
    const settle = () => {
        [60, 180, 340, 600].forEach(ms => setTimeout(fitToKeyboard, ms));
        [700, 950, 1400].forEach(ms => setTimeout(trueUp, ms));
    };

    // --- where you were ------------------------------------------------------
    // Every screen in here has a name in the address bar, so a refresh comes
    // back to the screen it was on rather than to the front door. Reloading a
    // conversation because a phone put the page to sleep and gave up on it, and
    // finding the grid instead, is the sort of thing that makes somebody stop
    // trusting a tab.
    //
    // A hash rather than a path: the site is files on a static host, and a path
    // it has no file for is a page that does not exist. A hash never leaves the
    // browser.
    const where = {
        write(...parts) {
            const said = `#${parts.filter(Boolean).map(encodeURIComponent).join('/')}`;
            if (said !== location.hash) history.replaceState(null, '', said);
        },

        read() {
            return (location.hash || '').replace(/^#/, '').split('/')
                .filter(Boolean).map(decodeURIComponent);
        }
    };

    const showView = (name) => {
        ['grid', 'accounts', 'chat', 'client', 'blank'].forEach(view => {
            $(`view-${view}`).hidden = view !== name;
        });

        // The conversation is the only screen where the window itself should
        // not scroll: the name and the box hold still and the talk between them
        // moves, at every size rather than only on a phone.
        document.body.classList.toggle('is-messages', name === 'chat');

        closeSidebar();
        fitToKeyboard(true);
    };

    // --- opening a grid ----------------------------------------------------
    const openGrid = async (id) => {
        busy('Φόρτωση…');
        try {
            const data = await api(`/api/grid?id=${encodeURIComponent(id)}`);
            state.grid = data.grid;
            state.posts = data.posts || [];
            state.moving = null;
            remember.write(id);

            document.querySelectorAll('.app-nav-item').forEach(item => {
                item.classList.toggle('is-on', item.dataset.grid === id);
            });

            $('app-title').textContent = state.grid.name;
            renderGrid();
            showView('grid');
            where.write('grid', id);
        } catch (err) {
            toast(explain(err), 'bad');
        } finally {
            busy('');
        }
    };

    // --- the grid itself ---------------------------------------------------
    const renderGrid = () => {
        const grid = state.grid;
        const open = state.posts.filter(p => p && (p.notes || []).some(n => n.role === 'client' && !n.resolved)).length;

        const photo = $('profile-photo');
        if (grid.avatar) { photo.src = grid.avatar; photo.hidden = false; }
        else { photo.hidden = true; photo.removeAttribute('src'); }

        $('profile-initial').textContent = grid.avatar ? '' : initials(grid.name);
        $('profile-avatar').classList.toggle('is-editable', grid.canEdit);
        renderHighlights();

        $('profile-name').textContent = grid.name;
        $('profile-handle').textContent = grid.handle ? `@${grid.handle}` : '';

        const filled = state.posts.filter(Boolean).length;
        $('profile-stats').innerHTML = `
            <span><strong>${filled}</strong> αναρτήσεις</span>
            <span><strong>${SLOTS - filled}</strong> θέσεις ακόμα</span>
            ${open && grid.canEdit ? `<span class="stat-flag"><strong>${open}</strong> θέλουν αλλαγή</span>` : ''}
        `;

        $('profile-hint').textContent = grid.canEdit
            ? 'Πάτα ένα κενό κουτάκι για να ανεβάσεις: η νέα φωτογραφία μπαίνει πρώτη, πάνω αριστερά, όπως στο Instagram. Σύρε μια φωτογραφία όπου θες για να την πας εκεί, ή κράτησέ την πατημένη αν είσαι σε κινητό. Τα κουμπιά από κάτω αλλάζουν πόσα κουτάκια έχει το grid.'
            : 'Πάτα μια εικόνα για να τη δεις μεγάλη και να αφήσεις σχόλιο.';

        const editing = grid.canEdit;
        const cells = [];

        // Every square the grid is planned to have, in order. A square holds a
        // picture or it holds a place, and either way it can be moved.
        const planned = planCount();

        for (let slot = 0; slot < planned; slot++) {
            const post = state.posts[slot];
            const target = state.moving !== null && state.moving !== slot;
            const cover = post && (post.images || [])[0];

            if (!cover) {
                cells.push(editing
                    ? `<div class="cell cell-empty${target ? ' is-target' : ''}" data-slot="${slot}">
                           <button class="cell-fill" type="button" data-act="add" title="Βάλε φωτογραφία">
                               <span class="cell-plus" aria-hidden="true">+</span>
                               <span class="visually-hidden">Προσθήκη ανάρτησης</span>
                           </button>
                           <button class="cell-x" type="button" data-act="drop-slot" title="Αφαίρεση κουτακιού">
                               &times;<span class="visually-hidden">Αφαίρεση αυτού του κουτακιού</span>
                           </button>
                       </div>`
                    : `<div class="cell cell-empty is-quiet" aria-hidden="true"></div>`);
                continue;
            }
            const notes = (post.notes || []).filter(n => n.role === 'client' && !n.resolved).length;

            cells.push(`
                <div class="cell is-filled${state.moving === slot ? ' is-moving' : ''}${target ? ' is-target' : ''}"
                     data-slot="${slot}">
                    <img src="${esc(cover.url)}" alt="" loading="lazy" decoding="async" data-act="view" draggable="false">
                    ${post.images.length > 1 ? `
                        <span class="cell-mark" title="Carousel με ${post.images.length} εικόνες" aria-hidden="true">
                            <svg viewBox="0 0 24 24"><rect x="8" y="3" width="13" height="13" rx="2.5"/><path d="M16 19.5A2.5 2.5 0 0 1 13.5 22H5.5A2.5 2.5 0 0 1 3 19.5v-8A2.5 2.5 0 0 1 5.5 9"/></svg>
                        </span>` : ''}
                    ${notes && editing ? `<span class="cell-note" title="Ο πελάτης ζήτησε αλλαγή">${notes}</span>` : ''}
                    ${editing ? `
                        <button class="cell-dots" type="button" data-act="menu" aria-label="Επιλογές ανάρτησης">
                            <svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>
                        </button>` : ''}
                </div>
            `);
        }

        $('ig-grid').classList.toggle('is-editable', editing);
        $('ig-grid').innerHTML = cells.join('');

        // Under the grid, where it cannot be mistaken for a square of it: how
        // long the grid is, which is a thing you do to the grid rather than a
        // thing you put in it.
        const plan = $('grid-plan');
        plan.hidden = !editing;
        plan.innerHTML = editing ? `
            <button class="plan-btn" type="button" data-act="more"${planned >= SLOTS ? ' disabled' : ''}>
                <span aria-hidden="true">+</span> Κενό κουτάκι πάνω
            </button>
            <span class="plan-count">${filled} από ${planned} θέσεις</span>
        ` : '';
    };

    // --- clicking around the grid ------------------------------------------
    $('ig-grid').addEventListener('click', (event) => {
        const cell = event.target.closest('.cell');
        if (!cell) return;

        const slot = Number(cell.dataset.slot);

        // A move is in the air: the next cell that is clicked is where the
        // post lands, whether that slot is taken or free.
        if (state.moving !== null) {
            if (state.moving !== slot && Number.isInteger(slot)) move(state.moving, slot);
            else cancelMove();
            return;
        }

        const act = event.target.closest('[data-act]');
        const what = act ? act.dataset.act : null;

        if (what === 'menu') { openMenu(act, slot); return; }
        if (what === 'drop-slot') { removeSlot(slot); return; }
        if (what === 'add') { openEditor(null, null); return; }
        if (state.posts[slot]) openViewer(slot, 0);
    });

    // Dragging a post onto another swaps the two, and onto an empty slot moves
    // it there. Nothing else on the grid shifts, so a drag is one change and
    // dragging back undoes it.
    //
    // This is written with pointer events rather than the browser's own drag
    // and drop, because that one does not exist on a touch screen. A mouse
    // starts dragging as soon as it moves; a finger has to hold still for a
    // moment first, the way rearranging icons on a phone works, so that an
    // ordinary swipe still scrolls the page.
    const board = $('ig-grid');

    const HOLD_MS = 380;        // how long a finger waits before the tile lifts
    const MOUSE_SLOP = 6;       // how far a mouse moves before it counts as a drag
    const TOUCH_SLOP = 10;      // how far a finger may stray and still be scrolling
    const EDGE = 90;            // how near the top or bottom starts scrolling

    const drag = {
        slot: null, pointer: null, touch: false,
        x: 0, y: 0, startX: 0, startY: 0,
        hold: null, ghost: null, active: false, moved: false
    };

    const cellAt = (x, y) => {
        const under = document.elementFromPoint(x, y);
        return under ? under.closest('.cell') : null;
    };

    const droppable = (cell) =>
        cell && cell.dataset.slot !== undefined && Number(cell.dataset.slot) !== drag.slot;

    const markTarget = () => {
        const cell = cellAt(drag.x, drag.y);
        board.querySelectorAll('.is-over').forEach(one => one.classList.remove('is-over'));
        if (droppable(cell)) cell.classList.add('is-over');
    };

    const placeGhost = () => {
        if (!drag.ghost) return;
        drag.ghost.style.transform = `translate(${drag.x}px, ${drag.y}px) translate(-50%, -50%) scale(1.06)`;
    };

    // While a tile is being carried near the top or bottom of the window, the
    // page keeps moving under it, so the far end of the grid is reachable
    // without letting go.
    let scrolling = null;
    const edgeScroll = () => {
        if (!drag.active) { scrolling = null; return; }

        const top = drag.y - EDGE;
        const bottom = drag.y - (window.innerHeight - EDGE);
        const step = top < 0 ? Math.max(-18, top / 4) : bottom > 0 ? Math.min(18, bottom / 4) : 0;

        if (step) { window.scrollBy(0, step); markTarget(); }
        scrolling = requestAnimationFrame(edgeScroll);
    };

    const lift = () => {
        const cell = board.querySelector(`.cell[data-slot="${drag.slot}"]`);
        if (!cell) return;

        const image = cell.querySelector('img');

        drag.active = true;
        drag.moved = true;
        knock(PICK_UP);
        cell.classList.add('is-dragging');
        document.body.classList.add('is-dragging-cell');

        const box = cell.getBoundingClientRect();
        drag.ghost = document.createElement('div');
        drag.ghost.className = `drag-ghost${image ? '' : ' is-empty'}`;
        drag.ghost.style.width = `${box.width}px`;
        drag.ghost.style.height = `${box.height}px`;
        drag.ghost.innerHTML = image
            ? `<img src="${esc(image.src)}" alt="">`
            : '<span aria-hidden="true">+</span>';
        document.body.appendChild(drag.ghost);

        placeGhost();
        markTarget();
        if (!scrolling) scrolling = requestAnimationFrame(edgeScroll);
    };

    const letGo = (dropped) => {
        clearTimeout(drag.hold);
        if (scrolling) { cancelAnimationFrame(scrolling); scrolling = null; }
        if (drag.ghost) { drag.ghost.remove(); drag.ghost = null; }

        document.body.classList.remove('is-dragging-cell');
        board.querySelectorAll('.is-over, .is-dragging')
            .forEach(one => one.classList.remove('is-over', 'is-dragging'));

        const from = drag.slot;
        const wasActive = drag.active;

        drag.slot = null;
        drag.pointer = null;
        drag.active = false;

        if (!wasActive || !dropped) return;

        const cell = cellAt(drag.x, drag.y);
        const to = cell && cell.dataset.slot !== undefined ? Number(cell.dataset.slot) : NaN;

        // Only when it landed somewhere. A square put back where it came from
        // has not been moved, and saying it has with the hand is a small lie.
        if (Number.isInteger(to) && to !== from) { knock(PUT_DOWN); move(from, to); }
    };

    board.addEventListener('pointerdown', (event) => {
        if (!canEdit() || event.button > 0) return;

        // Any square can be carried, empty ones included: an empty square is a
        // place being held, and moving it is how the place is moved. The three
        // dots are a button of their own, and a move already waiting to be
        // placed is finished with a tap rather than with a drag.
        const cell = event.target.closest('.cell[data-slot]');
        if (!cell || event.target.closest('.cell-dots, .cell-x') || state.moving !== null) return;

        drag.slot = Number(cell.dataset.slot);
        drag.pointer = event.pointerId;
        drag.touch = event.pointerType !== 'mouse';
        drag.startX = drag.x = event.clientX;
        drag.startY = drag.y = event.clientY;
        drag.moved = false;
        drag.active = false;

        board.setPointerCapture(event.pointerId);

        // A finger has to stay put; a mouse only has to move.
        if (drag.touch) drag.hold = setTimeout(lift, HOLD_MS);
    });

    board.addEventListener('pointermove', (event) => {
        if (drag.pointer !== event.pointerId) return;

        drag.x = event.clientX;
        drag.y = event.clientY;

        const strayed = Math.hypot(drag.x - drag.startX, drag.y - drag.startY);

        if (!drag.active) {
            // Still deciding what this is. A finger that wanders was scrolling
            // all along, so the tile never lifts.
            if (drag.touch) { if (strayed > TOUCH_SLOP) clearTimeout(drag.hold); }
            else if (strayed > MOUSE_SLOP) lift();
            return;
        }

        event.preventDefault();
        placeGhost();
        markTarget();
    });

    board.addEventListener('pointerup', (event) => {
        if (drag.pointer === event.pointerId) letGo(true);
    });

    board.addEventListener('pointercancel', (event) => {
        if (drag.pointer === event.pointerId) letGo(false);
    });

    // A tile that was carried should not also count as a tap on the picture,
    // which would open the viewer the moment it was put down.
    board.addEventListener('click', (event) => {
        if (!drag.moved) return;
        drag.moved = false;
        event.stopPropagation();
        event.preventDefault();
    }, true);

    // Once a finger is carrying something the page must stop scrolling under
    // it, and only preventDefault on a live touch listener can say so.
    document.addEventListener('touchmove', (event) => {
        if (drag.active) event.preventDefault();
    }, { passive: false });

    $('grid-plan').addEventListener('click', (event) => {
        const button = event.target.closest('button[data-act="more"]');
        if (button && !button.disabled) addSlot();
    });

    // The new square goes to the front, where the next picture is going to go.
    const addSlot = async () => {
        busy('…');
        try {
            const data = await api('/api/grid', {
                method: 'POST',
                body: { id: state.grid.id, action: 'add-slot' }
            });
            state.posts = data.posts;
            state.grid.slots = data.slots;

            const listed = state.grids.find(g => g.id === state.grid.id);
            if (listed) listed.slots = data.slots;

            renderGrid();
        } catch (err) {
            toast(explain(err), 'bad');
        } finally {
            busy('');
        }
    };

    // Takes one empty square off the grid, and what was after it moves up into
    // the space, which is what removing something from a row looks like.
    const removeSlot = async (slot) => {
        busy('…');
        try {
            const data = await api('/api/grid', {
                method: 'POST',
                body: { id: state.grid.id, action: 'remove-slot', slot }
            });
            state.posts = data.posts;
            state.grid.slots = data.slots;

            const listed = state.grids.find(g => g.id === state.grid.id);
            if (listed) listed.slots = data.slots;

            renderGrid();
        } catch (err) {
            toast(explain(err), 'bad');
        } finally {
            busy('');
        }
    };

    // How far down the last picture reaches: the grid can never be shorter.
    const used = () => state.posts.reduce((far, post, i) => (post ? i + 1 : far), 0);

    // How many squares the grid is currently planned to have.
    const planCount = () => Math.max(Number(state.grid.slots) || 0, used());

    const setSlots = async (want) => {
        busy('…');
        try {
            const data = await api('/api/grid', {
                method: 'POST',
                body: { id: state.grid.id, action: 'set-slots', slots: want }
            });
            state.grid.slots = data.slots;

            const listed = state.grids.find(g => g.id === state.grid.id);
            if (listed) listed.slots = data.slots;

            renderGrid();
        } catch (err) {
            toast(explain(err), 'bad');
        } finally {
            busy('');
        }
    };

    const move = async (from, to) => {
        const moving = state.posts[from] || null;
        const before = state.posts.slice();
        state.moving = null;

        // The two squares trade places the moment the pointer is let go.
        // Waiting for the server before showing it means watching the picture
        // spring back to where it came from and then jump, which looks exactly
        // like a move that failed.
        state.posts[from] = state.posts[to];
        state.posts[to] = moving;
        renderGrid();
        landed(board.querySelector(`.cell[data-slot="${to}"]`));

        busy('Μετακίνηση…');
        try {
            // The server's answer is the one that counts, and a move shifts
            // everything between the two places, so the whole grid comes back.
            const data = await api('/api/grid', {
                method: 'POST',
                body: { id: state.grid.id, action: 'move-post', from, to }
            });
            state.posts = data.posts;
            renderGrid();

            // Two squares trading places is its own undo: doing it again puts
            // both of them back.
            keepUndo({
                what: 'Η μετακίνηση αναιρέθηκε.',
                gridId: state.grid.id,
                run: () => move(to, from)
            });
        } catch (err) {
            state.posts = before;
            renderGrid();
            toast(explain(err), 'bad');
        } finally {
            busy('');
        }
    };

    const cancelMove = () => {
        state.moving = null;
        renderGrid();
    };

    // --- the three dots ----------------------------------------------------
    const menu = document.createElement('div');
    menu.className = 'cell-menu';
    menu.hidden = true;
    document.body.appendChild(menu);

    const closeMenu = () => { menu.hidden = true; };

    const openMenu = (button, slot) => {
        const post = state.posts[slot];
        if (!post) return;

        // The sheet is something the studio sends out, so the line that makes
        // one is the studio's. Everything else here is about the grid itself.
        const sends = state.me.role === 'admin' || state.me.role === 'partner';

        menu.innerHTML = `
            <button type="button" data-do="view">Προβολή</button>
            <button type="button" data-do="edit">Επεξεργασία</button>
            <button type="button" data-do="move">Μετακίνηση</button>
            ${sends ? '<button type="button" data-do="export">Εξαγωγή PDF</button>' : ''}
            <button type="button" data-do="delete" class="is-danger">Διαγραφή</button>
        `;
        menu.dataset.slot = String(slot);
        menu.hidden = false;

        // Placed against the button, then pulled back inside the window if it
        // would hang off the right edge or the bottom of the page.
        const box = button.getBoundingClientRect();
        const width = menu.offsetWidth;
        const height = menu.offsetHeight;
        const left = Math.min(box.right - width, window.innerWidth - width - 12);
        const top = box.bottom + height > window.innerHeight ? box.top - height - 6 : box.bottom + 6;

        menu.style.left = `${Math.max(12, left) + window.scrollX}px`;
        menu.style.top = `${Math.max(12, top) + window.scrollY}px`;
    };

    menu.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-do]');
        if (!button) return;

        const slot = Number(menu.dataset.slot);
        const post = state.posts[slot];
        closeMenu();
        if (!post) return;

        switch (button.dataset.do) {
            case 'view': openViewer(slot, 0); break;
            case 'edit': openEditor(slot, post); break;
            case 'export': exportPost(slot); break;
            case 'move':
                state.moving = slot;
                renderGrid();
                toast('Διάλεξε τη θέση που θα πάει.');
                break;
            case 'delete': removePost(slot); break;
        }
    });

    document.addEventListener('click', (event) => {
        if (!menu.hidden && !menu.contains(event.target) && !event.target.closest('[data-act="menu"]')) closeMenu();
    });

    window.addEventListener('scroll', closeMenu, { passive: true });

    const removePost = async (slot) => {
        if (!confirm('Να διαγραφεί η ανάρτηση από το grid;')) return;

        busy('Διαγραφή…');
        try {
            await api('/api/grid', { method: 'POST', body: { id: state.grid.id, action: 'delete-post', slot } });
            state.posts[slot] = null;
            renderGrid();
            refreshBadge();
            toast('Διαγράφηκε.');
        } catch (err) {
            toast(explain(err), 'bad');
        } finally {
            busy('');
        }
    };

    // The sidebar carries a count of the posts waiting on a client's note, and
    // it is worth keeping honest after anything that could change it.
    const refreshBadge = () => {
        const grid = state.grids.find(g => g.id === state.grid.id);
        if (!grid) return;
        grid.filled = state.posts.filter(Boolean).length;
        grid.openNotes = state.posts.filter(p => p && (p.notes || []).some(n => n.role === 'client' && !n.resolved)).length;
        renderSidebar();
    };

    // --- the viewer --------------------------------------------------------
    const openViewer = (slot, index) => {
        const post = state.posts[slot];
        if (!post) return;

        state.viewing = { slot, index: index || 0 };
        state.replyTo = null;
        state.editingNote = null;
        showReplying();
        $('post-modal').hidden = false;
        document.body.classList.add('is-locked');
        renderViewer();
    };

    // The page stays still while any of the three panels is open.
    const unlock = () => {
        const open = ['post-modal', 'edit-modal', 'hl-modal', 'acct-modal', 'me-modal', 'money-modal']
            .some(id => !$(id).hidden);
        if (!open) document.body.classList.remove('is-locked');
    };

    const closeViewer = () => {
        state.viewing = null;
        $('post-modal').hidden = true;
        unlock();
    };

    const renderViewer = () => {
        const { slot, index } = state.viewing;
        const post = state.posts[slot];
        if (!post) { closeViewer(); return; }

        // The strip is rebuilt only when what is on it has changed. Every note
        // written about a post comes back through here, and rebuilding it would
        // fetch every picture again to show the same ones.
        const track = $('post-track');
        const key = `${post.id}:${post.updatedAt || ''}:${post.images.length}`;

        if (track.dataset.key !== key) {
            track.dataset.key = key;
            track.innerHTML = post.images
                .map(one => `<img src="${esc(one.url)}" alt="" draggable="false">`).join('');
        }

        const many = post.images.length > 1;
        $('post-prev').hidden = !many;
        $('post-next').hidden = !many;
        $('post-count').hidden = !many;
        $('post-dots').innerHTML = many ? post.images.map(() => '<span></span>').join('') : '';

        markIndex();
        placeTrack(0, false);

        $('post-caption').textContent = post.caption || '';
        $('post-caption').hidden = !post.caption;

        renderLike(post, post.images[index] || post.images[0]);
        // The sheet is something the studio sends out, so it is the studio's:
        // the admin and the partners working on the grid. A client reads the
        // post and says what they think of it, and that is the whole of what
        // this screen is for them.
        const sends = state.me.role === 'admin' || state.me.role === 'partner';

        $('post-export').hidden = !sends;
        $('post-edit').hidden = !canEdit();
        $('post-delete').hidden = !canEdit();

        // With nothing left in it the row is a rule and a gap under a caption.
        $('post-actions').hidden = !sends && !canEdit();
        renderNotes(post, slot);
    };

    // --- where the strip stands ----------------------------------------------
    // One picture per screen, so the strip sits at minus one screen per
    // picture. A finger adds its own distance on top of that, which is what
    // makes the next one arrive as this one leaves rather than after it.
    const placeTrack = (dx = 0, glide = true) => {
        if (!state.viewing) return;

        const track = $('post-track');
        const wasOff = track.style.transition === 'none';
        track.style.transition = glide ? '' : 'none';

        // Turning the easing back on and moving in the same breath gets both
        // applied at once, and nothing animates. Reading the layout in between
        // makes the browser settle the first before it sees the second, which
        // is the difference between gliding to the next picture and appearing
        // at it.
        if (glide && wasOff) void track.offsetWidth;

        track.style.transform = `translateX(calc(${-100 * state.viewing.index}% + ${dx}px))`;
    };

    const markIndex = () => {
        if (!state.viewing) return;

        const post = state.posts[state.viewing.slot];
        if (!post) return;

        const at = state.viewing.index;
        $('post-count').textContent = `${at + 1}/${post.images.length}`;

        Array.from($('post-dots').children)
            .forEach((one, i) => one.classList.toggle('is-on', i === at));
    };

    // Everything that changes which picture is showing goes through here: the
    // arrows, the keyboard and the finger all mean the same thing.
    const goTo = (want) => {
        const post = state.posts[state.viewing.slot];
        const count = post.images.length;

        state.viewing.index = ((want % count) + count) % count;

        placeTrack(0, true);
        markIndex();
        renderLike(post, post.images[state.viewing.index]);
    };

    // --- the heart ----------------------------------------------------------
    // On the picture, not on the post: paging through a carousel changes what
    // the button is about, which is what the client is being asked anyway,
    // namely which of these three.
    const likesOn = (post, image) => {
        const all = (post && post.likes) || {};
        return Array.isArray(all[image.url]) ? all[image.url] : [];
    };

    const renderLike = (post, image) => {
        const likes = likesOn(post, image);
        const mine = likes.some(like => like.userId === state.me.id);

        $('like-btn').setAttribute('aria-pressed', mine ? 'true' : 'false');
        $('like-btn').setAttribute('aria-label', mine ? 'Αφαίρεση λάικ' : 'Μου αρέσει');
        $('like-count').textContent = likes.length || '';

        // Yourself first, and as "εσένα" rather than by name.
        const names = likes
            .slice()
            .sort((a, b) => (a.userId === state.me.id ? -1 : b.userId === state.me.id ? 1 : 0))
            .map(like => (like.userId === state.me.id ? 'εσένα' : like.name));

        const rest = names.length - 2;
        $('like-who').textContent =
            !names.length ? ''
            : mine && names.length === 1 ? 'Σου αρέσει'
            : `Αρέσει σε ${names.slice(0, 2).join(' και ')}${rest > 0 ? ` και ${rest} ακόμα` : ''}`;
    };

    $('like-btn').addEventListener('click', async () => {
        if (!state.viewing) return;
        const { slot, index } = state.viewing;
        const post = state.posts[slot];
        const image = post && (post.images[index] || post.images[0]);
        if (!image) return;

        // The heart fills before the server has answered. It is one bit about
        // one picture, and waiting a round trip to see it move feels broken.
        const likes = likesOn(post, image);
        const mine = likes.some(like => like.userId === state.me.id);
        post.likes = { ...(post.likes || {}) };
        post.likes[image.url] = mine
            ? likes.filter(like => like.userId !== state.me.id)
            : likes.concat({ userId: state.me.id, name: state.me.name, at: new Date().toISOString() });
        renderLike(post, image);

        try {
            const data = await api('/api/grid', {
                method: 'POST',
                body: { id: state.grid.id, action: 'like', slot, index }
            });
            post.likes = data.likes || {};
        } catch (err) {
            toast(explain(err), 'bad');
        }

        // Whatever the server said is the truth, including when it refused.
        if (state.viewing && state.viewing.slot === slot) renderLike(post, image);
    });

    // --- the conversation about a post --------------------------------------
    // A note can be answered, changed by whoever wrote it, and taken back. A
    // thread is one level deep: a reply to a reply joins the same thread rather
    // than starting a staircase in a panel the width of a phone.
    const renderNotes = (post, slot) => {
        const notes = post.notes || [];
        const list = $('note-list');

        if (!notes.length) {
            list.innerHTML = '<li class="note-none">Κανένα σχόλιο ακόμα.</li>';
            return;
        }

        const one = (note, isReply) => {
            const mine = note.userId === state.me.id;
            const editing = state.editingNote === note.id;

            const body = editing
                ? `<div class="note-edit">
                       <textarea maxlength="1000" data-edit="${esc(note.id)}">${esc(note.text)}</textarea>
                       <span class="note-tools">
                           <button type="button" data-do="save">Αποθήκευση</button>
                           <button type="button" data-do="cancel">Ακύρωση</button>
                       </span>
                   </div>`
                : `<p class="note-text">${esc(note.text)}</p>
                   <span class="note-tools">
                       <button type="button" data-do="reply">Απάντηση</button>
                       ${mine ? '<button type="button" data-do="edit">Επεξεργασία</button>' : ''}
                       ${mine || state.me.role === 'admin' ? '<button type="button" data-do="delete">Διαγραφή</button>' : ''}
                       ${canEdit() && note.role === 'client' && !isReply
                           ? `<button type="button" data-do="resolve" data-resolved="${note.resolved ? '1' : '0'}">
                                  ${note.resolved ? 'Άνοιγμα ξανά' : 'Έγινε'}
                              </button>` : ''}
                   </span>`;

            return `
                <li class="note${note.resolved ? ' is-done' : ''}${note.role === 'client' ? ' is-client' : ''}${isReply ? ' is-reply' : ''}"
                    data-note="${esc(note.id)}" data-slot="${slot}">
                    <p class="note-who">
                        <strong>${esc(note.name)}</strong>
                        <small>${esc(ROLE_NAMES[note.role] || '')} · ${esc(when(note.at))}${note.editedAt ? ' · επεξεργάστηκε' : ''}</small>
                    </p>
                    ${body}
                </li>`;
        };

        list.innerHTML = notes
            .filter(note => !note.replyTo)
            .map(note => one(note, false) + notes.filter(r => r.replyTo === note.id).map(r => one(r, true)).join(''))
            .join('');
    };

    const keepNotes = (slot, notes) => {
        state.posts[slot].notes = notes;
        renderNotes(state.posts[slot], slot);
        renderGrid();
        refreshBadge();
    };

    const noteAction = (slot, body) => api('/api/grid', {
        method: 'POST',
        body: { id: state.grid.id, slot, ...body }
    });

    $('note-list').addEventListener('click', async (event) => {
        const button = event.target.closest('button[data-do]');
        if (!button) return;

        const item = button.closest('.note');
        const slot = Number(item.dataset.slot);
        const noteId = item.dataset.note;
        const post = state.posts[slot];

        try {
            switch (button.dataset.do) {
                case 'reply': {
                    const note = (post.notes || []).find(n => n.id === noteId);
                    state.replyTo = note ? { id: note.id, name: note.name } : null;
                    showReplying();
                    $('note-text').focus();
                    break;
                }

                case 'edit':
                    state.editingNote = noteId;
                    renderNotes(post, slot);
                    item.querySelector('textarea').focus();
                    break;

                case 'cancel':
                    state.editingNote = null;
                    renderNotes(post, slot);
                    break;

                case 'save': {
                    const said = item.querySelector('textarea').value.trim();
                    if (!said) return;

                    const data = await noteAction(slot, { action: 'edit-note', noteId, text: said });
                    const note = (post.notes || []).find(n => n.id === noteId);
                    if (note) Object.assign(note, data.note);

                    state.editingNote = null;
                    renderNotes(post, slot);
                    break;
                }

                case 'delete': {
                    if (!confirm('Να διαγραφεί το σχόλιο;')) return;
                    const data = await noteAction(slot, { action: 'delete-note', noteId });
                    keepNotes(slot, data.notes);
                    break;
                }

                case 'resolve': {
                    const data = await noteAction(slot, {
                        action: 'resolve-note', noteId,
                        resolved: button.dataset.resolved !== '1'
                    });
                    const note = (post.notes || []).find(n => n.id === data.note.id);
                    if (note) Object.assign(note, data.note);
                    keepNotes(slot, post.notes);
                    break;
                }
            }
        } catch (err) {
            toast(explain(err), 'bad');
        }
    });

    const showReplying = () => {
        const bar = $('note-replying');
        bar.hidden = !state.replyTo;
        if (state.replyTo) $('note-replying-to').textContent = `Απάντηση σε ${state.replyTo.name}`;
    };

    $('note-replying-cancel').addEventListener('click', () => {
        state.replyTo = null;
        showReplying();
    });

    $('note-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const field = $('note-text');
        const said = field.value.trim();
        if (!said || !state.viewing) return;

        const { slot } = state.viewing;
        field.disabled = true;

        try {
            const data = await noteAction(slot, {
                action: 'add-note',
                text: said,
                replyTo: state.replyTo ? state.replyTo.id : undefined
            });

            const post = state.posts[slot];
            post.notes = post.notes || [];
            post.notes.push(data.note);

            field.value = '';
            state.replyTo = null;
            showReplying();
            keepNotes(slot, post.notes);
            toast('Το σχόλιο μπήκε.');
        } catch (err) {
            toast(explain(err), 'bad');
        } finally {
            field.disabled = false;
        }
    });

    // --- swiping a carousel --------------------------------------------------
    // The picture follows the finger and the next one arrives when it is let
    // go far enough, the way a carousel works everywhere else on a phone. The
    // stylesheet has already said that up and down belongs to the page, so a
    // finger that means to scroll never moves the picture and the other way
    // round.
    const stage = $('post-stage');

    const swipe = { id: null, x: 0, y: 0, dx: 0, sideways: null };

    // Far enough to mean it: a fifth of the way across, and never less than a
    // flick, so the gesture is the same on a small screen and a large one.
    const FAR_ENOUGH = (wide) => Math.max(48, wide * 0.2);

    stage.addEventListener('pointerdown', (event) => {
        if (event.pointerType === 'mouse') return;

        const post = state.viewing && state.posts[state.viewing.slot];
        if (!post || post.images.length < 2) return;

        swipe.id = event.pointerId;
        swipe.x = event.clientX;
        swipe.y = event.clientY;
        swipe.dx = 0;
        swipe.sideways = null;
    });

    stage.addEventListener('pointermove', (event) => {
        if (swipe.id !== event.pointerId) return;

        const dx = event.clientX - swipe.x;
        const dy = event.clientY - swipe.y;

        // Which way this is going is decided once, on the first few pixels,
        // and not revisited: a swipe that wanders should not turn into a scroll
        // halfway through.
        if (swipe.sideways === null) {
            if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
            swipe.sideways = Math.abs(dx) > Math.abs(dy);
            if (swipe.sideways) stage.classList.add('is-swiping');
        }

        if (!swipe.sideways) return;

        swipe.dx = dx;
        placeTrack(dx, false);
    });

    const letGoOfSwipe = (dropped) => {
        if (swipe.id === null) return;

        const { dx, sideways } = swipe;
        swipe.id = null;
        swipe.sideways = null;
        swipe.dx = 0;

        stage.classList.remove('is-swiping');

        const far = sideways && dropped
            && Math.abs(dx) >= FAR_ENOUGH(stage.getBoundingClientRect().width);

        // Either way the strip glides to where it belongs from wherever the
        // finger left it, which is one movement rather than a snap and a jump.
        if (far) goTo(state.viewing.index + (dx < 0 ? 1 : -1));
        else placeTrack(0, true);
    };

    stage.addEventListener('pointerup', (event) => {
        if (swipe.id === event.pointerId) letGoOfSwipe(true);
    });

    stage.addEventListener('pointercancel', (event) => {
        if (swipe.id === event.pointerId) letGoOfSwipe(false);
    });

    $('post-prev').addEventListener('click', () => goTo(state.viewing.index - 1));
    $('post-next').addEventListener('click', () => goTo(state.viewing.index + 1));

    // --- the post as one picture ---------------------------------------------
    // A sheet to send somebody who has no account here: the whole post at a
    // glance, its pictures side by side in the order they are in, numbered so
    // the order survives being forwarded, with the caption underneath.
    //
    // It is drawn on a canvas in the browser. The browser already has every one
    // of these pictures on screen, so a sheet assembled here costs nothing and
    // needs no endpoint of its own.
    //
    // Everything below is measured in one set of units and then drawn through a
    // single scale, so a sheet that would come out too big for a phone to hand
    // back is the same sheet, smaller.
    // Every picture in a row is drawn to the same height and to its own width,
    // so each one comes out at its own shape with nothing padded around it. A
    // square among four-by-fives is a square, not a square with grey above and
    // below it.
    //
    // The height is the height these pictures are actually stored at, so a
    // portrait one is drawn at its own pixels: bigger than this would be an
    // enlargement, which costs a heavier file and shows no more than was there.
    const ROW_H = 1080;
    const CELL_GAP = 22;
    const SHEET_PAD = 56;
    const SHEET_HEAD = 168;     // the name, the line under it, and air
    const CAPTION_COL = 1180;   // as wide as a line of text should ever be

    // A row of ten would be a sheet eight times wider than it is tall. Five is
    // where a row stops being something anybody can look at.
    const PER_ROW = 5;

    // A canvas has a size past which a phone quietly refuses to hand back what
    // was drawn on it. Safari stops at about sixteen and a half million pixels,
    // and this leaves room under that rather than creeping up on it.
    const SHEET_AREA = 14 * 1000 * 1000;

    const INK = '#15151b';
    const FADED = '#6f7078';
    const PAPER = '#f6f5f3';

    // A picture from the store, loaded in a way that lets the canvas be read
    // back afterwards. Without the crossOrigin the drawing works and the saving
    // does not, which is the sort of failure worth ruling out at the start.
    const fetchImage = (url) => new Promise((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('sheet-unreadable'));
        image.src = url;
    });

    const roundRect = (ctx, x, y, w, h, r) => {
        ctx.beginPath();
        if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    };

    // Break a paragraph into lines that fit, keeping the line breaks that were
    // typed into it: a caption is written in lines on purpose.
    const wrap = (ctx, said, width) => {
        const lines = [];

        String(said).split('\n').forEach(paragraph => {
            const words = paragraph.split(/\s+/).filter(Boolean);
            if (!words.length) { lines.push(''); return; }

            let line = '';
            words.forEach(word => {
                const tried = line ? `${line} ${word}` : word;
                if (line && ctx.measureText(tried).width > width) { lines.push(line); line = word; }
                else line = tried;
            });
            lines.push(line);
        });

        return lines;
    };

    // A PDF around a JPEG, written out by hand. A PDF is a text format with
    // streams in it, and a JPEG is a thing a PDF can carry exactly as it stands
    // under the name DCTDecode, so the file is the picture plus about a
    // kilobyte of bookkeeping. No library, nothing re-encoded, nothing larger
    // than the picture already was.
    const PDF_LONG = 842;   // the long side of an A4 page, in points

    const asPdf = async (jpeg, w, h) => {
        const bytes = new Uint8Array(await jpeg.arrayBuffer());

        // The page is the shape of the sheet, sized so it opens at something
        // like a page rather than at something like a wall.
        const k = PDF_LONG / Math.max(w, h);
        const pw = Math.round(w * k);
        const ph = Math.round(h * k);

        const ascii = (said) => {
            const out = new Uint8Array(said.length);
            for (let i = 0; i < said.length; i += 1) out[i] = said.charCodeAt(i) & 0xff;
            return out;
        };

        const chunks = [];
        let length = 0;

        const put = (piece) => {
            const part = typeof piece === 'string' ? ascii(piece) : piece;
            chunks.push(part);
            length += part.length;
        };

        // Where each object starts, in bytes from the beginning, which is the
        // whole of what the table at the end has to say.
        const offsets = [];

        const object = (n, head, stream) => {
            offsets[n] = length;
            put(`${n} 0 obj\n${head}\n`);
            if (stream) { put('stream\n'); put(stream); put('\nendstream\n'); }
            put('endobj\n');
        };

        // Four bytes above the ASCII range, so that anything moving this file
        // around treats it as binary and does not helpfully rewrite its line
        // endings.
        put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

        const draw = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q\n`;

        object(1, '<< /Type /Catalog /Pages 2 0 R >>');
        object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
        object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] `
            + `/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
        object(4, `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} `
            + `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode `
            + `/Length ${bytes.length} >>`, bytes);
        object(5, `<< /Length ${draw.length} >>`, draw);

        const table = length;
        let xref = 'xref\n0 6\n0000000000 65535 f \n';
        for (let n = 1; n <= 5; n += 1) xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;

        put(xref);
        put(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${table}\n%%EOF\n`);

        return new Blob(chunks, { type: 'application/pdf' });
    };

    const save = (file, name) => {
        const href = URL.createObjectURL(file);
        const link = document.createElement('a');
        link.href = href;
        link.download = name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(href), 4000);
    };

    const exportPost = async (slot) => {
        const post = state.posts[slot];
        if (!post) return;

        busy('Ετοιμάζεται…');
        try {
            // A canvas writes in whatever the page has already loaded, and a
            // sheet set in the fallback typeface is not the sheet anybody
            // meant to send.
            if (document.fonts && document.fonts.ready) await document.fonts.ready;

            const pictures = await Promise.all(post.images.map(one => fetchImage(one.url)));

            // Rows as even as they can be: seven pictures are four and three
            // rather than five and two.
            const rows = Math.ceil(pictures.length / PER_ROW);
            const across = Math.ceil(pictures.length / rows);

            // Each picture at its own width, and each row as wide as what is
            // in it. The sheet is as wide as its widest row, and a row with
            // room to spare sits in the middle of it.
            const shots = pictures.map(one => ({
                picture: one,
                w: Math.round(ROW_H * (one.naturalWidth / one.naturalHeight)),
                h: ROW_H
            }));

            const bands = [];
            for (let i = 0; i < shots.length; i += across) bands.push(shots.slice(i, i + across));

            const rowWidth = (row) =>
                row.reduce((sum, one) => sum + one.w, 0) + (row.length - 1) * CELL_GAP;

            const widest = Math.max(...bands.map(rowWidth));
            const width = SHEET_PAD * 2 + widest;
            const inner = widest;
            const wall = rows * ROW_H + (rows - 1) * CELL_GAP;

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const font = (size, weight = 400) => `${weight} ${size}px Geologica, system-ui, sans-serif`;

            const caption = (post.caption || '').trim();
            const captionSize = 30;
            const captionStep = 46;
            ctx.font = font(captionSize);

            const lines = caption ? wrap(ctx, caption, Math.min(inner, CAPTION_COL)) : [];
            const captionBox = lines.length ? 34 + lines.length * captionStep : 0;
            const height = SHEET_HEAD + wall + captionBox + SHEET_PAD;

            // Drawn at whatever size the platform will actually return.
            const scale = Math.min(1, Math.sqrt(SHEET_AREA / (width * height)));
            canvas.width = Math.round(width * scale);
            canvas.height = Math.round(height * scale);
            ctx.scale(scale, scale);

            ctx.fillStyle = PAPER;
            ctx.fillRect(0, 0, width, height);

            // --- the head ---------------------------------------------------
            ctx.fillStyle = INK;
            ctx.font = font(44, 600);
            ctx.fillText(state.grid.name, SHEET_PAD, SHEET_PAD + 44);

            ctx.fillStyle = FADED;
            ctx.font = font(27);
            ctx.fillText([
                state.grid.handle ? `@${state.grid.handle}` : '',
                pictures.length > 1 ? `Carousel, ${pictures.length} εικόνες` : 'Ανάρτηση'
            ].filter(Boolean).join('  ·  '), SHEET_PAD, SHEET_PAD + 88);

            // --- the pictures, side by side -----------------------------------
            let seen = 0;
            bands.forEach((row, r) => {
                const y = SHEET_HEAD + r * (ROW_H + CELL_GAP);
                let x = SHEET_PAD + Math.round((widest - rowWidth(row)) / 2);

                row.forEach(shot => {
                    seen += 1;

                    ctx.save();
                    roundRect(ctx, x, y, shot.w, shot.h, 20);
                    ctx.clip();
                    ctx.drawImage(shot.picture, x, y, shot.w, shot.h);
                    ctx.restore();

                    // Which one of how many, so the order survives being sent on.
                    if (shots.length > 1) {
                        const label = `${seen}/${shots.length}`;
                        ctx.font = font(24, 500);

                        const w = ctx.measureText(label).width + 32;
                        const h = 44;
                        const bx = x + shot.w - w - 16;
                        const by = y + 16;

                        ctx.fillStyle = 'rgba(10, 10, 14, .62)';
                        roundRect(ctx, bx, by, w, h, h / 2);
                        ctx.fill();

                        ctx.fillStyle = '#fff';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(label, bx + 16, by + h / 2 + 1);
                        ctx.textBaseline = 'alphabetic';
                    }

                    x += shot.w + CELL_GAP;
                });
            });

            // --- the caption ---------------------------------------------------
            if (lines.length) {
                ctx.fillStyle = INK;
                ctx.font = font(captionSize);
                let line = SHEET_HEAD + wall + 34 + captionSize;
                lines.forEach(said => { ctx.fillText(said, SHEET_PAD, line); line += captionStep; });
            }

            // The page's one picture. toBlob refuses on a canvas that has
            // something on it the page was not allowed to read; everything here
            // comes from this deployment's own store, which allows it, so this
            // is the belt on the braces.
            const sheet = await new Promise((resolve, reject) => {
                try { canvas.toBlob(one => one ? resolve(one) : reject(new Error('sheet-failed')), 'image/jpeg', 0.95); }
                catch { reject(new Error('sheet-blocked')); }
            });

            const name = `${state.grid.name} ${slot + 1}`
                .normalize('NFD').replace(/[̀-ͯ]/g, '')
                .replace(/[^a-zA-Z0-9Ͱ-Ͽ]+/g, '-')
                .replace(/^-|-$/g, '') || 'post';

            save(await asPdf(sheet, canvas.width, canvas.height), `${name}.pdf`);
            toast('Το PDF κατέβηκε.');
        } catch (err) {
            toast(explain(err), 'bad');
        } finally {
            busy('');
        }
    };

    $('post-export').addEventListener('click', () => {
        if (state.viewing) exportPost(state.viewing.slot);
    });

    $('post-edit').addEventListener('click', () => {
        const slot = state.viewing.slot;
        closeViewer();
        openEditor(slot, state.posts[slot]);
    });

    $('post-delete').addEventListener('click', () => {
        const slot = state.viewing.slot;
        closeViewer();
        removePost(slot);
    });

    // --- the editor --------------------------------------------------------
    const sayEdit = (message) => {
        $('edit-error').textContent = message || '';
        $('edit-error').hidden = !message;
    };

    const openEditor = (slot, post) => {
        state.draft = {
            slot,                       // null while making a new post
            images: post ? post.images.slice() : [],
            pending: 0
        };
        $('edit-title').textContent = post ? 'Επεξεργασία ανάρτησης' : 'Νέα ανάρτηση';
        $('edit-sub').textContent = post
            ? 'Η πρώτη εικόνα είναι αυτή που φαίνεται στο grid. Μέχρι 10 εικόνες για carousel.'
            : 'Μπαίνει πρώτη, πάνω αριστερά, όπως στο Instagram. Μέχρι 10 εικόνες για carousel.';
        $('edit-caption').value = post ? (post.caption || '') : '';
        sayEdit('');
        $('edit-modal').hidden = false;
        document.body.classList.add('is-locked');
        picker.close();
        renderStrip();
    };

    const closeEditor = () => {
        state.draft = null;
        picker.close();
        $('edit-modal').hidden = true;
        unlock();
    };

    const renderStrip = () => {
        const draft = state.draft;
        const room = MAX_IMAGES - draft.images.length - draft.pending;

        const tiles = draft.images.map((image, i) => `
            <div class="strip-tile" data-index="${i}">
                <img src="${esc(image.url)}" alt="">
                ${i === 0 ? '<span class="strip-flag">Στο grid</span>' : `
                    <button class="strip-first" type="button" data-do="first" data-index="${i}">Κάν' την πρώτη</button>`}
                <button class="strip-x" type="button" data-do="drop" data-index="${i}" aria-label="Αφαίρεση">&times;</button>
            </div>
        `);

        for (let i = 0; i < draft.pending; i++) {
            tiles.push('<div class="strip-tile is-waiting"><span class="strip-spin" aria-hidden="true"></span></div>');
        }

        if (room > 0) {
            tiles.push(`
                <button class="strip-tile strip-add" type="button" data-do="add" data-picker>
                    <span aria-hidden="true">+</span>
                    <small>${draft.images.length ? 'Κι άλλη' : 'Εικόνα'}</small>
                </button>`);
        }

        $('edit-strip').innerHTML = tiles.join('');
    };

    // --- carrying a picture along the carousel ------------------------------
    // Which one is first is which one the grid shows, so their order is a
    // decision and not the order they happened to be chosen in. It is the same
    // gesture as everywhere else on this page, and it touches no server at all:
    // the strip is a list in a panel that has not been saved yet, so the order
    // travels with everything else when the post is.
    const strip = $('edit-strip');

    const carry = {
        index: null, pointer: null, touch: false,
        x: 0, y: 0, startX: 0, startY: 0,
        hold: null, ghost: null, active: false, moved: false
    };

    const tileAt = (x, y) => {
        const under = document.elementFromPoint(x, y);
        const tile = under ? under.closest('.strip-tile[data-index]') : null;
        return tile && Number(tile.dataset.index) !== carry.index ? tile : null;
    };

    const clearStripMarks = () => {
        strip.querySelectorAll('.is-before, .is-after')
            .forEach(one => one.classList.remove('is-before', 'is-after'));
    };

    // Which side of the tile under the pointer it is heading for. A strip runs
    // across rather than down, so it is the left or right half that decides.
    const stripGap = () => {
        const tile = tileAt(carry.x, carry.y);
        if (!tile) return null;
        const box = tile.getBoundingClientRect();
        return { tile, after: carry.x > box.left + box.width / 2 };
    };

    const markStripGap = () => {
        clearStripMarks();
        const spot = stripGap();
        if (spot) spot.tile.classList.add(spot.after ? 'is-after' : 'is-before');
    };

    const placeCarry = () => {
        if (carry.ghost) {
            carry.ghost.style.transform =
                `translate(${carry.x}px, ${carry.y}px) translate(-50%, -50%) scale(1.06)`;
        }
    };

    const liftTile = () => {
        const tile = strip.querySelector(`.strip-tile[data-index="${carry.index}"]`);
        const image = tile && tile.querySelector('img');
        if (!image) return;

        carry.active = true;
        carry.moved = true;
        knock(PICK_UP);
        tile.classList.add('is-lifting');
        document.body.classList.add('is-dragging-strip');

        const box = tile.getBoundingClientRect();
        carry.ghost = document.createElement('div');
        carry.ghost.className = 'strip-ghost';
        carry.ghost.style.width = `${box.width}px`;
        carry.ghost.style.height = `${box.height}px`;
        carry.ghost.innerHTML = `<img src="${esc(image.src)}" alt="">`;
        document.body.appendChild(carry.ghost);

        placeCarry();
        markStripGap();
    };

    const dropTile = (dropped) => {
        clearTimeout(carry.hold);
        if (carry.ghost) { carry.ghost.remove(); carry.ghost = null; }

        document.body.classList.remove('is-dragging-strip');
        strip.querySelectorAll('.is-lifting').forEach(one => one.classList.remove('is-lifting'));

        const spot = carry.active && dropped ? stripGap() : null;
        clearStripMarks();

        const from = carry.index;
        const wasActive = carry.active;

        carry.index = null;
        carry.pointer = null;
        carry.active = false;

        if (!wasActive || !spot || !state.draft) return;

        const onto = Number(spot.tile.dataset.index);
        let to = spot.after ? onto + 1 : onto;
        if (from < to) to -= 1;
        if (to === from) return;

        knock(PUT_DOWN);

        const images = state.draft.images;
        const [moved] = images.splice(from, 1);
        images.splice(to, 0, moved);
        renderStrip();
        landed(strip.querySelector(`.strip-tile[data-index="${to}"]`));
    };

    strip.addEventListener('pointerdown', (event) => {
        if (event.button > 0 || !state.draft) return;

        // The cross and the "make it first" button are buttons of their own,
        // and the square that adds one is not a picture yet.
        const tile = event.target.closest('.strip-tile[data-index]');
        if (!tile || event.target.closest('.strip-x, .strip-first')) return;

        carry.index = Number(tile.dataset.index);
        carry.pointer = event.pointerId;
        carry.touch = event.pointerType !== 'mouse';
        carry.startX = carry.x = event.clientX;
        carry.startY = carry.y = event.clientY;
        carry.moved = false;
        carry.active = false;

        strip.setPointerCapture(event.pointerId);
        if (carry.touch) carry.hold = setTimeout(liftTile, HOLD_MS);
    });

    strip.addEventListener('pointermove', (event) => {
        if (carry.pointer !== event.pointerId) return;

        carry.x = event.clientX;
        carry.y = event.clientY;

        const strayed = Math.hypot(carry.x - carry.startX, carry.y - carry.startY);

        if (!carry.active) {
            if (carry.touch) { if (strayed > TOUCH_SLOP) clearTimeout(carry.hold); }
            else if (strayed > MOUSE_SLOP) liftTile();
            return;
        }

        event.preventDefault();
        placeCarry();
        markStripGap();
    });

    strip.addEventListener('pointerup', (event) => {
        if (carry.pointer === event.pointerId) dropTile(true);
    });

    strip.addEventListener('pointercancel', (event) => {
        if (carry.pointer === event.pointerId) dropTile(false);
    });

    // A picture that was carried should not also count as a click on the tile.
    strip.addEventListener('click', (event) => {
        if (!carry.moved) return;
        carry.moved = false;
        event.stopPropagation();
        event.preventDefault();
    }, true);

    document.addEventListener('touchmove', (event) => {
        if (carry.active) event.preventDefault();
    }, { passive: false });

    $('edit-strip').addEventListener('click', (event) => {
        const button = event.target.closest('[data-do]');
        if (!button) return;

        const index = Number(button.dataset.index);

        if (button.dataset.do === 'add') {
            picker.open(button, { multiple: true, onFiles: editorFiles, onLink: editorLink });
            return;
        }

        if (button.dataset.do === 'drop') {
            // Only dropped from the draft. What is actually deleted from the
            // image store is decided on the server, once the post is saved and
            // it is clear which pictures nothing points at any more.
            state.draft.images.splice(index, 1);
            renderStrip();
            return;
        }

        if (button.dataset.do === 'first') {
            const [image] = state.draft.images.splice(index, 1);
            state.draft.images.unshift(image);
            renderStrip();
        }
    });

    // --- where is the picture coming from -----------------------------------
    // One answer to that question, shared by the post editor, the profile
    // picture and the highlights: a file on this machine, or an address
    // somewhere else. It only chooses. What happens to what it finds is the
    // caller's business, because each of them shows waiting in its own place.
    const picker = {
        onFiles: null,
        onLink: null,

        open(anchor, { multiple = false, onFiles, onLink }) {
            picker.onFiles = onFiles || null;
            picker.onLink = onLink || null;

            const box = $('picker');
            box.hidden = false;
            box.dataset.multiple = multiple ? '1' : '';
            $('picker-url').value = '';

            const at = anchor.getBoundingClientRect();
            const left = Math.min(at.left, window.innerWidth - box.offsetWidth - 12);
            const top = at.bottom + box.offsetHeight > window.innerHeight
                ? at.top - box.offsetHeight - 8
                : at.bottom + 8;

            box.style.left = `${Math.max(12, left) + window.scrollX}px`;
            box.style.top = `${Math.max(12, top) + window.scrollY}px`;
        },

        close() { $('picker').hidden = true; }
    };

    $('picker-file').addEventListener('click', () => {
        const many = $('picker').dataset.multiple === '1';
        const handler = picker.onFiles;
        picker.close();
        pickFiles(many, handler);
    });

    const takeLink = () => {
        const url = $('picker-url').value.trim();
        if (!url) return;
        const handler = picker.onLink;
        picker.close();
        if (handler) handler(url);
    };

    $('picker-add').addEventListener('click', takeLink);

    $('picker-url').addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        takeLink();
    });

    document.addEventListener('click', (event) => {
        if ($('picker').hidden) return;
        if (event.target.closest('#picker') || event.target.closest('[data-picker]')) return;
        picker.close();
    });

    // --- pictures in ------------------------------------------------------
    // A phone takes twelve-megapixel photographs and a grid cell is two hundred
    // pixels across. The browser redraws the picture at a sane size before any
    // of it goes over the wire, which is what keeps the upload quick and the
    // store small.
    // A thousand and eighty pixels is what Instagram itself serves for a
    // picture in the feed, so storing anything larger is storing detail that
    // nobody will ever be shown.
    const MAX_SIDE = 1080;
    const SMALL_SIDE = 480;     // a profile picture, shown at eighty
    const TARGET_BYTES = 2.6 * 1024 * 1024;

    // WebP is about a third smaller than JPEG at the same quality. A browser
    // that cannot write it does not say so: it quietly hands back a PNG, which
    // would be several times larger than what we started with. So it is asked
    // once, at the start, and answered by what comes out.
    const FORMAT = (() => {
        try {
            const probe = document.createElement('canvas');
            probe.width = probe.height = 1;
            return probe.toDataURL('image/webp').startsWith('data:image/webp')
                ? 'image/webp'
                : 'image/jpeg';
        } catch {
            return 'image/jpeg';
        }
    })();

    const loadImage = (file) => new Promise((resolve, reject) => {
        if (window.createImageBitmap) {
            // imageOrientation tells the browser to honour the EXIF rotation a
            // phone writes, instead of handing back a picture on its side.
            createImageBitmap(file, { imageOrientation: 'from-image' }).then(resolve).catch(() => fallback());
        } else fallback();

        function fallback() {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable')); };
            img.src = url;
        }
    });

    const draw = (source, quality, maxSide) => new Promise((resolve, reject) => {
        const width = source.width;
        const height = source.height;
        const scale = Math.min(1, maxSide / Math.max(width, height));
        const w = Math.max(1, Math.round(width * scale));
        const h = Math.max(1, Math.round(height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(source, 0, 0, w, h);

        canvas.toBlob(
            blob => blob ? resolve({ blob, w, h }) : reject(new Error('unreadable')),
            FORMAT,
            quality
        );
    });

    const shrink = async (file, maxSide = MAX_SIDE) => {
        const source = await loadImage(file);
        let quality = FORMAT === 'image/webp' ? 0.78 : 0.82;
        let out = await draw(source, quality, maxSide);

        // Very large photographs can still come out above what a request is
        // allowed to carry. Each pass costs quality rather than size, so the
        // picture keeps its dimensions and the grid keeps its sharpness.
        while (out.blob.size > TARGET_BYTES && quality > 0.5) {
            quality -= 0.12;
            out = await draw(source, quality, maxSide);
        }

        if (source.close) source.close();
        return out;
    };

    const asBase64 = (blob) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',').pop());
        reader.onerror = () => reject(new Error('unreadable'));
        reader.readAsDataURL(blob);
    });

    // The file dialog is one element serving several buttons, so whoever opened
    // it says what to do with what comes back.
    let waitingForFiles = null;

    const pickFiles = (multiple, handler) => {
        const input = $('file-input');
        input.multiple = Boolean(multiple);
        input.value = '';
        waitingForFiles = handler || null;
        input.click();
    };

    $('file-input').addEventListener('change', (event) => {
        const files = Array.from(event.target.files || []);
        const handler = waitingForFiles;
        waitingForFiles = null;
        if (files.length && handler) handler(files);
    });

    // Shrink it, send it, and hand back where it now lives. Every picture in
    // the portal comes through here, whichever way it was chosen, so one from a
    // link is stored exactly like one from the desktop and nothing downstream
    // has to know the difference.
    const acquire = async (source, maxSide, where) => {
        const { blob, w, h } = await shrink(source, maxSide);
        const data = await asBase64(blob);

        // A picture of a person hangs off no grid, and a client's square hangs
        // off no grid either. Everything else does and says which one, because
        // an admin may be looking at any of them. An id carries what it is in
        // its own prefix, which is where this reads it from.
        const belongs = where === 'me' ? { kind: 'me' }
            : String(where || '').startsWith('cli_') ? { kind: 'client', client: where }
            : { grid: where || (state.grid && state.grid.id) };

        const res = await api('/api/upload', {
            method: 'POST',
            body: { ...belongs, type: blob.type || FORMAT, data }
        });
        return { url: res.url, w, h };
    };

    // What is behind a link is fetched by the server, because a browser cannot
    // read back what it drew from another site, and because a Drive address is
    // a page with a viewer on it rather than a file.
    const download = async (url) => {
        const res = await fetch('/api/link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ grid: state.grid.id, url })
        });

        if (res.status === 401) { location.replace(LOGIN); throw new Error('not-signed-in'); }
        if (!res.ok) {
            const said = await res.json().catch(() => ({}));
            throw new Error(said.error || `HTTP ${res.status}`);
        }
        return res.blob();
    };

    const unreadable = (err, what) => err.message === 'unreadable'
        ? `${what} δεν διαβάζεται σαν εικόνα. Δοκίμασε JPG ή PNG.`
        : explain(err);

    // --- pictures into the post being edited --------------------------------
    const draftTakes = async (getSource, what) => {
        if (!state.draft) return;

        state.draft.pending++;
        renderStrip();

        try {
            const image = await acquire(await getSource());
            if (state.draft) state.draft.images.push(image);
        } catch (err) {
            sayEdit(unreadable(err, what));
        } finally {
            if (state.draft) {
                state.draft.pending = Math.max(0, state.draft.pending - 1);
                renderStrip();
            }
        }
    };

    const editorFiles = async (files) => {
        if (!state.draft) return;

        const room = MAX_IMAGES - state.draft.images.length - state.draft.pending;
        if (room <= 0) { sayEdit(`Ένα carousel παίρνει μέχρι ${MAX_IMAGES} εικόνες.`); return; }

        const taking = files.slice(0, room);
        if (files.length > room) sayEdit(`Μπήκαν οι ${room} πρώτες. Ένα carousel παίρνει μέχρι ${MAX_IMAGES}.`);
        else sayEdit('');

        // One after the other rather than all at once: the browser is drawing
        // each one on a canvas, and a phone doing eight of those together is a
        // phone that stops answering.
        for (const file of taking) {
            await draftTakes(() => file, `Η εικόνα "${file.name}"`);
        }
    };

    const editorLink = async (url) => {
        if (!state.draft) return;
        if (state.draft.images.length + state.draft.pending >= MAX_IMAGES) {
            sayEdit(`Ένα carousel παίρνει μέχρι ${MAX_IMAGES} εικόνες.`);
            return;
        }
        sayEdit('');
        await draftTakes(() => download(url), 'Το αρχείο στον σύνδεσμο');
    };

    $('edit-save').addEventListener('click', async () => {
        const draft = state.draft;
        if (!draft) return;

        if (draft.pending) { sayEdit('Περίμενε να ανέβουν οι εικόνες.'); return; }
        if (!draft.images.length) { sayEdit('Βάλε τουλάχιστον μία εικόνα.'); return; }

        busy('Αποθήκευση…');
        try {
            const making = draft.slot === null;

            const data = await api('/api/grid', {
                method: 'POST',
                body: {
                    id: state.grid.id,
                    action: making ? 'add-post' : 'save-post',
                    slot: making ? undefined : draft.slot,
                    images: draft.images,
                    caption: $('edit-caption').value
                }
            });

            // A new post arrives at the front, so the whole grid comes back
            // rather than one square of it.
            if (making) {
                state.posts = data.posts;
                state.grid.slots = data.slots;
            } else {
                state.posts[draft.slot] = data.post;
            }

            closeEditor();
            renderGrid();
            refreshBadge();
            toast('Αποθηκεύτηκε.');
        } catch (err) {
            sayEdit(explain(err));
        } finally {
            busy('');
        }
    });

    // --- the profile picture ------------------------------------------------
    // Not one of the twenty-four, so it is not a post: it is a property of the
    // grid, and it is replaced rather than added to.
    const MAX_HIGHLIGHTS = 12;

    const setAvatar = async (getSource) => {
        busy('Ανέβασμα…');
        try {
            const image = await acquire(await getSource(), SMALL_SIDE);
            const data = await api('/api/grid', {
                method: 'POST',
                body: { id: state.grid.id, action: 'set-avatar', url: image.url }
            });

            state.grid.avatar = data.avatar;
            const listed = state.grids.find(g => g.id === state.grid.id);
            if (listed) listed.avatar = data.avatar;

            renderGrid();
            toast('Η φωτογραφία προφίλ άλλαξε.');
        } catch (err) {
            toast(unreadable(err, 'Η εικόνα'), 'bad');
        } finally {
            busy('');
        }
    };

    $('profile-avatar').addEventListener('click', (event) => {
        if (!canEdit()) return;
        picker.open(event.currentTarget, {
            onFiles: (files) => setAvatar(() => files[0]),
            onLink: (url) => setAvatar(() => download(url))
        });
    });

    // --- highlights -----------------------------------------------------------
    // The circles under the bio. They hold nothing but a cover and a name: this
    // is a mockup of a profile, not a copy of one, and nothing opens.
    const renderHighlights = () => {
        const list = state.grid.highlights || [];
        const editing = canEdit();

        const circles = list.map(one => `
            <button class="hl" type="button" data-hl="${esc(one.id)}">
                <span class="hl-ring"><img src="${esc(one.url)}" alt="" loading="lazy"></span>
                <span class="hl-label">${esc(one.name)}</span>
            </button>
        `);

        if (editing && list.length < MAX_HIGHLIGHTS) {
            circles.push(`
                <button class="hl hl-new" type="button" data-hl="new">
                    <span class="hl-ring"><span class="hl-plus" aria-hidden="true">+</span></span>
                    <span class="hl-label">Νέο</span>
                </button>
            `);
        }

        $('highlights').innerHTML = circles.join('');
        $('highlights').hidden = !circles.length;
    };

    $('highlights').addEventListener('click', (event) => {
        const circle = event.target.closest('[data-hl]');
        if (!circle || !canEdit()) return;
        openHighlight(circle.dataset.hl === 'new' ? null : circle.dataset.hl);
    });

    const sayHl = (message) => {
        $('hl-error').textContent = message || '';
        $('hl-error').hidden = !message;
    };

    const renderHlCover = () => {
        const cover = state.highlight && state.highlight.url;
        $('hl-cover-img').hidden = !cover;
        $('hl-cover-plus').hidden = Boolean(cover);
        if (cover) $('hl-cover-img').src = cover;
        else $('hl-cover-img').removeAttribute('src');
    };

    const openHighlight = (id) => {
        const existing = (state.grid.highlights || []).find(one => one.id === id) || null;
        state.highlight = existing ? { ...existing } : { id: null, name: '', url: null };

        $('hl-title').textContent = existing ? 'Highlight' : 'Νέο highlight';
        $('hl-name').value = state.highlight.name;
        $('hl-delete').hidden = !existing;
        sayHl('');
        renderHlCover();

        $('hl-modal').hidden = false;
        document.body.classList.add('is-locked');
    };

    const closeHighlight = () => {
        state.highlight = null;
        $('hl-modal').hidden = true;
        unlock();
    };

    $('hl-cover').addEventListener('click', (event) => {
        const take = async (getSource) => {
            sayHl('');
            $('hl-cover').classList.add('is-waiting');
            try {
                const image = await acquire(await getSource(), SMALL_SIDE);
                if (!state.highlight) return;
                state.highlight.url = image.url;
                renderHlCover();
            } catch (err) {
                sayHl(unreadable(err, 'Η εικόνα'));
            } finally {
                $('hl-cover').classList.remove('is-waiting');
            }
        };

        picker.open(event.currentTarget, {
            onFiles: (files) => take(() => files[0]),
            onLink: (url) => take(() => download(url))
        });
    });

    const keepHighlights = (highlights) => {
        state.grid.highlights = highlights;
        const listed = state.grids.find(g => g.id === state.grid.id);
        if (listed) listed.highlights = highlights;
        renderHighlights();
    };

    $('hl-save').addEventListener('click', async () => {
        const draft = state.highlight;
        if (!draft) return;

        const name = $('hl-name').value.trim();
        if (!draft.url) { sayHl('Διάλεξε πρώτα εξώφυλλο.'); return; }
        if (!name) { sayHl('Γράψε ένα όνομα.'); return; }

        busy('Αποθήκευση…');
        try {
            const data = await api('/api/grid', {
                method: 'POST',
                body: {
                    id: state.grid.id, action: 'save-highlight',
                    highlight: draft.id || undefined, name, url: draft.url
                }
            });
            keepHighlights(data.highlights);
            closeHighlight();
            toast('Αποθηκεύτηκε.');
        } catch (err) {
            sayHl(explain(err));
        } finally {
            busy('');
        }
    });

    $('hl-delete').addEventListener('click', async () => {
        const draft = state.highlight;
        if (!draft || !draft.id) return;
        if (!confirm('Να διαγραφεί το highlight;')) return;

        busy('Διαγραφή…');
        try {
            const data = await api('/api/grid', {
                method: 'POST',
                body: { id: state.grid.id, action: 'delete-highlight', highlight: draft.id }
            });
            keepHighlights(data.highlights);
            closeHighlight();
            toast('Διαγράφηκε.');
        } catch (err) {
            sayHl(explain(err));
        } finally {
            busy('');
        }
    });

    // --- the eye on a password box ------------------------------------------
    // A password typed here is going to be read out to somebody, so being able
    // to check it before it is saved is worth more than the shoulder it could
    // be read over. It shows what is being typed now, never what was set
    // before: the server keeps a hash of that and cannot hand it back.
    document.addEventListener('click', (event) => {
        const eye = event.target.closest('.pw-eye');
        if (!eye) return;

        const field = eye.closest('.pw-field').querySelector('input');
        const show = field.type === 'password';
        field.type = show ? 'text' : 'password';
        eye.setAttribute('aria-pressed', show ? 'true' : 'false');
        eye.setAttribute('aria-label', show ? 'Απόκρυψη κωδικού' : 'Εμφάνιση κωδικού');
    });

    // --- closing things ----------------------------------------------------
    document.querySelectorAll('[data-close]').forEach(button => {
        button.addEventListener('click', () => {
            if (button.closest('#edit-modal')) closeEditor();
            else if (button.closest('#hl-modal')) closeHighlight();
            else if (button.closest('#acct-modal')) closeDrawer();
            else if (button.closest('#me-modal')) closeMe();
            else if (button.closest('#money-modal')) closeMoney();
            else closeViewer();
        });
    });

    // Whether a keystroke belongs to a box somebody is typing in. Undo inside
    // one of those is the browser's own, undoing the typing, and taking it
    // would be maddening.
    const typing = () => {
        const on = document.activeElement;
        return Boolean(on) && (on.isContentEditable
            || ['INPUT', 'TEXTAREA', 'SELECT'].includes(on.tagName));
    };

    document.addEventListener('keydown', (event) => {
        // event.code rather than event.key, because on a Greek layout the same
        // key says ζ and the shortcut is the key, not the letter on it.
        if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey
            && (event.code === 'KeyZ' || String(event.key).toLowerCase() === 'z')) {
            if (typing()) return;
            event.preventDefault();
            undo();
            return;
        }

        if (event.key === 'Escape') {
            if (!$('me-menu').hidden) closeMeMenu();
            else if (!$('bell-panel').hidden) closeBell();
            else if (!$('me-modal').hidden) closeMe();
            else if (!$('picker').hidden) picker.close();
            else if (!$('acct-modal').hidden) closeDrawer();
            else if (!$('hl-modal').hidden) closeHighlight();
            else if (!$('edit-modal').hidden) closeEditor();
            else if (!$('post-modal').hidden) closeViewer();
            else if (drag.active) letGo(false);
            else if (state.moving !== null) cancelMove();
            closeMenu();
            return;
        }

        if (!$('post-modal').hidden && state.viewing) {
            const post = state.posts[state.viewing.slot];
            if (post && post.images.length > 1) {
                if (event.key === 'ArrowLeft') goTo(state.viewing.index - 1);
                if (event.key === 'ArrowRight') goTo(state.viewing.index + 1);
            }
        }
    });

    // --- your own face ------------------------------------------------------
    // The account block at the foot of the sidebar is where somebody already
    // looks to see themselves, so it is where they change how they look. It is
    // reachable from every screen and needs no navigating to, which is more
    // than a settings page anywhere else would manage.
    const paintFace = (node, who, klass) => {
        const picture = who && (who.avatar || who.icon);
        node.className = `${klass}${picture ? ' has-photo' : ''}`;
        node.style.setProperty('--face', toneOf(who && who.id));
        node.innerHTML = picture
            ? `<img src="${esc(picture)}" alt="">`
            : esc(initials(who && who.name));
    };

    const sayMe = (message) => {
        $('me-error').textContent = message || '';
        $('me-error').hidden = !message;
    };

    // What the panel is showing before anything has been saved. undefined means
    // the picture has not been touched, so a save leaves it alone.
    const meDraft = { avatar: undefined };

    const myFace = () => (meDraft.avatar === undefined ? state.me.avatar : meDraft.avatar);

    const renderMe = () => {
        paintFace($('me-avatar'), state.me, 'app-avatar');
        paintFace($('me-face'), { id: state.me.id, name: $('me-name-field').value || state.me.name,
                                  avatar: myFace() }, 'face-big');
        $('me-clear').hidden = !myFace();
    };

    const closeMe = () => {
        meDraft.avatar = undefined;
        $('me-modal').hidden = true;
        unlock();
    };

    const openMe = () => {
        meDraft.avatar = undefined;
        sayMe('');
        $('me-name-field').value = state.me.name;
        $('me-who').textContent =
            `Μπαίνεις ως @${state.me.username}. Το όνομα χρήστη και ο ρόλος σου αλλάζουν μόνο από τον διαχειριστή.`;
        renderMe();
        $('me-modal').hidden = false;
        document.body.classList.add('is-locked');
    };

    // --- the menu at the foot of the sidebar ---------------------------------
    // The row was a label as far as anybody could tell. A gear on it says it
    // does something, and what it does is behind one press rather than behind
    // a guess.
    const closeMeMenu = () => {
        $('me-menu').hidden = true;
        $('me-open').setAttribute('aria-expanded', 'false');
    };

    $('me-open').addEventListener('click', () => {
        const open = $('me-menu').hidden;
        $('me-menu').hidden = !open;
        $('me-open').setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    $('me-settings').addEventListener('click', () => { closeMeMenu(); openMe(); });

    document.addEventListener('click', (event) => {
        if (!$('me-menu').hidden && !event.target.closest('.app-me')) closeMeMenu();
    });

    // --- saving ---------------------------------------------------------------
    $('me-pick').addEventListener('click', () => {
        pickFiles(false, async (files) => {
            sayMe('');
            busy('Ανέβασμα…');
            try {
                const { url } = await acquire(files[0], SMALL_SIDE, 'me');
                meDraft.avatar = url;
                renderMe();
            } catch (err) {
                sayMe(explain(err));
            } finally {
                busy('');
            }
        });
    });

    $('me-clear').addEventListener('click', () => {
        meDraft.avatar = null;
        renderMe();
    });

    $('me-name-field').addEventListener('input', renderMe);

    $('me-save').addEventListener('click', async () => {
        sayMe('');
        busy('Αποθήκευση…');

        const sent = { name: $('me-name-field').value };
        // A picture nobody touched is not sent, so nothing is replaced and the
        // old one is not deleted out from under it.
        if (meDraft.avatar !== undefined) sent.avatar = meDraft.avatar;

        try {
            const data = await api('/api/session', { method: 'PATCH', body: sent });
            state.me = data.user;

            closeMe();
            $('me-name').textContent = state.me.name;
            paintFace($('me-avatar'), state.me, 'app-avatar');
            toast('Αποθηκεύτηκε.');

            // Wherever else this account is drawn on the screen it is standing on.
            if (!$('view-accounts').hidden) openAccounts();
            if (!$('view-chat').hidden) renderChatList();
        } catch (err) {
            sayMe(explain(err));
        } finally {
            busy('');
        }
    });

    // --- the bell ----------------------------------------------------------
    // What everybody else did on the grids this account is on. The server
    // decides which events those are and leaves out this account's own, so
    // there is nothing to filter here.
    const EVENT_WORDS = {
        post:   'πρόσθεσε μια ανάρτηση',
        edit:   'άλλαξε μια ανάρτηση',
        delete: 'διέγραψε μια ανάρτηση',
        note:   'σχολίασε',
        reply:  'απάντησε σε ένα σχόλιο',
        like:   'έκανε λάικ σε μια φωτογραφία',
        chat:   'έγραψε στη συζήτηση του project',
        dm:     'σου έστειλε προσωπικό μήνυμα',
        link:   'πρόσθεσε έναν χρήσιμο σύνδεσμο',
        idea:   'πρόσθεσε μια ιδέα στο brainstorming'
    };

    // A deleted post has no picture left to show, so its line gets the same
    // outline the empty squares on the grid use.
    const NO_THUMB = '<svg viewBox="0 0 24 24" aria-hidden="true">'
        + '<rect x="3" y="3" width="18" height="18" rx="3"/>'
        + '<path d="M3 15l5-5 4 4 3-3 6 6"/></svg>';

    // What has no picture to show gets the shape of the thing it was instead.
    const SAID_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true">'
        + '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-3.8-.9L3 20.5l1.5-4.6A8.4 8.4 0 0 1 3.6 12a8.4 '
        + '8.4 0 0 1 8.4-8.5h.5a8.4 8.4 0 0 1 8.5 8z"/></svg>';

    const IDEA_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true">'
        + '<path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg>';

    const BELL_ICONS = {
        chat: SAID_ICON,
        dm: SAID_ICON,
        idea: IDEA_ICON,
        link: '<svg viewBox="0 0 24 24" aria-hidden="true">'
            + '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/>'
            + '<path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>'
    };

    const renderBell = () => {
        $('bell-dot').hidden = !state.unread;
        $('bell-dot').textContent = state.unread > 9 ? '9+' : String(state.unread || '');

        const list = $('bell-list');

        if (!state.feed.length) {
            list.innerHTML = '<li class="bell-none">Τίποτα καινούριο ακόμα.</li>';
            return;
        }

        list.innerHTML = state.feed.map((event, i) => `
            <li>
                <button class="bell-item${i < state.unread ? ' is-new' : ''}" type="button"
                        data-event="${esc(event.id)}">
                    <span class="bell-thumb">${event.image
                        ? `<img src="${esc(event.image)}" alt="" loading="lazy" onerror="this.hidden = true">`
                        : BELL_ICONS[event.kind] || NO_THUMB}</span>
                    <span class="bell-said">
                        <span class="bell-what"><strong>${esc(event.actorName)}</strong> ${
                            esc(EVENT_WORDS[event.kind] || 'άλλαξε κάτι')}${
                            event.text ? `: «${esc(event.text)}»` : '.'}</span>
                        <small class="bell-when">${event.gridName
                            ? `${esc(event.gridName)} · ` : ''}${esc(ago(event.at))}</small>
                    </span>
                </button>
            </li>
        `).join('');
    };

    const loadFeed = async () => {
        try {
            const data = await api('/api/feed');
            state.feed = data.events || [];
            state.unread = data.unread || 0;
        } catch {
            // A bell that cannot be filled is not worth a message over the top
            // of whatever the page is actually doing.
            return;
        }
        renderBell();
    };

    const closeBell = () => {
        $('bell-panel').hidden = true;
        $('bell').setAttribute('aria-expanded', 'false');
    };

    $('bell').addEventListener('click', async () => {
        if (!$('bell-panel').hidden) { closeBell(); return; }

        $('bell-panel').hidden = false;
        $('bell').setAttribute('aria-expanded', 'true');
        renderBell();

        // Opening the bell is reading it. The lines that were new keep their
        // tint until it is closed, so what arrived is still obvious.
        if (!state.unread) return;
        try { await api('/api/feed', { method: 'POST', body: { action: 'seen' } }); }
        catch { /* it will be marked read on the next opening */ }
        state.unread = 0;
        $('bell-dot').hidden = true;
    });

    // Clicking a line goes to the thing it is about: the right grid, the right
    // post, and in a carousel the very picture that was liked.
    $('bell-list').addEventListener('click', async (clicked) => {
        const item = clicked.target.closest('.bell-item');
        if (!item) return;

        const event = state.feed.find(one => one.id === item.dataset.event);
        if (!event) return;
        closeBell();

        // A message opens the conversation it was written in, on the side of it
        // that the reader belongs to.
        if (['chat', 'dm', 'link', 'idea'].includes(event.kind)) {
            await openChat(event.kind === 'dm'
                ? { kind: 'dm', id: event.actorId }
                : { kind: 'team', id: event.gridId });

            if (event.kind === 'link') showTab('links');
            if (event.kind === 'idea') showTab('ideas');
            return;
        }

        if (!state.grid || state.grid.id !== event.gridId) await openGrid(event.gridId);
        if (!state.grid || state.grid.id !== event.gridId) return;

        // A post moves around the grid, so it is found by its own id first and
        // by the square it was in only as a fallback.
        let slot = state.posts.findIndex(post => post && post.id === event.postId);
        if (slot < 0 && typeof event.slot === 'number' && state.posts[event.slot]) slot = event.slot;
        if (slot < 0) { toast('Η ανάρτηση δεν υπάρχει πια.'); return; }

        const images = state.posts[slot].images || [];
        const at = event.image ? images.findIndex(img => img.url === event.image) : -1;
        openViewer(slot, at < 0 ? 0 : at);
    });

    document.addEventListener('click', (event) => {
        if (!$('bell-panel').hidden && !event.target.closest('.bell-wrap')) closeBell();
    });

    // Nothing pushes from the server, so the bell asks. Once a minute while the
    // tab is in front, and once on coming back to it, which is when somebody
    // actually looks.
    setInterval(() => { if (!document.hidden) loadFeed(); }, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) loadFeed(); });

    // --- still here ---------------------------------------------------------
    // Being online means having the portal open, not having it in front of you,
    // so this one goes on whether the tab is being looked at or not. It is the
    // only thing on the page that does.
    //
    // A browser throttles the timers of a tab that is behind another one to
    // roughly one a minute, so the window the server counts as being here is
    // wide enough to forgive a beat that ran late.
    // A GET here says who is signed in, and saying so is what being at your
    // screen means, so the answer is thrown away and only the asking counts.
    const stillHere = () => {
        api('/api/session').catch(() => { /* the next beat */ });
    };

    // The first beat is the sign-in check itself, which stamps it on the way
    // past, so this one starts a beat later.
    setInterval(stillHere, 45000);

    // Coming back to the tab says it at once rather than waiting for the beat,
    // which matters on a phone, where a tab that was put away has had its
    // timers stopped rather than slowed.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) stillHere(); });

    // --- messages ----------------------------------------------------------
    // Two kinds of conversation and neither of them belongs to whichever grid
    // happens to be open. A project thread names its project and a private one
    // names a person; somebody on four projects should not have to remember
    // which one they were standing in when they last wrote to somebody, which
    // is a question about this portal's plumbing rather than about their work.
    const TEAM_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true">'
        + '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>'
        + '<path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>';

    const LOCK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true">'
        + '<rect x="3" y="11" width="18" height="11" rx="2"/>'
        + '<path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

    const NOTES = {
        teams: 'Τις διαβάζουν όλοι όσοι δουλεύουν στο project.',
        people: 'Τα βλέπετε μόνο εσείς οι δύο.'
    };

    // The grid of the project thread that is open, and nothing when the open
    // conversation is a private one. The links and the brainstorming hang off
    // it, and neither of those belongs to two people.
    const chatGridId = () => {
        const open = state.chat.open;
        return open && open.kind === 'team' ? open.id : null;
    };

    const count = (list) => list.reduce((sum, one) => sum + (one.unread || 0), 0);
    const chatTotal = () => count(state.chat.teams) + count(state.chat.people);

    // The last thing said in a conversation, signed the way a list signs it.
    const lastLine = (last) =>
        `${last.userId === state.me.id ? 'Εσύ' : last.name}: ${last.text}`;

    const renderChatBadge = () => {
        const total = chatTotal();
        $('nav-chat').hidden = !state.grids.length;
        $('nav-chat').classList.toggle('has-new', Boolean(total));
        $('nav-chat-badge').hidden = !total;
        $('nav-chat-badge').textContent = total > 99 ? '99+' : String(total || '');
    };

    const sameThread = (a, b) => Boolean(a && b && a.kind === b.kind && a.id === b.id);

    // Whether a conversation is covering the list, which on a phone is what
    // decides whether the app's own bar is in the way. Said in one place so
    // that it is never said twice differently.
    const inRoom = (on) => {
        $('view-chat').classList.toggle('is-open', on);
        document.body.classList.toggle('is-inroom',
            on && matchMedia('(max-width: 900px)').matches);

        // Opening one changes what is on the screen above the box, so the size
        // is worked out before this is painted and checked again once it is.
        if (on) { fitToKeyboard(true); settle(); }
    };

    const renderChatList = () => {
        const c = state.chat;

        // A dot on the tab that has something waiting, so the other kind is
        // never the one being missed.
        document.querySelectorAll('#chat-kinds button').forEach(button => {
            const kind = button.dataset.kind;
            const on = kind === c.kind;
            button.classList.toggle('is-on', on);
            button.setAttribute('aria-selected', on ? 'true' : 'false');
            button.querySelector('.chat-pip').hidden = !count(kind === 'teams' ? c.teams : c.people);
        });

        $('chat-note').textContent = NOTES[c.kind];

        const rows = c.kind === 'teams'
            ? c.teams.map(one => ({
                open: { kind: 'team', id: one.id },
                // Its own square if the admin gave it one, and the mark of a
                // group if not. An initial here would say nothing the name
                // beside it does not already say.
                face: one.icon
                    ? faceOf(one, 'chat-face is-team', '')
                    : `<span class="chat-face is-team">${TEAM_ICON}</span>`,
                name: one.name,
                under: one.last ? esc(lastLine(one.last)) : 'Όλη η ομάδα του project',
                unread: one.unread, more: one.more
            }))
            : c.people.map(one => ({
                open: { kind: 'dm', id: one.id },
                face: faceOf(one, 'chat-face', dot(one)),
                name: one.name,
                under: one.last ? esc(lastLine(one.last)) : `${ROLE_NAMES[one.role] || ''}`,
                unread: one.unread, more: one.more
            }));

        $('chat-list').innerHTML = rows.length
            ? rows.map(row => `
                <button class="chat-pick${sameThread(c.open, row.open) ? ' is-on' : ''}${row.unread ? ' has-new' : ''}"
                        type="button" data-kind="${row.open.kind}" data-id="${esc(row.open.id)}">
                    ${row.face}
                    <span class="chat-pick-text">
                        <strong>${esc(row.name)}</strong>
                        <small>${row.under}</small>
                    </span>
                    ${row.unread ? `<span class="chat-count">${row.unread}${row.more ? '+' : ''}</span>` : ''}
                </button>`).join('')
            : `<p class="chat-none">${c.kind === 'teams'
                ? 'Δεν είσαι σε κανένα project ακόμα.'
                : 'Δεν υπάρχει άλλος να του γράψεις ακόμα.'}</p>`;

        renderChatBadge();
    };

    const openTeam = () => state.chat.teams.find(one => one.id === state.chat.open.id) || null;
    const openPerson = () => state.chat.people.find(one => one.id === state.chat.open.id) || null;

    // Written on one line on purpose: a bubble keeps the spaces it is given, so
    // the tidy indentation this would otherwise have would be a blank line
    // above every answer.
    const quoted = (message) => !message.replyTo ? ''
        : `<button class="chat-quote" type="button" data-do="find" data-at="${esc(message.replyTo.id)}">`
          + `<strong>${esc(message.replyTo.name)}</strong>`
          + `<span>${esc(message.replyTo.text)}</span></button>`;

    const renderRoom = () => {
        const c = state.chat;
        if (!c.open) return;

        const team = c.open.kind === 'team';
        const who = team ? openTeam() : openPerson();
        const name = who ? who.name : '';
        const live = Boolean(!team && who && who.online);

        $('chat-head-face').className = `chat-head-face${team ? ' is-team' : ''}${
            who && (who.avatar || who.icon) ? ' has-photo' : ''}`;
        $('chat-head-face').style.setProperty('--face', toneOf(c.open.id));
        $('chat-head-face').innerHTML = who && (who.avatar || who.icon)
            ? `<img src="${esc(who.avatar || who.icon)}" alt="">${team ? '' : dot(who)}`
            : (team ? TEAM_ICON : `${esc(initials(name))}${dot(who || {})}`);

        $('chat-head-name').textContent = name;

        $('chat-head-who').className = live ? 'is-live' : '';
        $('chat-head-who').textContent = team
            ? 'Όλη η ομάδα του project'
            : who ? here(who) : 'Προσωπικό μήνυμα';

        // The sentence that says who is reading, and how long it is kept. It
        // stays on screen for as long as the conversation does, because
        // forgetting which of the two you are in is the one mistake this screen
        // exists to prevent.
        const KEPT = 'Τα μηνύματα σβήνονται μετά από έναν μήνα.';

        $('chat-banner').className = `chat-banner ${team ? 'is-team' : 'is-private'}`;
        $('chat-banner').innerHTML = team
            ? `${TEAM_ICON}<span>Το διαβάζουν <strong>όλοι</strong> όσοι δουλεύουν στο ${esc(name)}.<span class="chat-kept"> ${KEPT}</span></span>`
            : `${LOCK_ICON}<span>Ιδιωτικό. Το βλέπετε <strong>μόνο εσύ και ${esc(name)}</strong>.<span class="chat-kept"> ${KEPT}</span></span>`;

        $('chat-text').placeholder = team
            ? 'Γράψε σε όλη την ομάδα'
            : `Γράψε στον/στην ${name}`;

        // Links and ideas are a project's. A private conversation has none of
        // them, so opening one puts the talk back in front rather than leaving
        // somebody looking at a wall of notes with a padlock over it.
        $('room-tabs').hidden = !team;
        if (!team && tab !== 'talk') {
            tab = 'talk';
            ['talk', 'links', 'ideas'].forEach(one => { $(`pane-${one}`).hidden = one !== 'talk'; });
        }

        const log = $('chat-log');

        // On its way. Whatever was in here belonged to the conversation before
        // this one, and the line about nobody having written yet belongs to no
        // conversation at all until the answer says so.
        if (c.loading) {
            log.innerHTML = '<li class="chat-wait"><span></span><span></span><span></span></li>';
            return;
        }

        // Somebody who has scrolled up to read yesterday stays there. Somebody
        // already at the bottom is carried down to whatever just arrived, and
        // an empty log counts as at the bottom, which is how a conversation
        // opens on its most recent line.
        const atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 80;

        if (!c.messages.length) {
            log.innerHTML = `<li class="chat-empty">${team
                ? 'Κανείς δεν έχει γράψει ακόμα εδώ. Ό,τι γράψεις το βλέπει όλη η ομάδα του project.'
                : 'Δεν έχετε ανταλλάξει μήνυμα ακόμα. Ό,τι γράψεις εδώ το βλέπετε μόνο εσείς οι δύο.'}</li>`;
            return;
        }

        let day = '';
        let before = null;

        log.innerHTML = c.messages.map(message => {
            const mine = message.userId === state.me.id;
            const its = dayOf(message.at);
            const newDay = its !== day;
            if (newDay) day = its;

            // A run of messages from the same person on the same day is signed
            // once, at the top, the way every other messenger does it.
            const signed = team && !mine && (newDay || !before || before.userId !== message.userId);
            before = message;

            return `
                ${newDay ? `<li class="chat-day">${esc(its)}</li>` : ''}
                <li class="chat-msg${mine ? ' is-mine' : ''}" data-message="${esc(message.id)}">
                    <button class="chat-more" type="button" data-do="more"
                            aria-label="Τι να γίνει με αυτό το μήνυμα">
                        <span></span><span></span><span></span>
                    </button>
                    <div class="chat-said">
                        ${signed ? `<p class="chat-name">${esc(message.name)}</p>` : ''}
                        <div class="chat-bubble">${quoted(message)}${esc(message.text)}</div>
                        <p class="chat-foot"><span>${esc(clock(message.at))}</span></p>
                    </div>
                </li>`;
        }).join('');

        if (atEnd) log.scrollTop = log.scrollHeight;
    };

    // What the next message will be answering, said over the box it is typed
    // in so that nobody sends one without seeing what it is attached to.
    const renderAnswering = () => {
        const one = state.chat.answering;

        $('chat-answering').hidden = !one;
        if (!one) return;

        $('chat-answering-who').textContent = `Απάντηση σε ${one.name}`;
        $('chat-answering-said').textContent = one.text;
    };

    const answer = (id) => {
        const said = state.chat.messages.find(one => one.id === id);
        if (!said) return;

        state.chat.answering = { id, name: said.name, text: said.text };
        renderAnswering();
        $('chat-text').focus();
    };

    // Going to the one an answer is answering, and saying so when it arrives:
    // a jump with nothing marked at the end of it looks like a mistake.
    const findMessage = (id) => {
        const row = $('chat-log').querySelector(`[data-message="${CSS.escape(id)}"]`);

        if (!row) { toast('Το μήνυμα δεν υπάρχει πια.'); return; }

        row.scrollIntoView({ block: 'center', behavior: 'smooth' });
        row.classList.remove('is-found');
        void row.offsetWidth;
        row.classList.add('is-found');
    };

    // --- what a message can be asked -----------------------------------------
    // Held down on a touch screen, and behind three dots on hover everywhere
    // else. Two spelled-out buttons under every message was a wall of words
    // that had nothing to do with the conversation.
    const msgMenu = document.createElement('div');
    msgMenu.className = 'msg-menu';
    msgMenu.hidden = true;
    document.body.appendChild(msgMenu);

    const closeMsgMenu = () => {
        msgMenu.hidden = true;
        const asked = $('chat-log').querySelector('.is-asked');
        if (asked) asked.classList.remove('is-asked');
    };

    const openMsgMenu = (row, x, y) => {
        const id = row.dataset.message;
        const said = state.chat.messages.find(one => one.id === id);
        if (!said) return;

        closeMsgMenu();
        row.classList.add('is-asked');

        msgMenu.innerHTML = `
            <button type="button" data-do="answer">Απάντηση</button>
            <button type="button" data-do="copy">Αντιγραφή</button>
            ${said.userId === state.me.id
                ? '<button type="button" data-do="unsay" class="is-danger">Διαγραφή</button>' : ''}
        `;
        msgMenu.dataset.message = id;
        msgMenu.dataset.at = String(Date.now());
        msgMenu.hidden = false;

        // Above the finger where there is room and below it where there is
        // not, and never off the side of the screen.
        const wide = msgMenu.offsetWidth;
        const tall = msgMenu.offsetHeight;

        const left = Math.min(Math.max(10, x - wide / 2), window.innerWidth - wide - 10);
        const top = y - tall - 12 < 10 ? y + 14 : y - tall - 12;

        msgMenu.style.left = `${left}px`;
        msgMenu.style.top = `${Math.max(10, top)}px`;
    };

    // A right click means the same thing on a machine that has one. Only on
    // one that has one: a long press on a touch screen belongs to the system,
    // which puts its own copy-and-select menu up, and two menus arriving
    // together are worse than neither.
    if (matchMedia('(hover: hover)').matches) {
        $('chat-log').addEventListener('contextmenu', (event) => {
            const row = event.target.closest('.chat-msg');
            if (!row) return;
            event.preventDefault();
            openMsgMenu(row, event.clientX, event.clientY);
        });
    }

    msgMenu.addEventListener('click', (clicked) => {
        const button = clicked.target.closest('button[data-do]');
        if (!button) return;

        const id = msgMenu.dataset.message;
        const said = state.chat.messages.find(one => one.id === id);
        closeMsgMenu();
        if (!said) return;

        if (button.dataset.do === 'answer') { answer(id); return; }

        if (button.dataset.do === 'copy') {
            try { navigator.clipboard.writeText(said.text); toast('Αντιγράφηκε.'); }
            catch { toast('Δεν έγινε η αντιγραφή.', 'bad'); }
            return;
        }

        if (button.dataset.do === 'unsay') unsay(id);
    });

    document.addEventListener('click', (event) => {
        if (msgMenu.hidden || event.target.closest('.msg-menu')) return;

        // The press that opened it often ends in a click of its own, and that
        // click would shut it again before anybody saw it.
        if (Date.now() - Number(msgMenu.dataset.at || 0) < 350) return;

        closeMsgMenu();
    });

    $('chat-answering-drop').addEventListener('click', () => {
        state.chat.answering = null;
        renderAnswering();
    });

    // What a conversation is asked for by.
    const asks = (open) => open.kind === 'team'
        ? `grid=${encodeURIComponent(open.id)}`
        : `with=${encodeURIComponent(open.id)}`;

    // Opening a conversation is reading it, so the count beside it goes.
    const markRead = async (open) => {
        try {
            await api('/api/chat', {
                method: 'POST',
                body: open.kind === 'team' ? { grid: open.id, action: 'seen' } : { with: open.id, action: 'seen' }
            });
        } catch { /* it will be marked on the next opening */ }
    };

    const lastId = (messages) => (messages.length ? messages[messages.length - 1].id : null);

    const shown = (open) => {
        if (!open) return null;
        const row = (open.kind === 'team' ? state.chat.teams : state.chat.people)
            .find(one => one.id === open.id);
        return row ? Boolean(row.online) : null;
    };

    const openThread = async (open, { quiet = false, reveal = true } = {}) => {
        if (!open) return;

        const c = state.chat;
        const before = lastId(c.messages);
        const wasLive = shown(open);
        const swapped = !sameThread(c.open, open);

        c.open = open;
        c.gridId = chatGridId();
        if (!quiet) where.write('chat', open.kind, open.id);

        // Another conversation's messages are not this one's, so they go the
        // moment it is asked for rather than when the answer arrives.
        if (swapped && !quiet) {
            c.messages = [];
            c.loading = true;
            c.answering = null;
            renderAnswering();
        }

        // A quiet refresh never moves the screen. Somebody scrolled up reading
        // yesterday, or back on the list on a phone, stays where they are.
        if (!quiet) {
            if (reveal) inRoom(true);
            renderChatList();
            renderRoom();
        }

        let data;
        try {
            data = await api(`/api/chat?${asks(open)}`);
        } catch (err) {
            c.loading = false;
            if (!quiet) { toast(explain(err), 'bad'); renderRoom(); }
            return;
        }

        c.loading = false;
        c.messages = data.messages || [];

        // What the list says about this one is now known first hand.
        const row = (open.kind === 'team' ? c.teams : c.people).find(one => one.id === open.id);
        if (row) {
            row.unread = 0;
            row.more = false;
            if (data.withUser) { row.online = data.withUser.online; row.seenAt = data.withUser.seenAt; }
            if (data.messages && data.messages.length) {
                const last = data.messages[data.messages.length - 1];
                row.last = { at: last.at, text: last.text, userId: last.userId, name: last.name };
            }
        }

        const changed = lastId(c.messages) !== before || shown(open) !== wasLive;

        // Reading is what clears a conversation's count, and a refresh that
        // brought nothing new is not a fresh reading: it would write the store
        // every fifteen seconds for nobody.
        if (!quiet || changed) await markRead(open);

        renderChatList();
        if (!quiet || changed || swapped) renderRoom();
    };

    // Every conversation this account has, which is what the list is made of.
    const loadChats = async () => {
        const shut = $('view-chat').hidden;

        try {
            const data = await api(`/api/chat${shut ? '?only=counts' : ''}`);
            state.chat.teams = data.teams || [];
            state.chat.people = data.people || [];
        } catch {
            return;
        }

        renderChatBadge();
        // The list only. Whatever is open on the right is the business of
        // openThread, which knows whether anything in it actually changed.
        if (!shut) renderChatList();
    };

    const openChat = async (open = null) => {
        // Arriving at messages arrives at the talk of whatever is opened.
        tab = 'talk';
        $('app-title').textContent = 'Μηνύματα';
        showView('chat');
        document.querySelectorAll('.app-nav-item').forEach(item => {
            item.classList.toggle('is-on', item.dataset.view === 'chat');
        });

        // On a phone the list comes first and a conversation covers it, so
        // arriving here without one named shows the list.
        const phone = matchMedia('(max-width: 900px)').matches;
        inRoom(Boolean(open));

        // The list on its own is a screen of its own; a conversation names
        // itself as well, so a refresh comes back inside it.
        where.write('chat', open && open.kind, open && open.id);

        busy('Φόρτωση…');
        try {
            await loadChats();

            // A wide screen shows both at once, so the first conversation is
            // opened behind the list rather than leaving half of it blank. A
            // phone shows one thing at a time and the thing asked for was the
            // list, so nothing is opened and nothing flashes past.
            const first = open
                || (phone ? null
                    : (state.chat.teams[0] && { kind: 'team', id: state.chat.teams[0].id })
                      || (state.chat.people[0] && { kind: 'dm', id: state.chat.people[0].id }))
                || null;

            if (!first) { state.chat.open = null; state.chat.gridId = null; renderChatList(); return; }

            state.chat.kind = first.kind === 'team' ? 'teams' : 'people';

            // Revealed only when this is the conversation somebody asked for.
            await openThread(first, { reveal: Boolean(open) });
        } finally {
            busy('');
        }
    };

    $('chat-kinds').addEventListener('click', (clicked) => {
        const button = clicked.target.closest('button[data-kind]');
        if (!button) return;
        state.chat.kind = button.dataset.kind;
        renderChatList();
    });

    $('chat-list').addEventListener('click', (clicked) => {
        const pick = clicked.target.closest('button[data-kind]');
        if (pick) openThread({ kind: pick.dataset.kind, id: pick.dataset.id });
    });

    $('chat-back').addEventListener('click', () => {
        inRoom(false);
        where.write('chat');
    });

    const say = async () => {
        const box = $('chat-text');
        const said = box.value.trim();
        if (!said || !state.chat.open) return;

        const open = state.chat.open;
        const answering = state.chat.answering;

        box.value = '';
        box.style.height = 'auto';
        $('chat-send').disabled = true;
        state.chat.answering = null;
        renderAnswering();

        try {
            const data = await api('/api/chat', {
                method: 'POST',
                body: {
                    ...(open.kind === 'team' ? { grid: open.id } : { with: open.id }),
                    text: said,
                    replyTo: answering ? answering.id : undefined
                }
            });
            state.chat.messages = data.messages || state.chat.messages.concat(data.message);
            renderRoom();
        } catch (err) {
            box.value = said;
            state.chat.answering = answering;
            renderAnswering();
            toast(explain(err), 'bad');
        } finally {
            $('chat-send').disabled = false;
            box.focus();
        }
    };

    $('chat-form').addEventListener('submit', (event) => { event.preventDefault(); say(); });

    // Enter sends and shift with it breaks the line, which is what everybody
    // already has in their fingers. A phone keyboard has no shift worth using,
    // so there the button is the way.
    $('chat-text').addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey && !matchMedia('(max-width: 900px)').matches) {
            event.preventDefault();
            say();
        }
    });

    // The box grows with what is written in it, up to the height the stylesheet
    // allows, and then scrolls. Growing takes room from the messages above, so
    // the last of them is kept in sight.
    const growBox = () => {
        const box = $('chat-text');
        box.style.height = 'auto';
        box.style.height = `${box.scrollHeight}px`;

        const log = $('chat-log');
        log.scrollTop = log.scrollHeight;
    };

    $('chat-text').addEventListener('input', growBox);

    // A keyboard arriving takes half the screen, and the half it takes is the
    // half the last message was in. What is left goes to the messages: the
    // stylesheet folds away everything between the name and them.
    $('chat-text').addEventListener('focus', () => {
        document.body.classList.add('is-typing');

        // Safari scrolls the page by itself to bring a field into view, and
        // between that and the page being given a new height the two of them
        // leave a band of nothing. Put back once, here, rather than argued with
        // continuously inside the measuring, which is what shook the screen.
        window.scrollTo(0, 0);

        settle();

        setTimeout(() => {
            const log = $('chat-log');
            log.scrollTop = log.scrollHeight;
        }, 340);
    });

    $('chat-text').addEventListener('blur', () => {
        document.body.classList.remove('is-typing');
        settle();
    });

    const unsay = async (id) => {
        if (!confirm('Να διαγραφεί το μήνυμα;')) return;

        const open = state.chat.open;

        try {
            const data = await api('/api/chat', {
                method: 'POST',
                body: {
                    ...(open.kind === 'team' ? { grid: open.id } : { with: open.id }),
                    action: 'delete', id
                }
            });
            state.chat.messages = data.messages || [];
            renderRoom();
        } catch (err) {
            toast(explain(err), 'bad');
        }
    };

    $('chat-log').addEventListener('click', (clicked) => {
        const button = clicked.target.closest('button[data-do]');
        if (!button) return;

        if (button.dataset.do === 'find') { findMessage(button.dataset.at); return; }

        if (button.dataset.do === 'more') {
            clicked.stopPropagation();
            const row = button.closest('.chat-msg');
            const box = button.getBoundingClientRect();
            openMsgMenu(row, box.left + box.width / 2, box.top);
        }
    });

    // Fifteen seconds is the pace of somebody waiting for an answer, and it is
    // only that while the conversation is on the screen. Behind the grid the
    // same question was being asked four times a minute to move a number nobody
    // was watching, so there it is asked once.
    let ticks = 0;
    setInterval(() => {
        if (document.hidden) return;
        ticks += 1;

        if ($('view-chat').hidden) { if (ticks % 4 === 0) loadChats(); return; }

        if (state.chat.open) openThread(state.chat.open, { quiet: true });
        if (ticks % 3 === 0) loadChats();
    }, 15000);

    // --- the project's links and its loose ideas ----------------------------
    // Both hang off the project thread as tabs beside the talk, because both
    // are things the whole team keeps rather than things two people say.
    const COLOURS = ['amber', 'rose', 'mint', 'sky', 'lilac'];

    // Three lines, the mark every list in every app uses for "this one moves".
    const GRIP = '<span class="link-grip" aria-hidden="true">'
        + '<svg viewBox="0 0 24 24"><path d="M4 8h16M4 12h16M4 16h16"/></svg></span>';

    const LINK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true">'
        + '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/>'
        + '<path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>';

    // --- writing a note with formatting in it --------------------------------
    // The browser's own editing commands, which is what lets this be a toolbar
    // and not an editor. They are old and they are deprecated and every browser
    // still runs them, and what they write is the plainest markup there is:
    // b, i, u, lists and the font tag. Every one of those is on the list in
    // api/_rich.js, which is the thing that decides what anybody else's browser
    // is allowed to see. Nothing here is a defence; this end only has to be
    // convenient.
    const INK_SIZES = [['2', 'Μικρά'], ['3', 'Κανονικά'], ['5', 'Μεγάλα'], ['6', 'Πολύ μεγάλα']];

    const INK_COLOURS = [
        ['#ffffff', 'Λευκό'], ['#b8babe', 'Γκρι'], ['#e8894a', 'Πορτοκαλί'],
        ['#e0648a', 'Ροζ'], ['#5bb98c', 'Πράσινο'], ['#5b9fe0', 'Γαλάζιο'],
        ['#a07ae0', 'Μωβ'], ['#d9a441', 'Χρυσό']
    ];

    const INK_FACES = [['Geologica', 'Κανονική'], ['Georgia', 'Με πατούρες'], ['Courier New', 'Γραφομηχανή']];

    const picker_of = (cmd, label, options) => `
        <select data-ink="${cmd}" aria-label="${label}">
            <option value="">${label}</option>
            ${options.map(([value, name]) => `<option value="${value}">${name}</option>`).join('')}
        </select>`;

    const INK_BAR = `
        <button type="button" data-ink="bold" title="Έντονα" style="font-weight:700">B</button>
        <button type="button" data-ink="italic" title="Πλάγια" style="font-style:italic">I</button>
        <button type="button" data-ink="underline" title="Υπογράμμιση" style="text-decoration:underline">U</button>
        <button type="button" data-ink="strikeThrough" title="Διαγραφή" style="text-decoration:line-through">S</button>
        <span class="ink-sep" aria-hidden="true"></span>
        <button type="button" data-ink="insertUnorderedList" title="Κουκκίδες">•—</button>
        <button type="button" data-ink="insertOrderedList" title="Αρίθμηση">1.</button>
        <span class="ink-sep" aria-hidden="true"></span>
        ${picker_of('fontSize', 'Μέγεθος', INK_SIZES)}
        ${picker_of('fontName', 'Γραμματοσειρά', INK_FACES)}
        <span class="ink-sep" aria-hidden="true"></span>
        ${INK_COLOURS.map(([value, name]) => `
            <button class="ink-dab" type="button" data-ink="foreColor" data-value="${value}"
                    title="${name}" aria-label="Χρώμα ${name}"
                    style="--dab: ${value}"></button>`).join('')}
        <button type="button" data-ink="removeFormat" title="Καθάρισμα μορφοποίησης">✕</button>`;

    // Where the caret was the last time it was in a writing box. A toolbar
    // button takes the focus away for a moment, and without this the command
    // would have nothing to apply itself to.
    let inked = null;
    let mark = null;

    document.addEventListener('selectionchange', () => {
        const chosen = document.getSelection();
        if (!chosen || !chosen.rangeCount) return;

        const node = chosen.anchorNode;
        const box = node && (node.nodeType === 1 ? node : node.parentElement);
        const editor = box && box.closest('.ink[contenteditable="true"]');
        if (!editor) return;

        inked = editor;
        mark = chosen.getRangeAt(0).cloneRange();
    });

    const ink = (cmd, value) => {
        if (!inked || !document.contains(inked)) return;

        inked.focus();

        if (mark) {
            const chosen = document.getSelection();
            chosen.removeAllRanges();
            chosen.addRange(mark);
        }

        try {
            // Tags rather than inline styles, because tags are what the list on
            // the server is a list of.
            document.execCommand('styleWithCSS', false, false);
            document.execCommand(cmd, false, value);
        } catch { /* a browser that will not, and a note that stays plain */ }

        const after = document.getSelection();
        if (after && after.rangeCount) mark = after.getRangeAt(0).cloneRange();
    };

    // One listener for every toolbar there will ever be, including the one that
    // appears inside a note being edited.
    document.addEventListener('click', (event) => {
        const button = event.target.closest('.ink-bar button[data-ink]');
        if (button) { event.preventDefault(); ink(button.dataset.ink, button.dataset.value); }
    });

    document.addEventListener('change', (event) => {
        const picker = event.target.closest('.ink-bar select[data-ink]');
        if (!picker || !picker.value) return;

        ink(picker.dataset.ink, picker.value);
        picker.value = '';
    });

    // Pressing a button must not take the caret with it. A select has to take
    // the focus to open at all, which is what the remembered range is for.
    document.addEventListener('mousedown', (event) => {
        if (event.target.closest('.ink-bar button')) event.preventDefault();
    });

    // Whatever is pasted arrives as words. A paste from a word processor brings
    // a document's worth of markup with it, and none of it is wanted here.
    document.addEventListener('paste', (event) => {
        const editor = event.target.closest && event.target.closest('.ink[contenteditable="true"]');
        if (!editor) return;

        event.preventDefault();
        const said = (event.clipboardData || window.clipboardData).getData('text/plain');
        document.execCommand('insertText', false, said);
    });

    const wall = { links: [], notes: [], tag: null, editing: null, fixing: null, colour: COLOURS[0] };

    // Which of the three is showing. Only the project thread has them at all.
    let tab = 'talk';

    const showTab = (which) => {
        tab = which;
        adding('pane-links', false);
        adding('pane-ideas', false);
        ['talk', 'links', 'ideas'].forEach(one => {
            $(`pane-${one}`).hidden = one !== which;
        });
        document.querySelectorAll('#room-tabs button').forEach(button => {
            const on = button.dataset.tab === which;
            button.classList.toggle('is-on', on);
            button.setAttribute('aria-selected', on ? 'true' : 'false');
        });

        if (which === 'talk') renderRoom();
        else loadBoard();
    };

    $('room-tabs').addEventListener('click', (clicked) => {
        const button = clicked.target.closest('button[data-tab]');
        if (button) showTab(button.dataset.tab);
    });

    const host = (url) => {
        try { return new URL(url).hostname.replace(/^www\./, ''); }
        catch { return url; }
    };

    const renderLinks = () => {
        // A heading appears where the heading changes, and the links that were
        // never given one sit at the top under nothing at all.
        let heading = '';

        $('link-list').innerHTML = wall.links.length
            ? wall.links.map(link => {
                const group = link.group || '';
                const head = group && group !== heading ? `<li class="link-head">${esc(group)}</li>` : '';
                heading = group;

                const mine = link.userId === state.me.id || state.me.role === 'admin';

                // Being renamed or put under another heading. The address is
                // not in here: a different address is a different link.
                if (wall.fixing === link.id) {
                    return head + `
                <li data-link="${esc(link.id)}" class="is-fixing">
                    ${GRIP}
                    <span class="link-edit">
                        <input data-fix="title" value="${esc(link.title)}" maxlength="120"
                               placeholder="Πώς να λέγεται">
                        <input data-fix="group" value="${esc(link.group || '')}" maxlength="40"
                               list="link-groups" placeholder="Κατηγορία">
                        <button class="link-drop link-edit-btn" type="button" data-do="save-link">Αποθήκευση</button>
                        <button class="link-drop link-edit-btn" type="button" data-do="cancel-link">Ακύρωση</button>
                    </span>
                </li>`;
                }

                return head + `
                <li data-link="${esc(link.id)}">
                    ${GRIP}
                    <span class="link-face" aria-hidden="true">${LINK_ICON}</span>
                    <span class="link-text">
                        <a href="${esc(link.url)}" target="_blank" rel="noopener noreferrer"
                           draggable="false">${esc(link.title)}</a>
                        <small>${esc(host(link.url))} · ${esc(link.name)} · ${esc(ago(link.at))}</small>
                    </span>
                    ${mine ? `<span class="link-acts">
                        <button class="link-drop link-edit-btn" type="button" data-do="fix-link">Αλλαγή</button>
                        <button class="link-drop" type="button" data-do="drop-link">Αφαίρεση</button>
                    </span>` : '<span></span>'}
                </li>`;
            }).join('')
            : '<li class="room-none">Κανένας σύνδεσμος ακόμα. Βάλε εδώ ό,τι ψάχνει συνέχεια η ομάδα: φάκελο στο Drive, brief, ημερολόγιο.</li>';

        // Whatever headings exist, offered to whoever is adding the next link,
        // so that a category is typed once and picked from then on.
        const names = [];
        wall.links.forEach(link => {
            if (link.group && !names.includes(link.group)) names.push(link.group);
        });
        $('link-groups').innerHTML = names.map(one => `<option value="${esc(one)}">`).join('');
    };

    // Every tag that anybody has written on a note, so the row of them is what
    // the project turned out to need rather than what somebody guessed first.
    const allTags = () => {
        const seen = new Map();
        wall.notes.forEach(note => (note.tags || []).forEach(tag => {
            if (!seen.has(tag.toLowerCase())) seen.set(tag.toLowerCase(), tag);
        }));
        return Array.from(seen.values());
    };

    const renderIdeas = () => {
        const tags = allTags();

        $('idea-filter').hidden = !tags.length;
        $('idea-filter').innerHTML = tags.map(tag => `
            <button class="idea-chip${wall.tag === tag ? ' is-on' : ''}" type="button"
                    data-tag="${esc(tag)}">${esc(tag)}</button>`).join('');

        const shown = wall.tag
            ? wall.notes.filter(note => (note.tags || []).some(tag => tag === wall.tag))
            : wall.notes;

        if (!shown.length) {
            $('idea-wall').innerHTML = `<p class="room-none">${wall.tag
                ? 'Καμία ιδέα με αυτή την ετικέτα.'
                : 'Άδειος τοίχος. Γράψε την πρώτη ιδέα, διάλεξε χρώμα, και βάλε όποιες ετικέτες σου κάνουν.'}</p>`;
            return;
        }

        $('idea-wall').innerHTML = shown.map(note => {
            const mine = note.userId === state.me.id;
            const editing = wall.editing === note.id;

            // A note written before any of this could be formatted is still
            // the plain text it was, and is put on screen as text. One that has
            // been through the server's list is put on screen as the markup the
            // list allowed, and nothing else can have survived it.
            const said = note.rich ? note.text : esc(note.text);

            const body = editing
                ? `<div class="idea-edit">
                       <div class="ink-bar">${INK_BAR}</div>
                       <div class="ink" contenteditable="true" role="textbox" aria-multiline="true"
                            data-edit data-empty="Γράψε την ιδέα">${said}</div>
                       <input maxlength="140" data-tags value="${esc((note.tags || []).join(', '))}"
                              placeholder="Ετικέτες, χωρισμένες με κόμμα">
                       <p class="idea-foot">
                           <button type="button" data-do="save-idea">Αποθήκευση</button>
                           <button type="button" data-do="cancel-idea">Ακύρωση</button>
                       </p>
                   </div>`
                : `<p class="idea-said${note.rich ? ' is-rich' : ''}">${said}</p>
                   ${(note.tags || []).length ? `<p class="idea-tags">${
                       note.tags.map(tag => `<span class="idea-tag">${esc(tag)}</span>`).join('')}</p>` : ''}
                   <p class="idea-foot">
                       <span>${esc(note.name)} · ${esc(ago(note.at))}${note.editedAt ? ' · αλλαγμένο' : ''}</span>
                       ${mine ? '<button class="idea-spacer" type="button" data-do="edit-idea">Αλλαγή</button>' : ''}
                       ${mine || state.me.role === 'admin'
                           ? `<button class="is-danger${mine ? '' : ' idea-spacer'}" type="button" data-do="drop-idea">Διαγραφή</button>`
                           : ''}
                   </p>`;

            return `<article class="idea" data-idea="${esc(note.id)}"
                             style="--tone: var(--note-${esc(COLOURS.includes(note.colour) ? note.colour : COLOURS[0])})">
                        ${body}
                    </article>`;
        }).join('');
    };

    const renderSwatches = () => {
        $('idea-colours').innerHTML = COLOURS.map(name => `
            <button class="idea-swatch" type="button" role="radio" data-colour="${name}"
                    aria-checked="${name === wall.colour ? 'true' : 'false'}"
                    aria-label="Χρώμα ${name}" style="--tone: var(--note-${name})"></button>`).join('');
    };

    const loadBoard = async () => {
        try {
            const data = await api(`/api/board?grid=${encodeURIComponent(state.chat.gridId)}`);
            wall.links = data.links || [];
            wall.notes = data.notes || [];
        } catch (err) {
            toast(explain(err), 'bad');
            return;
        }

        // A tag that was being filtered on and has since left the wall would
        // otherwise hide everything behind a chip that is no longer there.
        if (wall.tag && !allTags().includes(wall.tag)) wall.tag = null;

        renderLinks();
        renderIdeas();
    };

    const boardAction = (body) => api('/api/board', {
        method: 'POST',
        body: { grid: state.chat.gridId, ...body }
    });

    // Both of these name the grid they were done on rather than reading the one
    // that happens to be open, so an undo still lands in the right place after
    // somebody has moved on to another project.
    const showBoard = (gridId, data) => {
        if (state.chat.gridId !== gridId) return;
        if (data.links) wall.links = data.links;
        if (data.notes) wall.notes = data.notes;
        if (wall.tag && !allTags().includes(wall.tag)) wall.tag = null;
        renderLinks();
        renderIdeas();
    };

    const moveLink = async (gridId, id, to, group) => {
        const data = await api('/api/board', {
            method: 'POST',
            body: { grid: gridId, action: 'move-link', id, to, group: group || '' }
        });
        showBoard(gridId, data);
        return data;
    };

    // Putting back what was just deleted. The server kept the whole record, so
    // what comes back is the thing itself, in its old place and still signed by
    // whoever wrote it.
    const undelete = async (gridId, id) => {
        const data = await api('/api/board', {
            method: 'POST',
            body: { grid: gridId, action: 'undo-delete', id }
        });
        showBoard(gridId, data);
    };

    // On a phone the two forms are a button until somebody presses it, and go
    // back to being a button once they have added the thing they came to add.
    // On anything wider the stylesheet leaves them open and none of this shows.
    const adding = (pane, open) => {
        $(pane).classList.toggle('is-adding', open);
        if (!open) return;

        const first = $(pane).querySelector('input, textarea, [contenteditable="true"]');
        if (first) first.focus();
    };

    $('link-open').addEventListener('click', () => adding('pane-links', true));
    $('idea-open').addEventListener('click', () => adding('pane-ideas', true));

    document.querySelectorAll('[data-shut]').forEach(button => {
        button.addEventListener('click', () => {
            adding(button.closest('.room-pane').id, false);
        });
    });

    $('link-new').addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.target;
        const { url, title, group } = Object.fromEntries(new FormData(form).entries());

        try {
            const data = await boardAction({ action: 'add-link', url, title, group });
            wall.links = data.links || [];
            form.reset();
            adding('pane-links', false);
            renderLinks();
        } catch (err) {
            toast(explain(err), 'bad');
        }
    });

    $('link-list').addEventListener('click', async (clicked) => {
        const button = clicked.target.closest('button[data-do]');
        if (!button) return;

        const row = button.closest('[data-link]');
        const id = row.dataset.link;
        const what = button.dataset.do;
        const gridId = state.chat.gridId;

        if (what === 'fix-link') { wall.fixing = id; renderLinks(); return; }
        if (what === 'cancel-link') { wall.fixing = null; renderLinks(); return; }

        try {
            if (what === 'save-link') {
                const data = await boardAction({
                    action: 'edit-link',
                    id,
                    title: row.querySelector('[data-fix="title"]').value,
                    group: row.querySelector('[data-fix="group"]').value
                });
                wall.links = data.links || [];
                wall.fixing = null;
                renderLinks();
                return;
            }

            if (what === 'drop-link') {
                if (!confirm('Να αφαιρεθεί ο σύνδεσμος;')) return;
                const data = await boardAction({ action: 'delete-link', id });
                wall.links = data.links || [];
                renderLinks();
                keepUndo({ what: 'Ο σύνδεσμος επανήλθε.', run: () => undelete(gridId, id) });
            }
        } catch (err) {
            toast(explain(err), 'bad');
        }
    });

    // --- carrying a link to another place in the list -----------------------
    // The same gesture as a square on the grid, and for the same reason: the
    // browser's own drag and drop does not exist on a touch screen. A mouse
    // only has to move; a finger has to hold still for a moment first, so an
    // ordinary swipe still scrolls the list.
    //
    // A list has an order rather than places, so a row is put between two
    // others rather than trading with one, and the line between them says
    // where it is going before it is let go.
    const linkList = $('link-list');
    const scroller = () => linkList.closest('.room-scroll');

    const haul = {
        id: null, pointer: null, touch: false,
        x: 0, y: 0, startX: 0, startY: 0,
        hold: null, ghost: null, active: false, moved: false
    };

    const rowAt = (x, y) => {
        const under = document.elementFromPoint(x, y);
        const row = under ? under.closest('.link-list li[data-link]') : null;
        return row && row.dataset.link !== haul.id ? row : null;
    };

    const clearMarks = () => {
        linkList.querySelectorAll('.is-before, .is-after')
            .forEach(one => one.classList.remove('is-before', 'is-after'));
    };

    // Which gap the row is heading for: above the row under the pointer, or
    // below it, whichever half of it the pointer is in.
    const gap = () => {
        const row = rowAt(haul.x, haul.y);
        if (!row) return null;
        const box = row.getBoundingClientRect();
        return { row, after: haul.y > box.top + box.height / 2 };
    };

    const markGap = () => {
        clearMarks();
        const spot = gap();
        if (spot) spot.row.classList.add(spot.after ? 'is-after' : 'is-before');
    };

    const placeHaul = () => {
        if (haul.ghost) haul.ghost.style.transform = `translate(${haul.x}px, ${haul.y}px) translate(-14px, -50%)`;
    };

    // The list scrolls inside its own box rather than with the page, so this is
    // the box that has to keep moving while a row is held near its edge.
    let creeping = null;
    const edgeCreep = () => {
        if (!haul.active) { creeping = null; return; }

        const box = scroller();
        if (box) {
            const bounds = box.getBoundingClientRect();
            const above = haul.y - (bounds.top + 60);
            const below = haul.y - (bounds.bottom - 60);
            const step = above < 0 ? Math.max(-16, above / 4) : below > 0 ? Math.min(16, below / 4) : 0;
            if (step) { box.scrollBy(0, step); markGap(); }
        }

        creeping = requestAnimationFrame(edgeCreep);
    };

    const heave = () => {
        const row = linkList.querySelector(`li[data-link="${haul.id}"]`);
        if (!row) return;

        haul.active = true;
        haul.moved = true;
        knock(PICK_UP);
        row.classList.add('is-lifting');
        document.body.classList.add('is-dragging-link');

        // Capture from here and not a moment earlier. A captured pointer sends
        // its click to whatever captured it rather than to what was under it,
        // and what is under it here is a link somebody meant to open. Nothing
        // is captured until a drag has actually begun, so an ordinary click on
        // a link is an ordinary click on a link.
        try { linkList.setPointerCapture(haul.pointer); } catch { /* it went already */ }

        const box = row.getBoundingClientRect();
        haul.ghost = document.createElement('div');
        haul.ghost.className = 'link-ghost';
        haul.ghost.style.width = `${box.width}px`;
        haul.ghost.innerHTML = `${GRIP}
                                <span class="link-face" aria-hidden="true">${LINK_ICON}</span>
                                <span class="link-text">${row.querySelector('.link-text').innerHTML}</span>`;
        document.body.appendChild(haul.ghost);

        placeHaul();
        markGap();
        if (!creeping) creeping = requestAnimationFrame(edgeCreep);
    };

    const drop = async (dropped) => {
        clearTimeout(haul.hold);
        if (creeping) { cancelAnimationFrame(creeping); creeping = null; }
        if (haul.ghost) { haul.ghost.remove(); haul.ghost = null; }

        document.body.classList.remove('is-dragging-link');
        linkList.querySelectorAll('.is-lifting').forEach(one => one.classList.remove('is-lifting'));

        const spot = haul.active && dropped ? gap() : null;
        clearMarks();

        const id = haul.id;
        const wasActive = haul.active;

        haul.id = null;
        haul.pointer = null;
        haul.active = false;

        if (!wasActive || !spot) return;

        const from = wall.links.findIndex(one => one.id === id);
        const onto = wall.links.findIndex(one => one.id === spot.row.dataset.link);
        if (from < 0 || onto < 0) return;

        // Where a link lands says which heading it is under, so carrying one
        // into another group is how it changes group. There is nothing else to
        // learn and no second control to go and find.
        const was = wall.links[from].group || '';
        const group = wall.links[onto].group || '';

        let to = spot.after ? onto + 1 : onto;
        if (from < to) to -= 1;
        if (to === from && group === was) return;

        knock(PUT_DOWN);

        // The list is redrawn in its new order before the server has answered,
        // because a row that snaps back for a moment reads as a failed drag.
        const gridId = state.chat.gridId;
        const [moved] = wall.links.splice(from, 1);
        moved.group = group;
        wall.links.splice(to, 0, moved);
        renderLinks();
        landed(linkList.querySelector(`li[data-link="${id}"]`));

        try {
            await moveLink(gridId, id, to, group);
            keepUndo({
                what: 'Η μετακίνηση αναιρέθηκε.',
                run: () => moveLink(gridId, id, from, was)
            });
        } catch (err) {
            toast(explain(err), 'bad');
            renderLinks();
        }
    };

    linkList.addEventListener('pointerdown', (event) => {
        if (event.button > 0) return;

        // Only from the three lines. A row holds a link somebody means to
        // open, and a click that wandered seven pixels on its way was carrying
        // it off instead of following it. The handle is there to be taken hold
        // of; everywhere else on the row belongs to the link.
        if (!event.target.closest('.link-grip')) return;

        const row = event.target.closest('li[data-link]');
        if (!row || row.classList.contains('is-fixing')) return;

        haul.id = row.dataset.link;
        haul.pointer = event.pointerId;
        haul.touch = event.pointerType !== 'mouse';
        haul.startX = haul.x = event.clientX;
        haul.startY = haul.y = event.clientY;
        haul.moved = false;
        haul.active = false;

        if (haul.touch) haul.hold = setTimeout(heave, HOLD_MS);
    });

    linkList.addEventListener('pointermove', (event) => {
        if (haul.pointer !== event.pointerId) return;

        haul.x = event.clientX;
        haul.y = event.clientY;

        const strayed = Math.hypot(haul.x - haul.startX, haul.y - haul.startY);

        if (!haul.active) {
            if (haul.touch) { if (strayed > TOUCH_SLOP) clearTimeout(haul.hold); }
            else if (strayed > MOUSE_SLOP) heave();
            return;
        }

        event.preventDefault();
        placeHaul();
        markGap();
    });

    linkList.addEventListener('pointerup', (event) => {
        if (haul.pointer === event.pointerId) drop(true);
    });

    linkList.addEventListener('pointercancel', (event) => {
        if (haul.pointer === event.pointerId) drop(false);
    });

    // A row that was carried should not also count as a click on the link it
    // holds, which would open the site the moment it was put down.
    linkList.addEventListener('click', (event) => {
        if (!haul.moved) return;
        haul.moved = false;
        event.stopPropagation();
        event.preventDefault();
    }, true);

    // While a finger is carrying a row, the list underneath must stop scrolling
    // with it, and only a live touch listener may say so.
    document.addEventListener('touchmove', (event) => {
        if (haul.active) event.preventDefault();
    }, { passive: false });

    $('idea-colours').addEventListener('click', (clicked) => {
        const swatch = clicked.target.closest('[data-colour]');
        if (!swatch) return;
        wall.colour = swatch.dataset.colour;
        renderSwatches();
    });

    $('idea-bar').innerHTML = INK_BAR;

    $('idea-new').addEventListener('submit', async (event) => {
        event.preventDefault();

        const text = $('idea-text').innerHTML;
        if (!$('idea-text').textContent.trim()) return;

        try {
            const data = await boardAction({
                action: 'add-note',
                text,
                colour: wall.colour,
                tags: $('idea-tags').value
            });
            wall.notes = data.notes || [];
            $('idea-text').innerHTML = '';
            $('idea-tags').value = '';
            adding('pane-ideas', false);
            renderIdeas();
        } catch (err) {
            toast(explain(err), 'bad');
        }
    });

    $('idea-filter').addEventListener('click', (clicked) => {
        const chip = clicked.target.closest('[data-tag]');
        if (!chip) return;
        // Pressing the one that is already on takes the filter off.
        wall.tag = wall.tag === chip.dataset.tag ? null : chip.dataset.tag;
        renderIdeas();
    });

    $('idea-wall').addEventListener('click', async (clicked) => {
        const button = clicked.target.closest('button[data-do]');
        if (!button) return;

        const card = button.closest('[data-idea]');
        const id = card.dataset.idea;
        const what = button.dataset.do;

        if (what === 'edit-idea') { wall.editing = id; renderIdeas(); return; }
        if (what === 'cancel-idea') { wall.editing = null; renderIdeas(); return; }

        try {
            if (what === 'save-idea') {
                const note = wall.notes.find(one => one.id === id);
                const data = await boardAction({
                    action: 'edit-note',
                    id,
                    text: card.querySelector('[data-edit]').innerHTML,
                    colour: note ? note.colour : wall.colour,
                    tags: card.querySelector('[data-tags]').value
                });
                wall.notes = data.notes || [];
                wall.editing = null;
            }

            if (what === 'drop-idea') {
                if (!confirm('Να διαγραφεί το σημείωμα;')) return;
                const gridId = state.chat.gridId;
                const data = await boardAction({ action: 'delete-note', id });
                wall.notes = data.notes || [];
                keepUndo({ what: 'Το σημείωμα επανήλθε.', run: () => undelete(gridId, id) });
            }

            if (wall.tag && !allTags().includes(wall.tag)) wall.tag = null;
            renderIdeas();
        } catch (err) {
            toast(explain(err), 'bad');
        }
    });

    renderSwatches();

    // --- sidebar plumbing --------------------------------------------------
    const closeSidebar = () => {
        document.body.classList.remove('side-open');
        $('app-scrim').hidden = true;
    };

    $('app-burger').addEventListener('click', () => {
        const open = document.body.classList.toggle('side-open');
        $('app-scrim').hidden = !open;
    });

    $('app-scrim').addEventListener('click', closeSidebar);

    $('app-side').addEventListener('click', (event) => {
        const item = event.target.closest('.app-nav-item');
        if (!item) return;

        if (item.dataset.grid) openGrid(item.dataset.grid);
        else if (item.dataset.client) openClient(item.dataset.client);
        else if (item.dataset.view === 'chat') openChat();
        else if (item.dataset.view === 'accounts') openAccounts();
    });

    $('logout').addEventListener('click', async () => {
        try { await api('/api/session', { method: 'DELETE' }); }
        catch { /* going back to the sign-in page either way */ }
        remember.write(null);
        location.replace(LOGIN);
    });

    // --- accounts and grids, for the admin ---------------------------------
    // Nobody signs themselves up: accounts are made here, by hand, and a grid
    // is only seen by the people put on it.
    const admin = { users: [], grids: [] };

    const openAccounts = async () => {
        busy('Φόρτωση…');
        try {
            const data = await api('/api/accounts');
            admin.users = data.users || [];
            admin.grids = data.grids || [];
            $('app-title').textContent = 'Λογαριασμοί και grids';
            renderAccounts();
            showView('accounts');
            where.write('accounts');
            document.querySelectorAll('.app-nav-item').forEach(item => {
                item.classList.toggle('is-on', item.dataset.view === 'accounts');
            });
        } catch (err) {
            toast(explain(err), 'bad');
        } finally {
            busy('');
        }
    };

    // Which client this account or this grid is for. The same link can be made
    // from the client's own page, where it is a list of ticks; here it is a
    // dropdown, because this is where somebody is looking the moment they make
    // the account and having to go and find the client afterwards is a detour.
    const clientOptions = (selected) =>
        `<option value="">Κανένας</option>` + purse.list
            .map(one => `<option value="${esc(one.id)}"${one.id === selected ? ' selected' : ''}>${esc(one.name)}</option>`)
            .join('');

    const roleOptions = (selected) => ['partner', 'client', 'admin']
        .map(role => `<option value="${role}"${role === selected ? ' selected' : ''}>${ROLE_NAMES[role]}</option>`)
        .join('');

    // The panels are lists, one line per account and one per grid, so a long
    // client list stays a list. Everything that can be changed about one of
    // them is behind its gear, in a panel of its own.
    const GEAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/>'
        + '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 '
        + '1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 '
        + '0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 '
        + '0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 '
        + '1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 '
        + '2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 '
        + '0-1.51 1z"/></svg>';

    const EYE = '<button class="pw-eye" type="button" aria-pressed="false" aria-label="Εμφάνιση κωδικού">'
        + '<svg class="pw-open" viewBox="0 0 24 24" aria-hidden="true">'
        + '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
        + '<svg class="pw-shut" viewBox="0 0 24 24" aria-hidden="true">'
        + '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 '
        + '9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>'
        + '<path d="M1 1l22 22"/></svg></button>';

    const people = (count) => (count === 1 ? '1 άτομο' : `${count} άτομα`);

    const line = (id, what, name, under, person) => `
        <li>
            ${faceOf(person || { id, name }, 'lister-face', dot(person))}
            <span class="lister-who">
                <span class="lister-name">${esc(name)}</span>
                <span class="lister-sub">${under}</span>
            </span>
            <button class="lister-gear" type="button" data-open="${what}" data-id="${esc(id)}"
                    aria-label="Ρυθμίσεις: ${esc(name)}">${GEAR}</button>
        </li>`;

    const renderAccounts = () => {
        const named = (clientId) => {
            const one = purse.list.find(client => client.id === clientId);
            return one ? ` · ${esc(one.name)}` : '';
        };

        const userLines = admin.users
            .map(user => line(user.id, 'user', user.name,
                `@${esc(user.username)} · ${ROLE_NAMES[user.role]}${named(user.clientId)} · ${esc(here(user))}`, user))
            .join('');

        const gridLines = admin.grids
            .map(grid => line(grid.id, 'grid', grid.name,
                `${grid.handle ? `@${esc(grid.handle)} · ` : ''}${people((grid.memberIds || []).length)}${named(grid.clientId)}`,
                grid))
            .join('');

        // A client is the company or the person being invoiced, which is not
        // the same thing as the account somebody signs in with: one client can
        // have two people, and both of them read the same page of invoices.
        const clientLines = purse.list.map(one => `
            <li>
                ${faceOf(faceFor(one), 'lister-face')}
                <span class="lister-who">
                    <span class="lister-name">${esc(one.name)}</span>
                    <span class="lister-sub">${one.owed
                        ? `${esc(euro(one.owed))} εκκρεμεί`
                        : esc(one.company || 'Τακτοποιημένα')}</span>
                </span>
                <button class="lister-gear" type="button" data-go="${esc(one.id)}"
                        aria-label="Άνοιγμα: ${esc(one.name)}">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
                </button>
            </li>`).join('');

        $('view-accounts').innerHTML = `
            <section class="panel">
                <div class="panel-head">
                    <h2>Λογαριασμοί</h2>
                    <p>Εσύ ανοίγεις και κλείνεις τους λογαριασμούς. Το όνομα είναι για τα μάτια σου και δέχεται ελληνικά. Το όνομα χρήστη είναι αυτό που πληκτρολογεί στην είσοδο, θέλει λατινικούς χαρακτήρες χωρίς κενά. Το γρανάζι δίπλα σε κάθε όνομα ανοίγει τα πάντα γι' αυτόν, κωδικό μαζί.</p>
                </div>

                <form class="new-row" id="new-user">
                    <input name="name" placeholder="Όνομα" maxlength="60" required>
                    <input name="username" placeholder="Όνομα χρήστη, λατινικά" maxlength="32" pattern="[A-Za-z0-9._\-]{3,32}" title="3 ως 32 λατινικοί χαρακτήρες, αριθμοί, τελεία, παύλα ή κάτω παύλα, χωρίς κενά" autocapitalize="none" spellcheck="false" required>
                    <select name="role">${roleOptions('client')}</select>
                    <span class="pw-field">
                        <input name="password" type="password" placeholder="Κωδικός, 8+ χαρακτήρες" minlength="8" autocomplete="new-password" required>
                        ${EYE}
                    </span>
                    <button class="btn btn-primary" type="submit">Προσθήκη</button>
                </form>

                <p class="panel-error" id="user-error" role="alert" hidden></p>
                <ul class="lister">${userLines}</ul>
            </section>

            <section class="panel">
                <div class="panel-head">
                    <h2>Grids</h2>
                    <p>Ένα grid ανά σελίδα Instagram. Βάλε πάνω του όποιον δουλεύει σε αυτήν.</p>
                </div>

                <form class="new-row" id="new-grid">
                    <input name="name" placeholder="Όνομα, π.χ. Vito" maxlength="60" required>
                    <input name="handle" placeholder="Instagram handle" maxlength="40">
                    <button class="btn btn-primary" type="submit">Νέο grid</button>
                </form>

                <p class="panel-error" id="grid-error" role="alert" hidden></p>
                <ul class="lister">${gridLines}</ul>
            </section>

            <section class="panel">
                <div class="panel-head">
                    <h2>Πελάτες</h2>
                    <p>Ο πελάτης είναι αυτός που τιμολογείς, και δεν είναι το ίδιο πράγμα με τον λογαριασμό που κάνει είσοδο: μια εταιρεία μπορεί να έχει δύο ανθρώπους και να διαβάζουν και οι δύο το ίδιο ιστορικό. Πάτα το βελάκι για να ανοίξεις τη σελίδα του, όπου είναι τα τιμολόγια, οι συνδρομές και το τι του ανήκει.</p>
                </div>

                <form class="new-row" id="new-client">
                    <input name="name" placeholder="Όνομα, π.χ. Μελίνα Φωτεινού" maxlength="80" required>
                    <input name="company" placeholder="Εταιρεία, αν υπάρχει" maxlength="80">
                    <button class="btn btn-primary" type="submit">Νέος πελάτης</button>
                </form>

                <p class="panel-error" id="client-error" role="alert" hidden></p>
                <ul class="lister">${clientLines || '<li class="none-yet">Κανένας πελάτης ακόμα</li>'}</ul>
            </section>
        `;
    };

    // A toast is gone in three seconds, which is no way to be told that a
    // username had a character it could not take. Anything that goes wrong in
    // here is written under the panel it went wrong in, and stays there.
    const complain = (where, message) => {
        const box = where && where.closest('.panel') && where.closest('.panel').querySelector('.panel-error');
        if (!box) { toast(message, 'bad'); return; }
        box.textContent = message;
        box.hidden = false;
        box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };

    const fields = (row) => {
        const out = {};
        row.querySelectorAll('[data-f]').forEach(input => { out[input.dataset.f] = input.value; });
        return out;
    };

    $('view-accounts').addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.target;
        const data = Object.fromEntries(new FormData(form).entries());

        try {
            if (form.id === 'new-user') {
                await api('/api/accounts', { method: 'POST', body: { kind: 'user', ...data } });
                toast('Ο λογαριασμός δημιουργήθηκε.');
            } else if (form.id === 'new-client') {
                await api('/api/clients', { method: 'POST', body: { kind: 'client', ...data } });
                toast('Ο πελάτης δημιουργήθηκε.');
                await loadClients();
            } else {
                await api('/api/accounts', { method: 'POST', body: { kind: 'grid', ...data } });
                toast('Το grid δημιουργήθηκε.');
                await loadGrids();
            }
            form.reset();
            await openAccounts();
        } catch (err) {
            complain(form, explain(err));
        }
    });

    // --- one account, or one grid, behind its gear -------------------------
    // The list says who exists. This says everything else about one of them,
    // and is the only place any of it can be changed.
    const drawer = { kind: null, id: null, password: '', icon: null };

    const sayAcct = (message) => {
        $('acct-error').textContent = message || '';
        $('acct-error').hidden = !message;
    };

    const closeDrawer = () => {
        drawer.kind = null;
        drawer.id = null;
        drawer.password = '';
        $('acct-modal').hidden = true;
        unlock();
    };

    const openDrawer = (kind, id) => {
        const body = $('acct-body');
        sayAcct('');

        if (kind === 'user') {
            const user = admin.users.find(u => u.id === id);
            if (!user) return;

            // The password as it stands, if the server could still read it
            // back. Held so that saving can tell an untouched box from a
            // changed one and leave the untouched one alone.
            const known = user.password || '';
            drawer.password = known;

            $('acct-title').textContent = user.name;
            $('acct-sub').textContent = user.lastLoginAt
                ? `Τελευταία είσοδος: ${when(user.lastLoginAt)}`
                : 'Δεν έχει μπει ακόμα.';

            body.innerHTML = `
                <div class="row-fields">
                    <label>Όνομα<input data-f="name" value="${esc(user.name)}" maxlength="60"></label>
                    <label>Όνομα χρήστη<input data-f="username" value="${esc(user.username)}" maxlength="32" pattern="[A-Za-z0-9._\-]{3,32}" title="3 ως 32 λατινικοί χαρακτήρες, αριθμοί, τελεία, παύλα ή κάτω παύλα, χωρίς κενά" autocapitalize="none" spellcheck="false"></label>
                    <label>Ρόλος<select data-f="role">${roleOptions(user.role)}</select></label>
                    <label>Πελάτης<select data-f="clientId">${clientOptions(user.clientId)}</select></label>
                </div>
                <p class="pw-note">Ο πελάτης είναι η εταιρεία ή ο άνθρωπος που τιμολογείς, και είναι αυτό που δίνει σε αυτόν τον λογαριασμό τη σελίδα «Ο λογαριασμός μου» με τα τιμολόγιά του. Ισχύει μόνο για λογαριασμούς με ρόλο πελάτη.</p>

                <label class="edit-label pw-head" for="acct-password">Κωδικός</label>
                <span class="pw-field">
                    <input id="acct-password" data-f="password" type="password" minlength="8"
                           value="${esc(known)}" autocomplete="off" spellcheck="false"
                           placeholder="${known ? '' : 'Γράψε νέον κωδικό'}">
                    ${EYE}
                </span>
                <p class="pw-note">${known
                    ? 'Πάτα το ματάκι για να τον δεις. Γράψε από πάνω και αποθήκευσε για να τον αλλάξεις.'
                    : 'Αυτός ο λογαριασμός φτιάχτηκε πριν κρατηθεί αντίγραφο του κωδικού του, οπότε δεν διαβάζεται. Όρισε νέον εδώ και από δω και πέρα θα τον βλέπεις με το ματάκι.'}</p>
            `;

            // Your own account is the one you cannot take away.
            $('acct-delete').hidden = user.id === state.me.id;
        } else {
            const grid = admin.grids.find(g => g.id === id);
            if (!grid) return;
            const members = admin.users.filter(u => u.role !== 'admin');

            drawer.icon = grid.ownIcon || null;
            $('acct-title').textContent = grid.name;
            $('acct-sub').textContent = 'Όποιος μπει πάνω του μπορεί να το αλλάξει. Τα σχόλια των πελατών ξεχωρίζουν και σηκώνουν ένδειξη μέχρι να απαντηθούν.';

            body.innerHTML = `
                <div class="row-fields">
                    <label>Όνομα<input data-f="name" value="${esc(grid.name)}" maxlength="60"></label>
                    <label>Instagram handle<input data-f="handle" value="${esc(grid.handle)}" maxlength="40" placeholder="χωρίς το @"></label>
                    <label>Πελάτης<select data-f="clientId">${clientOptions(grid.clientId)}</select></label>
                </div>

                <label class="edit-label pw-head">Εικονίδιο στη λίστα</label>
                <div class="face-edit">
                    <span class="face-big" id="grid-face"></span>
                    <span class="face-acts">
                        <button class="app-ghost" type="button" data-do="pick-icon">Διάλεξε εικόνα</button>
                        <button class="app-ghost app-danger" type="button" data-do="clear-icon">Αφαίρεση</button>
                    </span>
                </div>
                <p class="pw-note">Μόνο εσύ το ορίζεις, και φαίνεται στο τετραγωνάκι δίπλα στο όνομα του project στη λίστα αριστερά. Δεν είναι η φωτογραφία προφίλ του ίδιου του grid.</p>

                <fieldset class="row-members">
                    <legend>Ποιοι δουλεύουν πάνω του</legend>
                    ${members.length ? members.map(user => `
                        <label class="member">
                            <input type="checkbox" data-member="${esc(user.id)}"${grid.memberIds.includes(user.id) ? ' checked' : ''}>
                            <span>${esc(user.name)} <small>${ROLE_NAMES[user.role]}</small></span>
                        </label>`).join('')
                        : '<p class="row-none">Δεν υπάρχουν ακόμα λογαριασμοί για να μπουν.</p>'}
                </fieldset>
            `;

            paintFace($('grid-face'),
                      { id: grid.id, name: grid.name, icon: drawer.icon || grid.icon },
                      'face-big');
            $('acct-body').querySelector('[data-do="clear-icon"]').hidden = !drawer.icon;

            $('acct-delete').hidden = false;
        }

        drawer.kind = kind;
        drawer.id = id;
        $('acct-modal').hidden = false;
        document.body.classList.add('is-locked');
    };

    $('view-accounts').addEventListener('click', (event) => {
        const go = event.target.closest('[data-go]');
        if (go) { openClient(go.dataset.go); return; }

        const gear = event.target.closest('[data-open]');
        if (gear) openDrawer(gear.dataset.open, gear.dataset.id);
    });

    // The picture is chosen now and saved with the rest of the panel, so that
    // backing out of the panel backs out of the picture too.
    $('acct-body').addEventListener('click', async (clicked) => {
        const button = clicked.target.closest('button[data-do]');
        if (!button || drawer.kind !== 'grid') return;

        if (button.dataset.do === 'clear-icon') {
            drawer.icon = null;
            paintFace($('grid-face'), { id: drawer.id, name: $('acct-title').textContent }, 'face-big');
            button.hidden = true;
            return;
        }

        if (button.dataset.do !== 'pick-icon') return;

        pickFiles(false, async (files) => {
            sayAcct('');
            busy('Ανέβασμα…');
            try {
                const { url } = await acquire(files[0], SMALL_SIDE, drawer.id);
                drawer.icon = url;
                paintFace($('grid-face'),
                          { id: drawer.id, name: $('acct-title').textContent, icon: url },
                          'face-big');
                $('acct-body').querySelector('[data-do="clear-icon"]').hidden = false;
            } catch (err) {
                sayAcct(explain(err));
            } finally {
                busy('');
            }
        });
    });

    $('acct-save').addEventListener('click', async () => {
        if (!drawer.kind) return;
        const body = $('acct-body');
        sayAcct('');
        busy('Αποθήκευση…');

        try {
            if (drawer.kind === 'user') {
                const sent = { kind: 'user', id: drawer.id, ...fields(body) };
                // A box left as it was found, or left empty, is not a change of
                // password, so it goes out of the request rather than round
                // through the hash again.
                if (!sent.password || sent.password === drawer.password) delete sent.password;
                await api('/api/accounts', { method: 'PATCH', body: sent });
            } else {
                const memberIds = Array.from(body.querySelectorAll('[data-member]'))
                    .filter(box => box.checked)
                    .map(box => box.dataset.member);
                await api('/api/accounts', {
                    method: 'PATCH',
                    body: { kind: 'grid', id: drawer.id, ...fields(body), memberIds, icon: drawer.icon }
                });
                await loadGrids();
            }

            closeDrawer();
            toast('Αποθηκεύτηκε.');
            await openAccounts();
        } catch (err) {
            sayAcct(explain(err));
        } finally {
            busy('');
        }
    });

    $('acct-delete').addEventListener('click', async () => {
        if (!drawer.kind) return;
        const isUser = drawer.kind === 'user';

        const sure = isUser
            ? 'Να αφαιρεθεί ο λογαριασμός; Χάνει αμέσως την πρόσβασή του.'
            : 'Να διαγραφεί το grid μαζί με όλες τις εικόνες του; Δεν γίνεται αναίρεση.';
        if (!confirm(sure)) return;

        sayAcct('');
        busy('Διαγραφή…');
        try {
            await api(`/api/accounts?kind=${drawer.kind}&id=${encodeURIComponent(drawer.id)}`,
                      { method: 'DELETE' });

            if (!isUser && state.grid && state.grid.id === drawer.id) {
                state.grid = null;
                remember.write(null);
            }

            closeDrawer();
            toast(isUser ? 'Ο λογαριασμός αφαιρέθηκε.' : 'Το grid διαγράφηκε.');
            if (!isUser) await loadGrids();
            await openAccounts();
        } catch (err) {
            sayAcct(explain(err));
        } finally {
            busy('');
        }
    });

    // --- a client ------------------------------------------------------------
    // What has been done for somebody, what it cost, and what is still running.
    //
    // No figure on this page was worked out here. Every one of them was typed in
    // after an invoice had already been issued somewhere else, and the link on a
    // row goes to that invoice. What the page adds is that it is in one place
    // and that the client can read it without having to ask.
    const purse = { list: [], id: null, client: null, money: null, people: [], grids: [] };

    const euro = (cents) => {
        try {
            return new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' })
                .format((cents || 0) / 100);
        } catch { return `${((cents || 0) / 100).toFixed(2)} €`; }
    };

    // A date on its own, for a row in a ledger where the time of day means
    // nothing. The stored form is already the day, so this only turns it round.
    const onDay = (iso) => {
        const [year, month, day] = String(iso || '').split('-');
        return day ? `${day}/${month}/${year}` : '';
    };

    // A client wears their account's face: the same photograph, and where there
    // is none, the same colour behind the same letter. Nothing here keeps a
    // picture of its own that could fall out of step with it.
    const faceFor = (client) => ({
        id: client.faceOf || client.id,
        name: client.name,
        avatar: client.avatar || null
    });

    const CYCLE_NAMES = { month: 'μήνα', quarter: 'τρίμηνο', year: 'χρόνο' };
    const MONTHS = ['Ιαν', 'Φεβ', 'Μαρ', 'Απρ', 'Μάι', 'Ιούν',
                    'Ιούλ', 'Αύγ', 'Σεπ', 'Οκτ', 'Νοε', 'Δεκ'];

    // Past a handful the list stops being something you read and becomes
    // something you look through, and only then is it worth a box to look with.
    const LONG_LIST = 5;
    let hunt = '';

    // Lower case and without its accents, so that a search for melina finds
    // Μελίνα. Typing the tonos is not something anybody does in a hurry.
    const plain = (said) => String(said || '').toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    const renderClientNav = () => {
        const wrap = $('app-clients-wrap');
        const list = $('app-clients');
        const label = $('app-clients-label');
        const box = $('app-find');

        // A category that hides itself until something is in it is a category
        // nobody ever finds, so for the admin the heading stays and says so,
        // the same way the grids do. For somebody who is not the admin and has
        // no account of their own there is genuinely nothing to point at.
        const boss = state.me && state.me.role === 'admin';

        if (!purse.list.length) {
            wrap.hidden = !boss;
            box.hidden = true;
            label.textContent = 'Πελάτες';
            list.classList.remove('is-long');
            list.innerHTML = boss ? '<li class="app-grids-empty">Κανένας ακόμα</li>' : '';
            return;
        }

        wrap.hidden = false;
        // The same list, and two entirely different things to the two people
        // reading it. One of them is looking at their clients; the other is
        // looking at themselves, and should never be shown a heading that
        // suggests there are others.
        label.textContent = boss ? 'Πελάτες' : 'Ο λογαριασμός μου';

        const many = boss && purse.list.length > LONG_LIST;
        box.hidden = !many;
        list.classList.toggle('is-long', many);
        // A search box that has just gone away should not still be filtering.
        if (!many) hunt = '';

        const wanted = hunt
            ? purse.list.filter(one => plain(one.name).includes(hunt) || plain(one.company).includes(hunt))
            : purse.list;

        if (!wanted.length) {
            list.innerHTML = '<li class="app-grids-empty">Κανένα αποτέλεσμα</li>';
            return;
        }

        list.innerHTML = wanted.map(one => `
            <li>
                <button class="app-nav-item${purse.id === one.id ? ' is-on' : ''}"
                        type="button" data-client="${esc(one.id)}">
                    ${faceOf(faceFor(one), 'app-nav-dot')}
                    <span class="app-nav-text">
                        <strong>${esc(one.name)}</strong>
                        <small>${one.owed
                            ? `${esc(euro(one.owed))} εκκρεμεί`
                            : esc(one.company || 'Τακτοποιημένα')}</small>
                    </span>
                    ${one.owed ? '<span class="app-nav-badge" title="Εκκρεμεί πληρωμή">!</span>' : ''}
                </button>
            </li>`).join('');
    };

    // The box is outside the list it filters, so redrawing the list under it
    // never takes the cursor away from what somebody is still typing.
    $('app-find').addEventListener('input', (event) => {
        hunt = plain(event.target.value.trim());
        renderClientNav();
    });

    const loadClients = async () => {
        // A partner is here to do the work. What the work was charged for is
        // not part of it, and the server refuses them either way.
        if (!state.me || state.me.role === 'partner') { purse.list = []; renderClientNav(); return; }

        try {
            const data = await api('/api/clients');
            if (data.clients) purse.list = data.clients;
            else if (data.client) purse.list = [{ ...data.client, owed: (data.money || {}).owed || 0 }];
            else purse.list = [];
        } catch {
            purse.list = [];
        }
        renderClientNav();
    };

    const openClient = async (id) => {
        const mine = state.me.role !== 'admin';
        busy('Φόρτωση…');
        try {
            const data = await api(mine ? '/api/clients' : `/api/clients?id=${encodeURIComponent(id)}`);
            if (!data.client) { toast('Δεν υπάρχει ακόμα λογαριασμός για σένα.', 'bad'); return; }

            purse.id = data.client.id;
            purse.client = data.client;
            purse.money = data.money || { subs: [], entries: [], owed: 0, paid: 0 };
            purse.people = data.people || [];
            purse.grids = data.grids || [];

            $('app-title').textContent = mine ? 'Ο λογαριασμός μου' : data.client.name;
            renderClient();
            showView('client');
            where.write('client', purse.id);

            document.querySelectorAll('.app-nav-item').forEach(item => {
                item.classList.toggle('is-on', item.dataset.client === purse.id);
            });
        } catch (err) {
            toast(explain(err), 'bad');
        } finally {
            busy('');
        }
    };

    // Twelve squares for the year: filled where the month has been paid for,
    // outlined where it has been invoiced and not paid yet, and faint where
    // nothing covers it. The year is the one we are in, and anything older is
    // in the ledger underneath, which is where a year-old month belongs.
    //
    // A quarter fills three of them and a year fills all twelve, without this
    // having to know which: it asks each month whether some period covers it.
    const monthsOf = (sub, boss) => {
        const now = new Date();
        const year = now.getFullYear();
        const ours = purse.money.entries.filter(entry => entry.subId === sub.id && entry.to);

        const cells = MONTHS.map((name, month) => {
            const mm = String(month + 1).padStart(2, '0');
            // Compared as text, never parsed: every date here is already
            // zero-padded, so the thirty-first stands in for the end of any
            // month without having to know how long February is.
            const covering = ours.filter(entry => entry.on <= `${year}-${mm}-31` && entry.to >= `${year}-${mm}-01`);
            const how = covering.some(entry => entry.status === 'paid') ? ' is-paid'
                : covering.length ? ' is-due' : '';
            const said = how === ' is-paid' ? 'πληρωμένος' : how === ' is-due' ? 'εκκρεμεί' : 'χωρίς χρέωση';
            const here = `${how}${month === now.getMonth() ? ' is-now' : ''}`;

            if (!boss) return `<span class="month${here}" title="${name} ${year}: ${said}">${name}</span>`;

            const tip = how === ' is-paid'
                ? `${name} ${year}: πληρωμένος. Πάτα τον για να το πάρεις πίσω.`
                : `${name} ${year}: ${said}. Πάτα τον για να τον σημειώσεις πληρωμένο.`;

            return `<button class="month${here}" type="button" data-do="cover"
                            data-id="${esc(sub.id)}" data-month="${year}-${mm}"
                            title="${tip}">${name}</button>`;
        }).join('');

        return `<div class="months"><span class="months-year">${year}</span>${cells}</div>`;
    };

    const subCard = (sub, boss) => {
        const stopped = Boolean(sub.endedAt);
        const cycle = CYCLE_NAMES[sub.cycle] || 'μήνα';

        const said = stopped ? `Σταμάτησε ${onDay(sub.endedAt)}`
            : sub.paidUntil ? `Πληρωμένο μέχρι ${onDay(sub.paidUntil)}`
            : 'Δεν έχει πληρωθεί ακόμα';

        const owing = sub.due
            ? ` · <span class="is-due">${sub.due === 1 ? 'μία χρέωση εκκρεμεί' : `${sub.due} χρεώσεις εκκρεμούν`}</span>`
            : '';

        return `
            <li class="sub${stopped ? ' is-stopped' : ''}" data-sub="${esc(sub.id)}">
                <div class="sub-top">
                    <span class="sub-name">${esc(sub.title)}</span>
                    <span class="sub-price">${esc(euro(sub.cents))} / ${cycle}</span>
                    ${boss ? `<button class="lister-gear" type="button" data-open="sub"
                                      data-id="${esc(sub.id)}" aria-label="Ρυθμίσεις: ${esc(sub.title)}">${GEAR}</button>` : ''}
                </div>
                <p class="sub-when">${said}${owing}</p>
                ${monthsOf(sub, boss)}
                ${boss ? `
                    <p class="months-how">Πάτα έναν μήνα για να τον σημειώσεις πληρωμένο. Ξαναπάτησέ τον για να το πάρεις πίσω.</p>
                    ${stopped ? '' : `
                        <button class="app-ghost sub-renew" type="button" data-do="renew" data-id="${esc(sub.id)}">
                            Χρέωσε τον επόμενο ${cycle} χωρίς πληρωμή
                        </button>`}` : ''}
            </li>`;
    };

    const ledgerRow = (entry, boss) => {
        const sub = entry.subId && purse.money.subs.find(one => one.id === entry.subId);
        const under = [];
        if (entry.to) under.push(`Καλύπτει ως ${onDay(entry.to)}`);
        if (entry.invoiceNo) under.push(`Τιμολόγιο ${esc(entry.invoiceNo)}`);
        if (sub) under.push(esc(sub.title));

        // Only what there is to offer. An empty row of buttons still takes a
        // line of its own once the layout stacks on a phone.
        const acts = [
            entry.invoiceUrl ? `<a class="app-ghost" href="${esc(entry.invoiceUrl)}"
                                   target="_blank" rel="noopener noreferrer">Τιμολόγιο</a>` : '',
            entry.status !== 'paid' && entry.payUrl ? `<a class="app-ghost is-pay" href="${esc(entry.payUrl)}"
                                   target="_blank" rel="noopener noreferrer">Πληρωμή</a>` : '',
            boss ? `<button class="lister-gear" type="button" data-open="entry"
                            data-id="${esc(entry.id)}" aria-label="Επεξεργασία χρέωσης">${GEAR}</button>` : ''
        ].filter(Boolean);

        return `
            <li class="led" data-entry="${esc(entry.id)}">
                <span class="led-when">${onDay(entry.on)}</span>
                <span class="led-what">
                    <strong>${esc(entry.title)}</strong>
                    ${under.length ? `<small>${under.join(' · ')}</small>` : ''}
                </span>
                <span class="led-sum">${esc(euro(entry.cents))}</span>
                <span class="led-state ${entry.status === 'paid' ? 'is-paid' : 'is-due'}">${
                    entry.status === 'paid' ? 'Πληρώθηκε' : 'Εκκρεμεί'}</span>
                ${acts.length ? `<span class="led-acts">${acts.join('')}</span>` : ''}
            </li>`;
    };

    const renderClient = () => {
        const boss = state.me.role === 'admin';
        const client = purse.client;
        const owned = purse.money;

        // Paid up to the furthest date any running subscription has reached.
        // Nothing is stored for this: it is read off the charges, so it cannot
        // say a month is covered that nobody has paid for.
        const until = owned.subs.filter(sub => !sub.endedAt && sub.paidUntil)
            .map(sub => sub.paidUntil).sort().pop();

        const said = [client.company, client.email, client.phone].filter(Boolean).map(esc).join(' · ');

        $('view-client').innerHTML = `
            <section class="panel client-card">
                <div class="client-id">
                    ${faceOf(faceFor(client), 'client-face')}
                    <div class="client-who">
                        <h2>${esc(client.name)}</h2>
                        <p>${said || 'Χωρίς στοιχεία επικοινωνίας'}</p>
                    </div>
                    ${boss ? `<button class="lister-gear" type="button" data-open="client"
                                      data-id="${esc(client.id)}" aria-label="Ρυθμίσεις πελάτη">${GEAR}</button>` : ''}
                </div>

                <div class="client-sums">
                    ${owned.owed
                        ? `<span class="sum-due"><strong>${esc(euro(owned.owed))}</strong> εκκρεμεί</span>`
                        : '<span><strong>Τακτοποιημένα</strong> όλα</span>'}
                    ${boss ? `<span><strong>${esc(euro(owned.paid))}</strong> πληρωμένα ως τώρα</span>` : ''}
                    ${until ? `<span>Ενεργό μέχρι <strong>${onDay(until)}</strong></span>` : ''}
                </div>

                ${boss && client.note
                    ? `<p class="client-note"><span>Μόνο εσύ</span>${esc(client.note)}</p>` : ''}
            </section>

            <section class="panel">
                <div class="panel-head">
                    <h2>Συνδρομές</h2>
                    <p>Τι τρέχει αυτή τη στιγμή. Οι μήνες από κάτω είναι η φετινή χρονιά: γεμάτος ο πληρωμένος, περιγραμμένος ο τιμολογημένος που δεν έχει πληρωθεί ακόμα, θαμπός αυτός που δεν έχει χρεωθεί καθόλου. Ό,τι παλιότερο είναι στο ιστορικό πιο κάτω.</p>
                </div>

                ${boss ? `
                <form class="new-row" id="new-sub">
                    <input name="title" placeholder="Τι είναι, π.χ. Πρόγραμμα Social Media" maxlength="80" required>
                    <input name="amount" placeholder="Ποσό ανά περίοδο" inputmode="decimal" required>
                    <select name="cycle">
                        <option value="month">Κάθε μήνα</option>
                        <option value="quarter">Κάθε τρίμηνο</option>
                        <option value="year">Κάθε χρόνο</option>
                    </select>
                    <button class="btn btn-primary" type="submit">Νέα συνδρομή</button>
                </form>` : ''}

                <p class="panel-error" role="alert" hidden></p>
                <ul class="subs">${owned.subs.length
                    ? owned.subs.map(sub => subCard(sub, boss)).join('')
                    : '<li class="none-yet">Καμία συνδρομή ακόμα</li>'}</ul>
            </section>

            <section class="panel">
                <div class="panel-head">
                    <h2>Ιστορικό και τιμολόγια</h2>
                    <p>${boss
                        ? 'Κάθε χρέωση όπως εκδόθηκε. Ο σύνδεσμος πάει στο ίδιο το αρχείο του τιμολογίου, όπου κι αν το ανεβάζεις. Τα υπόλοιπα στοιχεία κάθε γραμμής είναι πίσω από το γρανάζι της.'
                        : 'Ό,τι έχει τιμολογηθεί, με τον σύνδεσμο για να κατεβάσεις το κάθε τιμολόγιο.'}</p>
                </div>

                ${boss ? `
                <form class="new-row" id="new-entry">
                    <input name="title" placeholder="Τι αφορά, π.χ. Λογότυπο" maxlength="80" required>
                    <input name="amount" placeholder="Ποσό" inputmode="decimal" required>
                    <input name="on" type="date" aria-label="Ημερομηνία">
                    <button class="btn btn-primary" type="submit">Προσθήκη</button>
                </form>` : ''}

                <p class="panel-error" role="alert" hidden></p>
                <ul class="ledger">${owned.entries.length
                    ? owned.entries.map(entry => ledgerRow(entry, boss)).join('')
                    : '<li class="none-yet">Καμία χρέωση ακόμα</li>'}</ul>
            </section>
        `;
    };

    // --- adding, changing and taking away ------------------------------------
    const afterMoney = async (back, message) => {
        purse.money = back.money;
        renderClient();
        await loadClients();
        toast(message);
    };

    $('view-client').addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.target;
        const kind = form.id === 'new-sub' ? 'sub' : 'entry';

        busy('Αποθήκευση…');
        try {
            const back = await api('/api/clients', {
                method: 'POST',
                body: { kind, clientId: purse.id, ...Object.fromEntries(new FormData(form).entries()) }
            });
            form.reset();
            await afterMoney(back, kind === 'sub' ? 'Η συνδρομή μπήκε.' : 'Η χρέωση μπήκε.');
        } catch (err) {
            complain(form, explain(err));
        } finally {
            busy('');
        }
    });

    $('view-client').addEventListener('click', async (event) => {
        const square = event.target.closest('[data-do="cover"]');
        if (square) {
            busy('Αποθήκευση…');
            try {
                const back = await api('/api/clients', {
                    method: 'POST',
                    body: { kind: 'cover', clientId: purse.id, subId: square.dataset.id, month: square.dataset.month }
                });
                await afterMoney(back, 'Καταχωρήθηκε.');
            } catch (err) {
                toast(explain(err), 'bad');
            } finally {
                busy('');
            }
            return;
        }

        const renewing = event.target.closest('[data-do="renew"]');
        if (renewing) {
            busy('Ανανέωση…');
            try {
                const back = await api('/api/clients', {
                    method: 'POST',
                    body: { kind: 'renew', clientId: purse.id, subId: renewing.dataset.id }
                });
                await afterMoney(back, 'Μπήκε η επόμενη περίοδος και περιμένει πληρωμή.');
            } catch (err) {
                toast(explain(err), 'bad');
            } finally {
                busy('');
            }
            return;
        }

        const gear = event.target.closest('[data-open]');
        if (gear) openMoney(gear.dataset.open, gear.dataset.id);
    });

    // --- the panel behind a gear ---------------------------------------------
    const tray = { kind: null, id: null, icon: null, picked: false };

    const sayMoney = (message) => {
        $('money-error').textContent = message || '';
        $('money-error').hidden = !message;
    };

    const closeMoney = () => {
        tray.kind = null;
        tray.id = null;
        $('money-modal').hidden = true;
        unlock();
    };

    const dayField = (label, name, value) =>
        `<label>${label}<input data-f="${name}" type="date" value="${esc(value || '')}"></label>`;

    const openMoney = (kind, id) => {
        const body = $('money-body');
        sayMoney('');

        if (kind === 'client') {
            const client = purse.client;
            tray.icon = client.avatar || null;
            tray.picked = false;

            $('money-title').textContent = client.name;
            $('money-sub').textContent = 'Τα στοιχεία του, τι του ανήκει, και οι σημειώσεις σου. Τις σημειώσεις δεν τις βλέπει ποτέ ο ίδιος.';

            const people = purse.people;
            const grids = purse.grids;

            body.innerHTML = `
                <div class="row-fields">
                    <label>Όνομα<input data-f="name" value="${esc(client.name)}" maxlength="80"></label>
                    <label>Εταιρεία<input data-f="company" value="${esc(client.company)}" maxlength="80"></label>
                    <label>Email<input data-f="email" value="${esc(client.email)}" maxlength="140"></label>
                    <label>Τηλέφωνο<input data-f="phone" value="${esc(client.phone)}" maxlength="40"></label>
                </div>

                <label class="edit-label pw-head">Φωτογραφία</label>
                ${client.account ? `
                    <div class="face-edit">
                        <span class="face-big" id="client-face"></span>
                        <span class="face-acts">
                            <button class="app-ghost" type="button" data-do="pick-icon">Διάλεξε εικόνα</button>
                            <button class="app-ghost app-danger" type="button" data-do="clear-icon">Αφαίρεση</button>
                        </span>
                    </div>
                    <p class="pw-note">Είναι η φωτογραφία του λογαριασμού ${esc(client.account.name)}: η ίδια που βλέπει κι εκείνος κάτω αριστερά στη δική του οθόνη. Την αλλάζετε και οι δύο και μένει πάντα μία.</p>`
                : `<p class="pw-note">Η φωτογραφία ενός πελάτη είναι η φωτογραφία του λογαριασμού του. Σύνδεσε έναν λογαριασμό από κάτω, αποθήκευσε, και μετά θα την αλλάζεις από εδώ.</p>`}

                <label class="edit-label pw-head" for="client-note">Σημειώσεις, μόνο για σένα</label>
                <textarea class="me-name-field" id="client-note" data-f="note" rows="3" maxlength="2000"
                          placeholder="Ό,τι θες να θυμάσαι γι' αυτόν.">${esc(client.note || '')}</textarea>

                <fieldset class="row-members">
                    <legend>Ποιοι λογαριασμοί είναι δικοί του</legend>
                    ${people.length ? people.map(one => `
                        <label class="member">
                            <input type="checkbox" data-member="${esc(one.id)}"${one.clientId === client.id ? ' checked' : ''}>
                            <span>${esc(one.name)} <small>@${esc(one.username)}</small></span>
                        </label>`).join('')
                        : '<p class="row-none">Δεν υπάρχει ακόμα λογαριασμός πελάτη.</p>'}
                </fieldset>

                <fieldset class="row-members">
                    <legend>Ποια grids είναι δικά του</legend>
                    ${grids.length ? grids.map(one => `
                        <label class="member">
                            <input type="checkbox" data-gridlink="${esc(one.id)}"${one.clientId === client.id ? ' checked' : ''}>
                            <span>${esc(one.name)}</span>
                        </label>`).join('')
                        : '<p class="row-none">Δεν υπάρχει ακόμα grid.</p>'}
                </fieldset>
            `;

            if (client.account) {
                paintFace($('client-face'), { ...faceFor(client), avatar: tray.icon }, 'face-big');
                body.querySelector('[data-do="clear-icon"]').hidden = !tray.icon;
            }
        }

        if (kind === 'sub') {
            const sub = purse.money.subs.find(one => one.id === id);
            if (!sub) return;

            $('money-title').textContent = sub.title;
            $('money-sub').textContent = 'Η συμφωνία. Αλλάζοντάς την δεν αλλάζει καμία χρέωση που έχει ήδη εκδοθεί.';

            body.innerHTML = `
                <div class="row-fields">
                    <label>Τι είναι<input data-f="title" value="${esc(sub.title)}" maxlength="80"></label>
                    <label>Ποσό ανά περίοδο<input data-f="amount" value="${(sub.cents / 100).toFixed(2)}" inputmode="decimal"></label>
                    <label>Κάθε πότε<select data-f="cycle">
                        ${Object.keys(CYCLE_NAMES).map(one =>
                            `<option value="${one}"${one === sub.cycle ? ' selected' : ''}>Κάθε ${CYCLE_NAMES[one]}</option>`).join('')}
                    </select></label>
                    ${dayField('Ξεκίνησε', 'startedAt', sub.startedAt)}
                </div>

                <label class="edit-label pw-head" for="sub-pay">Σύνδεσμος πληρωμής</label>
                <input class="me-name-field" id="sub-pay" data-f="payUrl" value="${esc(sub.payUrl)}"
                       placeholder="https://…" spellcheck="false">
                <p class="pw-note">Μπαίνει μόνος του σε κάθε νέα περίοδο που ανανεώνεις, και ο πελάτης βλέπει κουμπί πληρωμής όσο η χρέωση εκκρεμεί.</p>

                <label class="edit-label pw-head" for="sub-note">Σημείωση, μόνο για σένα</label>
                <textarea class="me-name-field" id="sub-note" data-f="note" rows="2" maxlength="2000">${esc(sub.note || '')}</textarea>

                <label class="member sub-stop">
                    <input type="checkbox" id="sub-ended"${sub.endedAt ? ' checked' : ''}>
                    <span>Έχει σταματήσει</span>
                </label>
            `;
        }

        if (kind === 'entry') {
            const entry = purse.money.entries.find(one => one.id === id);
            if (!entry) return;

            $('money-title').textContent = entry.title;
            $('money-sub').textContent = 'Μία χρέωση, όπως εκδόθηκε. Ο σύνδεσμος του τιμολογίου κρατάει μέσα του το κλειδί του αρχείου, οπότε δώσ\' τον μόνο εδώ.';

            body.innerHTML = `
                <div class="row-fields">
                    <label>Τι αφορά<input data-f="title" value="${esc(entry.title)}" maxlength="80"></label>
                    <label>Ποσό<input data-f="amount" value="${(entry.cents / 100).toFixed(2)}" inputmode="decimal"></label>
                    <label>Κατάσταση<select data-f="status">
                        <option value="due"${entry.status === 'due' ? ' selected' : ''}>Εκκρεμεί</option>
                        <option value="paid"${entry.status === 'paid' ? ' selected' : ''}>Πληρώθηκε</option>
                    </select></label>
                </div>

                <div class="row-fields">
                    <label>Ανήκει σε<select data-f="subId">
                        <option value="">Μεμονωμένη χρέωση</option>
                        ${purse.money.subs.map(sub =>
                            `<option value="${esc(sub.id)}"${sub.id === entry.subId ? ' selected' : ''}>${esc(sub.title)}</option>`).join('')}
                    </select></label>
                    ${dayField('Ημερομηνία', 'on', entry.on)}
                    <label id="entry-covers"${entry.subId ? '' : ' hidden'}>Καλύπτει ως<input data-f="to" type="date" value="${esc(entry.to || '')}"></label>
                    <label>Αριθμός τιμολογίου<input data-f="invoiceNo" value="${esc(entry.invoiceNo)}" maxlength="40"></label>
                </div>

                <label class="edit-label pw-head" for="entry-file">Σύνδεσμος τιμολογίου</label>
                <input class="me-name-field" id="entry-file" data-f="invoiceUrl" value="${esc(entry.invoiceUrl)}"
                       placeholder="https://mega.nz/…" spellcheck="false">

                <label class="edit-label pw-head" for="entry-pay">Σύνδεσμος πληρωμής</label>
                <input class="me-name-field" id="entry-pay" data-f="payUrl" value="${esc(entry.payUrl)}"
                       placeholder="https://…" spellcheck="false">

                <label class="edit-label pw-head" for="entry-note">Σημείωση, μόνο για σένα</label>
                <textarea class="me-name-field" id="entry-note" data-f="note" rows="2" maxlength="2000">${esc(entry.note || '')}</textarea>
            `;
        }

        tray.kind = kind;
        tray.id = id;
        $('money-modal').hidden = false;
        document.body.classList.add('is-locked');
    };

    // The picture is chosen now and saved with the rest of the panel, so that
    // backing out of the panel backs out of the picture too.
    $('money-body').addEventListener('click', (clicked) => {
        const button = clicked.target.closest('button[data-do]');
        if (!button || tray.kind !== 'client') return;

        if (button.dataset.do === 'clear-icon') {
            tray.icon = null;
            tray.picked = true;
            paintFace($('client-face'), { ...faceFor(purse.client), avatar: null }, 'face-big');
            button.hidden = true;
            return;
        }

        if (button.dataset.do !== 'pick-icon') return;

        pickFiles(false, async (files) => {
            sayMoney('');
            busy('Ανέβασμα…');
            try {
                const { url } = await acquire(files[0], SMALL_SIDE, purse.id);
                tray.icon = url;
                tray.picked = true;
                paintFace($('client-face'), { ...faceFor(purse.client), avatar: url }, 'face-big');
                $('money-body').querySelector('[data-do="clear-icon"]').hidden = false;
            } catch (err) {
                sayMoney(explain(err));
            } finally {
                busy('');
            }
        });
    });

    // A period is a thing a subscription has. A one-off invoice is dated; it
    // does not run until a date, so the box for one is not there to be filled.
    $('money-body').addEventListener('change', (changed) => {
        if (tray.kind !== 'entry' || changed.target.dataset.f !== 'subId') return;

        const covers = $('entry-covers');
        covers.hidden = !changed.target.value;
        if (covers.hidden) covers.querySelector('input').value = '';
    });

    $('money-save').addEventListener('click', async () => {
        if (!tray.kind) return;
        const body = $('money-body');
        sayMoney('');
        busy('Αποθήκευση…');

        try {
            if (tray.kind === 'client') {
                const pick = (what) => Array.from(body.querySelectorAll(`[${what}]`))
                    .filter(box => box.checked)
                    .map(box => box.getAttribute(what));

                const sent = {
                    kind: 'client', id: tray.id, ...fields(body),
                    userIds: pick('data-member'), gridIds: pick('data-gridlink')
                };
                if (tray.picked) sent.avatar = tray.icon;

                await api('/api/clients', { method: 'PATCH', body: sent });
            } else {
                const extra = tray.kind === 'sub' ? { ended: $('sub-ended').checked } : {};
                await api('/api/clients', {
                    method: 'PATCH',
                    body: { kind: tray.kind, clientId: purse.id, id: tray.id, ...fields(body), ...extra }
                });
            }

            closeMoney();
            toast('Αποθηκεύτηκε.');
            await openClient(purse.id);
            await loadClients();
        } catch (err) {
            sayMoney(explain(err));
        } finally {
            busy('');
        }
    });

    $('money-delete').addEventListener('click', async () => {
        if (!tray.kind) return;

        const asking = {
            client: 'Να διαγραφεί ο πελάτης μαζί με όλο το ιστορικό χρεώσεών του; Τα grids και οι λογαριασμοί του μένουν, απλώς παύουν να ανήκουν κάπου. Δεν γίνεται αναίρεση.',
            sub: 'Να διαγραφεί η συνδρομή; Οι χρεώσεις που έχει ήδη κάνει μένουν στο ιστορικό.',
            entry: 'Να διαγραφεί αυτή η χρέωση από το ιστορικό;'
        }[tray.kind];
        if (!confirm(asking)) return;

        sayMoney('');
        busy('Διαγραφή…');
        try {
            const tail = tray.kind === 'client'
                ? `kind=client&id=${encodeURIComponent(tray.id)}`
                : `kind=${tray.kind}&id=${encodeURIComponent(tray.id)}&clientId=${encodeURIComponent(purse.id)}`;
            await api(`/api/clients?${tail}`, { method: 'DELETE' });

            const gone = tray.kind === 'client';
            closeMoney();
            toast('Διαγράφηκε.');

            if (gone) {
                purse.id = null;
                await loadClients();
                if (purse.list.length) await openClient(purse.list[0].id);
                else openAccounts();
            } else {
                await openClient(purse.id);
                await loadClients();
            }
        } catch (err) {
            sayMoney(explain(err));
        } finally {
            busy('');
        }
    });

    boot();
})();
