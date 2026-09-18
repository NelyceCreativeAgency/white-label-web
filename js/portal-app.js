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

    // A section says whether it is open, and the page it lives on redraws
    // itself whenever anything changes, so what is open has to be remembered
    // somewhere outside the page or every change would shut it again.
    const folded = {
        all: (() => {
            try { return JSON.parse(localStorage.getItem('nelyce-folds')) || {}; }
            catch { return {}; }
        })(),
        open(name, byDefault) {
            return typeof this.all[name] === 'boolean' ? this.all[name] : byDefault;
        },
        write(name, open) {
            this.all[name] = open;
            try { localStorage.setItem('nelyce-folds', JSON.stringify(this.all)); }
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
        'no-such-file': 'Το αρχείο δεν βρέθηκε.',
        'not-expired': 'Ο σύνδεσμος είναι ακόμα ενεργός.',
        'too-many-files': 'Πάρα πολλά αρχεία σε έναν πελάτη.',
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
        catch (err) {
            // A portal that cannot ask who is here has nothing to show, and
            // used to show exactly that: the empty shell, in silence, which
            // reads as a portal with nothing in it rather than one that could
            // not be reached. It says so now, and keeps saying it, because
            // there is no next step for anybody until this call works.
            if (err.message === 'not-signed-in') return;
            console.error('session', err);
            busy(`Δεν φόρτωσε: ${explain(err)}`);
            toast(explain(err), 'bad');
            return;
        }

        if (!session.user) { location.replace(LOGIN); return; }

        state.me = session.user;
        $('me-name').textContent = state.me.name;
        $('me-role').textContent = ROLE_NAMES[state.me.role] || '';
        renderMe();
        greet();
        $('app-admin-nav').hidden = state.me.role !== 'admin';

        await loadGrids();
        await loadClients();
        await loadProjects();
        fitTabs();
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

        if (view === 'mygrids') { openMyGrids(); return; }
        if (view === 'myprojects') { openMyProjects(); return; }
        if (view === 'profile') { openProfile(); return; }

        if (view === 'accounts' && state.me.role === 'admin') { openAccounts(); return; }
        if (view === 'clients' && state.me.role === 'admin') { openClients(); return; }
        if (view === 'partners' && state.me.role === 'admin') { openPartners(); return; }
        if (view === 'project' && kind && rooms.list.some(one => one.id === kind)) {
            openProject(kind);
            return;
        }
        // Somebody's column of charges: one of the clients in the list, or —
        // for the admin, who has no list of partners to check against — an
        // account, which says what it is in its own prefix.
        if (view === 'client' && kind
            && (purse.list.some(one => one.id === kind)
                || (state.me.role === 'admin' && kind.startsWith('usr_')))) {
            openClient(kind);
            return;
        }

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

    // --- projects ----------------------------------------------------------
    // The team's own rooms. A client has none and is not shown the category at
    // all; everybody else may start one and put whoever they work with on it.
    const rooms = { list: [], people: [], open: null, asks: [], tab: 'me' };

    const loadProjects = async () => {
        if (!state.me || state.me.role === 'client') { rooms.list = []; renderProjectNav(); return; }

        try {
            const data = await api('/api/projects');
            rooms.list = data.projects || [];
            rooms.people = data.people || [];
        } catch {
            rooms.list = [];
        }
        renderProjectNav();
    };

    const renderProjectNav = () => {
        const wrap = $('app-projects-nav');
        const list = $('app-projects');

        wrap.hidden = Boolean(!state.me || state.me.role === 'client');
        if (wrap.hidden) return;

        list.innerHTML = rooms.list.length
            ? rooms.list.map(one => `
                <li>
                    <button class="app-nav-item${rooms.open && rooms.open.id === one.id ? ' is-on' : ''}"
                            type="button" data-project="${esc(one.id)}">
                        ${faceOf({ id: one.id, name: one.name, icon: one.icon }, 'app-nav-dot')}
                        <span class="app-nav-text">
                            <strong>${esc(one.name)}</strong>
                            <small>${one.members.length === 1
                                ? '1 άτομο' : `${one.members.length} άτομα`}</small>
                        </span>
                        ${one.lit ? `<span class="app-nav-badge"
                                           title="Αιτήματα που περιμένουν εσένα">${one.lit}</span>` : ''}
                    </button>
                </li>`).join('')
            : '<li class="app-grids-empty">Κανένα ακόμα</li>';
    };

    const openProject = async (id) => {
        busy('Φόρτωση…');
        try {
            const data = await api(`/api/projects?project=${encodeURIComponent(id)}`);
            rooms.open = data.project;
            rooms.asks = data.asks || [];
            // Opening a room lands on the shelf that is waiting for you, and
            // on what was asked of you when nothing is.
            rooms.tab = (SHELVES.find(one =>
                rooms.asks.some(ask => one.is(ask) && ask.face === 'lit')) || SHELVES[1]).key;

            $('app-title').textContent = data.project.name;
            renderProject();
            showView('project');
            where.write('project', data.project.id);
            renderProjectNav();
        } catch (err) {
            toast(explain(err), 'bad');
        } finally {
            busy('');
        }
    };

    // One request. Who asked, who it is for, what it says, and the one thing
    // there is to do about it. A request to the room says so rather than naming
    // somebody, because a name there would be a lie.
    // The history of one request, in the order it happened: what was written
    // back, and who simply took note. Not a conversation — a conversation is
    // for talking, and this is the record of one thing being settled.
    const askThread = (ask) => {
        const lines = ask.replies.map(one => ({
            at: one.at,
            html: `<li class="say"><strong>${one.by === state.me.id ? 'Εσύ' : esc(one.byName)}</strong>
                       <small>${esc(ago(one.at))}</small>
                       <p>${esc(one.text)}</p></li>`
        })).concat(ask.gotIt.map(one => ({
            at: one.at,
            html: `<li class="say is-note"><strong>${one.id === state.me.id ? 'Εσύ' : esc(one.name)}</strong>
                       <small>${esc(ago(one.at))}</small>
                       <p>Το έλαβε.</p></li>`
        })));

        lines.sort((a, b) => String(a.at).localeCompare(String(b.at)));

        return lines.length
            ? `<ul class="ask-thread">${lines.map(one => one.html).join('')}</ul>`
            : '<p class="ask-thread is-empty">Καμία απάντηση ακόμα.</p>';
    };

    const TICK = '<svg class="tick" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5"/></svg>';

    const askCard = (ask) => {
        const forMe = ask.toId === state.me.id;
        const mine = ask.mine;
        const shut = Boolean(ask.closedAt);

        const whose = !ask.toId
            ? 'προς όλους'
            : forMe ? 'προς εσένα' : `προς ${esc(ask.toName)}`;

        const noted = ask.gotIt.some(one => one.id === state.me.id);
        const seen = ask.gotIt.filter(one => one.id !== state.me.id);
        const answers = ask.replies.length + ask.gotIt.length;

        // Taking note is for whoever was asked. On a request to the room that
        // is anybody in it; on one put to a person, that person.
        const canNote = !shut && !mine && (!ask.toId || forMe);

        return `
            <li class="ask is-${esc(ask.face)}"
                data-ask="${esc(ask.id)}" data-room="${esc((rooms.open && rooms.open.id) || '')}">
                <div class="ask-head">
                    <svg class="ask-go" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M9 18l6-6-6-6"/></svg>
                    <strong class="ask-title">${esc(ask.title)}</strong>
                    <span class="ask-who">${mine ? 'Εσύ' : esc(ask.byName)} · ${whose}${
                        shut ? ' · ολοκληρωμένο' : ''}</span>
                </div>

                ${ask.said ? `<p class="ask-said">${esc(ask.said)}</p>` : ''}

                ${ask.shots.length ? `<div class="ask-shots">${ask.shots.map((url, at) =>
                    `<button class="ask-shot-open" type="button" data-shot="${at}"
                             aria-label="Δες τη ${at + 1}η εικόνα">
                         <img src="${esc(url)}" alt="" loading="lazy">
                     </button>`).join('')}</div>` : ''}

                ${mine && seen.length ? `<p class="ask-seen">${TICK}${seen.length === 1
                    ? `Το έλαβε ${esc(seen[0].name)} · ${esc(ago(seen[0].at))}`
                    : `Το έλαβαν ${seen.length} άτομα · ${esc(ago(seen[seen.length - 1].at))}`}</p>` : ''}

                <div class="ask-do">
                    <span class="ask-when">${esc(ago(ask.at))}${
                        answers ? ` · ${answers === 1 ? '1 απάντηση' : `${answers} απαντήσεις`}` : ''}</span>

                    ${ask.url ? `<a class="app-ghost" href="${esc(ask.url)}"
                                    target="_blank" rel="noopener noreferrer">Άνοιξέ το</a>` : ''}

                    <button class="${shut ? 'app-ghost' : 'btn btn-primary'}" type="button"
                            data-say="${esc(ask.id)}">${shut ? 'Δες το ιστορικό' : 'Άφησε feedback'}</button>

                    ${canNote && !noted
                        ? `<button class="app-ghost ask-note" type="button" data-got="${esc(ask.id)}">${TICK}Το έλαβα</button>`
                        : ''}

                    ${canNote && noted ? `<span class="ask-noted">${TICK}Το έλαβες</span>` : ''}

                    ${mine && !shut ? `<button class="app-ghost" type="button"
                                              data-fix="${esc(ask.id)}">Επεξεργασία</button>` : ''}

                    ${mine ? `<button class="app-ghost" type="button" data-shut="${esc(ask.id)}"
                                      data-to="${shut ? 'open' : 'close'}">${
                        shut ? 'Επαναφορά' : 'Ολοκληρώθηκε'}</button>` : ''}

                    ${mine ? `<button class="file-drop" type="button" data-unask="${esc(ask.id)}"
                                      aria-label="Διαγραφή αιτήματος">&times;</button>` : ''}
                </div>

            </li>`;
    };

    // Two lists, not one. What is waiting on you is what you came here to
    // find, and a request that has already been answered is history: useful,
    // but not the thing you opened the room for. So the room says both, in
    // that order, and says nothing at all about a half that is empty.
    const askList = (rows) => `<ul class="asks">${rows.map(askCard).join('')}</ul>`;

    // A project is read the way an inbox is read: what was sent to everybody,
    // what was sent to you, and what you sent. Three shelves that are always
    // there, because a shelf that disappears when it empties is one you stop
    // trusting to be the whole picture.
    const SHELVES = [
        { key: 'all',  name: 'Προς όλους',
          empty: 'Δεν έχει σταλεί τίποτα σε όλη την ομάδα ακόμα.',
          is: (ask) => !ask.toId },
        { key: 'me',   name: 'Προς εσένα',
          empty: 'Δεν σου έχει ζητήσει κανείς κάτι εδώ ακόμα.',
          is: (ask) => ask.toId === state.me.id },
        // Your own sent things, which is a different kind of list from the two
        // beside it: those are what is being asked of the room and of you, and
        // this is what you have gone and asked. It stands apart so that nobody
        // reads it as the third place to look for work.
        { key: 'mine', name: 'Τα αιτήματά μου', apart: true,
          empty: 'Δεν έχεις ζητήσει κάτι εδώ ακόμα.',
          is: (ask) => ask.by === state.me.id }
    ];

    // What is on one shelf, with whatever is lit on top of it: nothing that is
    // waiting should ever sit under something that has been settled.
    const askShelf = (key) => {
        const shelf = SHELVES.find(one => one.key === (key || rooms.tab)) || SHELVES[0];
        return rooms.asks.filter(shelf.is)
            .sort((a, b) => (b.face === 'lit') - (a.face === 'lit'));
    };

    const renderProject = () => {
        const room = rooms.open;
        if (!room) return;

        const shown = askShelf();

        $('view-project').innerHTML = `
            <section class="panel client-card">
                <div class="client-id">
                    ${faceOf({ id: room.id, name: room.name, icon: room.icon }, 'client-face')}
                    <div class="client-who">
                        <h2>${esc(room.name)}</h2>
                        <p>${room.members.map(one => esc(one.name)).join(' · ')}</p>
                    </div>
                    ${room.mine ? `<button class="lister-gear" type="button" id="prj-open"
                                           aria-label="Ρυθμίσεις project">${GEAR}</button>` : ''}
                </div>
            </section>

            <section class="panel">
                <div class="panel-head">
                    <h2>Αιτήματα</h2>
                    <p>Ό,τι ζητάει ο ένας από τον άλλον μέσα σε αυτό το project.${tip(
                        'Έτσι δεν χάνεται σε αλληλογραφία. Ένα αίτημα προς έναν συγκεκριμένο άνθρωπο το βλέπει μόνο εκείνος. Ένα αίτημα προς όλους το βλέπει η ομάδα.')}</p>
                </div>

                <button class="btn btn-primary" type="button" id="ask-new">Νέο αίτημα</button>

                <div class="room-tabs asks-tabs" role="tablist">
                    ${SHELVES.map(shelf => `
                        <button type="button" role="tab" data-shelf="${shelf.key}"
                                aria-selected="${rooms.tab === shelf.key ? 'true' : 'false'}"
                                class="${rooms.tab === shelf.key ? 'is-on' : ''}${shelf.apart ? ' is-apart' : ''}">
                            ${shelf.name}${(() => {
                                const lit = askShelf(shelf.key).filter(one => one.face === 'lit').length;
                                return lit ? `<span class="asks-pip">${lit}</span>` : '';
                            })()}
                        </button>`).join('')}
                </div>

                ${shown.length
                    ? askList(shown)
                    : `<p class="asks-none">${SHELVES.find(one => one.key === rooms.tab).empty}</p>`}
            </section>
        `;
    };

    const redrawAsks = () => renderProject();

    // Everything a card can be asked to do, in one place, because the cards are
    // the same cards on both pages and each one says which room it belongs to.
    const askDo = async (id, room, body, done) => {
        busy('…');
        try {
            const back = await api('/api/projects', {
                method: 'PATCH', body: { kind: 'ask', project: room, id, ...body }
            });
            rooms.asks = rooms.asks.map(one => (one.id === id ? back.ask : one));
            redrawAsks();
            if (!$('say-modal').hidden && saying.id === id) drawSaid();
            if (done) toast(done);
            // The count on the room in the sidebar is read off the same facts
            // and has just changed with them.
            await loadProjects();
        } catch (err) {
            toast(explain(err), 'bad');
        } finally {
            busy('');
        }
    };

    $('view-project').addEventListener('click', async (event) => {
        if (event.target.closest('#prj-open')) { openProjectPanel(rooms.open); return; }
        if (event.target.closest('#ask-new')) { openAskPanel(); return; }

        const shelf = event.target.closest('[data-shelf]');
        if (shelf) { rooms.tab = shelf.dataset.shelf; renderProject(); return; }

        const card = event.target.closest('.ask');
        if (!card) return;
        const room = card.dataset.room;

        // A picture on a request opens at full size, before anything else on
        // the card gets a chance to open the card itself.
        const shot = event.target.closest('[data-shot]');
        if (shot) {
            const ask = rooms.asks.find(one => one.id === card.dataset.ask);
            if (ask) openShots(ask.shots, Number(shot.dataset.shot));
            return;
        }

        const say = event.target.closest('[data-say]');
        if (say) { openSayPanel(say.dataset.say, room); return; }

        const fix = event.target.closest('[data-fix]');
        if (fix) { openAskPanel(rooms.asks.find(one => one.id === fix.dataset.fix)); return; }

        const got = event.target.closest('[data-got]');
        if (got) { await askDo(got.dataset.got, room, { action: 'got' }, 'Σημειώθηκε.'); return; }

        const shut = event.target.closest('[data-shut]');
        if (shut) {
            const closing = shut.dataset.to === 'close';
            if (closing && !confirm('Να κλειδώσει αυτό το αίτημα ως ολοκληρωμένο; Οι εικόνες του φεύγουν, και αν το επαναφέρεις θα χρειαστεί να ξαναμπούν.')) return;
            await askDo(shut.dataset.shut, room, { action: shut.dataset.to },
                        closing ? 'Ολοκληρώθηκε.' : 'Ξανάνοιξε.');
            return;
        }

        const unask = event.target.closest('[data-unask]');
        if (unask) {
            if (!confirm('Να διαγραφεί αυτό το αίτημα; Ό,τι έχει ειπωθεί πάνω του φεύγει μαζί.')) return;
            busy('Διαγραφή…');
            try {
                await api(`/api/projects?kind=ask&project=${encodeURIComponent(room)}`
                          + `&id=${encodeURIComponent(unask.dataset.unask)}`, { method: 'DELETE' });
                rooms.asks = rooms.asks.filter(one => one.id !== unask.dataset.unask);
                redrawAsks();
                await loadProjects();
                toast('Διαγράφηκε.');
            } catch (err) {
                toast(explain(err), 'bad');
            } finally {
                busy('');
            }
            return;
        }

        // Anywhere else on the card opens the request itself.
        if (event.target.closest('a')) return;
        openSayPanel(card.dataset.ask, room);
    });

    // --- answering one ------------------------------------------------------
    const saying = { id: null, room: null };

    const shutSay = () => {
        saying.id = null;
        $('say-modal').hidden = true;
        unlock();
    };

    // What a request looks like opened: everything said about it so far, and
    // the box to say the next thing. In a panel rather than unfolded in place,
    // because a room with four conversations unfolded inside it is a page
    // nobody can find the bottom of.
    const drawSaid = () => {
        const ask = rooms.asks.find(one => one.id === saying.id);
        if (!ask) return;

        const shut = Boolean(ask.closedAt);

        $('say-title').textContent = ask.title;
        $('say-sub').textContent = `${ask.mine ? 'Εσύ' : ask.byName} · ${
            !ask.toId ? 'προς όλους' : ask.toId === state.me.id ? 'προς εσένα' : `προς ${ask.toName}`}${
            shut ? ' · ολοκληρωμένο' : ''}`;

        $('say-thread').innerHTML = `
            ${ask.said ? `<p class="ask-said">${esc(ask.said)}</p>` : ''}
            ${ask.shots.length ? `<div class="ask-shots">${ask.shots.map(url =>
                `<img src="${esc(url)}" alt="" loading="lazy">`).join('')}</div>` : ''}
            ${ask.url ? `<p class="say-link"><a class="app-ghost" href="${esc(ask.url)}"
                            target="_blank" rel="noopener noreferrer">Άνοιξέ το</a></p>` : ''}
            ${askThread(ask)}`;

        // A finished request is a record. It can be read and not added to.
        $('say-text').hidden = shut;
        $('say-send').hidden = shut;
        $('say-modal').querySelector('label[for="say-text"]').hidden = shut;
    };

    const openSayPanel = async (id, room) => {
        const ask = rooms.asks.find(one => one.id === id);
        if (!ask) return;

        saying.id = id;
        saying.room = room;

        $('say-text').value = '';
        $('say-error').hidden = true;
        drawSaid();

        $('say-modal').hidden = false;
        document.body.classList.add('is-locked');
        if (!ask.closedAt) $('say-text').focus();

        // Opening it is reading it, and reading it is what settles it.
        if (ask.face === 'lit') await askDo(id, room, { action: 'seen' });
    };

    $('say-send').addEventListener('click', async () => {
        const said = $('say-text').value.trim();
        if (!said) {
            $('say-error').textContent = 'Γράψε κάτι πρώτα.';
            $('say-error').hidden = false;
            return;
        }

        $('say-text').value = '';
        // The panel stays open and the answer appears in it, which is what
        // anybody who has just written two sentences expects to see happen.
        await askDo(saying.id, saying.room, { action: 'reply', text: said });
    });

    // --- asking for something ----------------------------------------------
    // Everything a request carries is written in one panel and sent once. The
    // pictures are uploaded as they are chosen, because an upload that waits
    // for a Send button is an upload that happens while somebody watches a
    // spinner wondering whether it worked.
    const asking = { shots: [], id: null };

    const sayAsk = (message) => {
        $('ask-error').textContent = message || '';
        $('ask-error').hidden = !message;
    };

    const shutAsk = () => {
        asking.shots = [];
        asking.id = null;
        $('ask-modal').hidden = true;
        unlock();
    };

    const ASK_SHOTS = 5;

    const drawShots = () => {
        const box = $('ask-shots');
        if (!box) return;
        box.innerHTML = asking.shots.map((url, at) => `
            <span class="ask-shot">
                <img src="${esc(url)}" alt="">
                <button class="file-drop" type="button" data-drop-shot="${at}"
                        aria-label="Αφαίρεση εικόνας">&times;</button>
            </span>`).join('');
        $('ask-add').hidden = asking.shots.length >= ASK_SHOTS;
    };

    // The same panel writes one and changes one. Who it was sent to is the one
    // thing it will not change: that decided who was told and who may read it,
    // and moving it afterwards would take a request out from under somebody who
    // has already been asked.
    const openAskPanel = (ask) => {
        const room = rooms.open;
        if (!room) return;

        asking.id = ask ? ask.id : null;
        asking.shots = ask ? ask.shots.slice() : [];
        sayAsk('');

        const others = room.members.filter(one => one.id !== state.me.id);

        $('ask-title').textContent = ask ? 'Επεξεργασία αιτήματος' : 'Νέο αίτημα';
        $('ask-save').textContent = ask ? 'Αποθήκευση' : 'Αποστολή';
        $('ask-sub').textContent = ask
            ? 'Ό,τι έχει ήδη απαντηθεί μένει εκεί που είναι. Ο παραλήπτης δεν αλλάζει.'
            : 'Διάλεξε σε ποιον πάει. Ό,τι στέλνεις σε έναν άνθρωπο το βλέπει μόνο εκείνος.';

        $('ask-body').innerHTML = `
            ${ask ? `
                <p class="pw-note">Προς ${ask.toId ? esc(ask.toName) : 'όλη την ομάδα'}.</p>`
            : `
                <div class="row-fields">
                    <label>Σε ποιον<select data-f="toId">
                        <option value="">Σε όλη την ομάδα</option>
                        ${others.map(one =>
                            `<option value="${esc(one.id)}">${esc(one.name)}</option>`).join('')}
                    </select></label>
                </div>`}

            <label class="edit-label pw-head" for="ask-what">Τι ζητάς</label>
            <input class="me-name-field" id="ask-what" data-f="title" maxlength="120"
                   value="${esc(ask ? ask.title : '')}"
                   placeholder="π.χ. Τσέκαρε το νέο layout στο Figma">

            <label class="edit-label pw-head" for="ask-more">Λεπτομέρειες, αν χρειάζονται</label>
            <textarea class="me-name-field" id="ask-more" data-f="said" rows="3"
                      maxlength="4000">${esc(ask ? ask.said : '')}</textarea>

            <label class="edit-label pw-head" for="ask-url">Σύνδεσμος, αν υπάρχει</label>
            <input class="me-name-field" id="ask-url" data-f="url" value="${esc(ask ? ask.url : '')}"
                   placeholder="https://…" spellcheck="false">

            <label class="edit-label pw-head">Εικόνες, ως ${ASK_SHOTS}</label>
            <div class="ask-shots is-editing" id="ask-shots"></div>
            <button class="app-ghost" type="button" id="ask-add">Πρόσθεσε εικόνα</button>`;

        drawShots();
        $('ask-modal').hidden = false;
        document.body.classList.add('is-locked');
    };

    $('ask-body').addEventListener('click', (event) => {
        const drop = event.target.closest('[data-drop-shot]');
        if (drop) {
            asking.shots.splice(Number(drop.dataset.dropShot), 1);
            drawShots();
            return;
        }

        if (!event.target.closest('#ask-add')) return;

        pickFiles(true, async (files) => {
            sayAsk('');
            busy('Ανέβασμα…');
            try {
                for (const file of files.slice(0, ASK_SHOTS - asking.shots.length)) {
                    const { url } = await acquire(file, SMALL_SIDE, 'project');
                    asking.shots.push(url);
                    drawShots();
                }
            } catch (err) {
                sayAsk(explain(err));
            } finally {
                busy('');
            }
        });
    });

    $('ask-save').addEventListener('click', async () => {
        const body = $('ask-body');
        const said = {};
        body.querySelectorAll('[data-f]').forEach(field => { said[field.dataset.f] = field.value; });

        if (!said.title.trim()) { sayAsk('Πες τι ζητάς.'); return; }

        sayAsk('');
        busy('Αποθήκευση…');
        try {
            if (asking.id) {
                // Read out before the panel is shut, because shutting it is
                // what empties them.
                const id = asking.id;
                const room = rooms.open.id;
                const shots = asking.shots.slice();
                shutAsk();
                await askDo(id, room, { action: 'edit', ...said, shots }, 'Αποθηκεύτηκε.');
                return;
            }

            const back = await api('/api/projects', {
                method: 'POST',
                body: { kind: 'ask', project: rooms.open.id, ...said, shots: asking.shots }
            });
            rooms.asks.unshift(back.ask);
            shutAsk();
            renderProject();
            await loadProjects();
            toast('Στάλθηκε.');
        } catch (err) {
            sayAsk(explain(err));
        } finally {
            busy('');
        }
    });

    // The room's own settings: what it is called, what it looks like, and who
    // is in it. The same panel starts one and changes one, because there is
    // nothing different to say the first time.
    const roomEdit = { id: null, icon: null, picked: false };

    const sayPrj = (message) => {
        $('prj-error').textContent = message || '';
        $('prj-error').hidden = !message;
    };

    const shutPrj = () => {
        roomEdit.id = null;
        $('prj-modal').hidden = true;
        unlock();
    };

    const openProjectPanel = (room) => {
        roomEdit.id = room ? room.id : null;
        roomEdit.icon = room ? (room.icon || null) : null;
        roomEdit.picked = false;
        sayPrj('');
        closeSidebar();

        const inside = room ? room.memberIds : [state.me.id];
        // Whoever started it cannot be taken off it, so their box is ticked and
        // cannot be unticked. A room you made and cannot enter is a bug wearing
        // the clothes of a permission.
        const owner = room ? room.by : state.me.id;

        $('prj-title').textContent = room ? room.name : 'Νέο project';
        $('prj-sub').textContent = room
            ? 'Το όνομα, η εικόνα, και ποιοι δουλεύουν πάνω σε αυτό.'
            : 'Ένα όνομα, μια εικόνα αν θες, και ποιοι δουλεύουν πάνω σε αυτό. Εσύ μπαίνεις μόνος σου.';

        $('prj-body').innerHTML = `
            <div class="row-fields">
                <label>Όνομα<input data-f="name" value="${esc(room ? room.name : '')}"
                                   maxlength="60" placeholder="π.χ. Ανακατασκευή site"></label>
            </div>

            <label class="edit-label pw-head">Εικόνα</label>
            <div class="face-edit">
                <span class="face-big" id="prj-face"></span>
                <span class="face-acts">
                    <button class="app-ghost" type="button" data-do="pick-prj">Διάλεξε εικόνα</button>
                    <button class="app-ghost app-danger" type="button" data-do="clear-prj"${
                        roomEdit.icon ? '' : ' hidden'}>Αφαίρεση</button>
                </span>
            </div>

            <fieldset class="row-members">
                <legend>Ποιοι δουλεύουν πάνω σε αυτό</legend>
                ${rooms.people.length ? rooms.people.map(one => `
                    <label class="member">
                        <input type="checkbox" data-member="${esc(one.id)}"${
                            inside.includes(one.id) ? ' checked' : ''}${
                            one.id === owner ? ' disabled' : ''}>
                        <span>${esc(one.name)} <small>@${esc(one.username)}</small></span>
                    </label>`).join('')
                    : '<p class="row-none">Δεν υπάρχει άλλος λογαριασμός ακόμα.</p>'}
            </fieldset>`;

        paintFace($('prj-face'),
                  { id: roomEdit.id || state.me.id, name: room ? room.name : 'Νέο', icon: roomEdit.icon },
                  'face-big');

        $('prj-delete').hidden = !room;
        $('prj-modal').hidden = false;
        document.body.classList.add('is-locked');
    };

    $('project-new').addEventListener('click', () => openProjectPanel(null));

    $('prj-body').addEventListener('click', (event) => {
        const button = event.target.closest('[data-do]');
        if (!button) return;

        if (button.dataset.do === 'clear-prj') {
            roomEdit.icon = null;
            roomEdit.picked = true;
            paintFace($('prj-face'), { id: roomEdit.id || state.me.id, name: $('prj-title').textContent }, 'face-big');
            button.hidden = true;
            return;
        }

        if (button.dataset.do !== 'pick-prj') return;

        pickFiles(false, async (files) => {
            sayPrj('');
            busy('Ανέβασμα…');
            try {
                const { url } = await acquire(files[0], SMALL_SIDE, 'project');
                roomEdit.icon = url;
                roomEdit.picked = true;
                paintFace($('prj-face'),
                          { id: roomEdit.id || state.me.id, name: $('prj-title').textContent, icon: url },
                          'face-big');
                $('prj-body').querySelector('[data-do="clear-prj"]').hidden = false;
            } catch (err) {
                sayPrj(explain(err));
            } finally {
                busy('');
            }
        });
    });

    $('prj-save').addEventListener('click', async () => {
        const body = $('prj-body');
        const name = body.querySelector('[data-f="name"]').value.trim();
        if (!name) { sayPrj('Χρειάζεται όνομα.'); return; }

        const memberIds = Array.from(body.querySelectorAll('[data-member]'))
            .filter(box => box.checked)
            .map(box => box.getAttribute('data-member'));

        sayPrj('');
        busy('Αποθήκευση…');
        try {
            const sent = { name, memberIds };
            // An untouched picture is not sent at all, so saving a name can
            // never quietly take a picture away.
            if (roomEdit.picked || !roomEdit.id) sent.icon = roomEdit.icon;

            const back = roomEdit.id
                ? await api('/api/projects', { method: 'PATCH', body: { id: roomEdit.id, ...sent } })
                : await api('/api/projects', { method: 'POST', body: sent });

            shutPrj();
            await loadProjects();
            toast(back.project ? 'Αποθηκεύτηκε.' : 'Αποθηκεύτηκε.');
            if (back.project) await openProject(back.project.id);
        } catch (err) {
            sayPrj(explain(err));
        } finally {
            busy('');
        }
    });

    $('prj-delete').addEventListener('click', async () => {
        if (!roomEdit.id) return;
        if (!confirm('Να διαγραφεί αυτό το project; Ό,τι έχει ειπωθεί μέσα του φεύγει μαζί του.')) return;

        busy('Διαγραφή…');
        try {
            await api(`/api/projects?id=${encodeURIComponent(roomEdit.id)}`, { method: 'DELETE' });
            shutPrj();
            rooms.open = null;
            await loadProjects();
            toast('Διαγράφηκε.');
            if (rooms.list.length) await openProject(rooms.list[0].id);
            else showView('blank');
        } catch (err) {
            sayPrj(explain(err));
        } finally {
            busy('');
        }
    });

    // --- sidebar -----------------------------------------------------------
    const renderSidebar = () => {
        const list = $('app-grids');

        renderChatBadge();

        // For the admin the heading stays and says the list is empty, because
        // an empty list is something they are about to fill. For a client with
        // no grid there is no grid to be waiting for: they never bought one,
        // and the portal is their account and their files.
        $('app-grids-wrap').hidden = Boolean(!state.grids.length && state.me && state.me.role !== 'admin');

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

    // A page opened from a list needs the way back to that list, and the top
    // bar is where somebody is looking when they want it. Only for the admin:
    // a client or a partner reading their own page arrived from nowhere.
    let goingBack = null;

    const showBack = (whither, name) => {
        goingBack = state.me && state.me.role === 'admin' ? whither : null;
        $('app-back').hidden = !goingBack;
        // The arrow says what it does. Where it goes is said to whatever reads
        // labels out loud, and to whoever holds the pointer still over it.
        $('app-back').setAttribute('aria-label', goingBack ? `Πίσω στους ${name}` : '');
        $('app-back').setAttribute('title', goingBack ? name : '');
    };

    $('app-back').addEventListener('click', () => {
        if (goingBack === 'partners') openPartners();
        else if (goingBack === 'clients') openClients();
    });

    // Which sections of the sidebar are shown, and therefore which of them needs
    // a line above it. The first one shown never does; every one after it does.
    const stripeNav = () => {
        let first = true;

        Array.from($('app-nav').children).forEach(part => {
            const shown = !part.hidden;
            part.classList.toggle('is-cut', shown && !first);
            if (shown) first = false;
        });
    };

    // --- folding the sidebar away ---------------------------------------------
    // Folded, a row is an icon and nothing else, so what it said has to be
    // somewhere. It goes on the pointer, taken from the words that are no
    // longer on screen, rather than written a second time in a list here that
    // would go out of date the first time one of them was renamed.
    const railed = {
        read() { try { return localStorage.getItem('nelyce-rail') === '1'; } catch { return false; } },
        write(on) {
            try { on ? localStorage.setItem('nelyce-rail', '1') : localStorage.removeItem('nelyce-rail'); }
            catch { /* nothing to remember with */ }
        }
    };

    const nameRows = () => {
        const on = document.body.classList.contains('is-folded');

        document.querySelectorAll('.app-nav-item, .app-me-who').forEach(row => {
            const said = row.querySelector('strong');
            const name = said ? said.textContent.trim() : '';
            if (on && name) row.setAttribute('title', name);
            else row.removeAttribute('title');
        });
    };

    const fold = (on) => {
        document.body.classList.toggle('is-folded', on);
        $('app-fold').setAttribute('aria-expanded', on ? 'false' : 'true');
        $('app-fold').setAttribute('aria-label', on ? 'Άνοιγμα μενού' : 'Σύμπτυξη μενού');
        $('app-fold').setAttribute('title', on ? 'Άνοιγμα μενού' : 'Σύμπτυξη μενού');
        nameRows();
        railed.write(on);
    };

    $('app-fold').addEventListener('click', () => {
        fold(!document.body.classList.contains('is-folded'));
    });

    // Both of these answer a question about what the sidebar currently holds,
    // so both are watched rather than called from each of the places that add
    // a row or show a section, and a seventh cannot be added and forgotten.
    const freshenNav = () => { stripeNav(); nameRows(); };

    new MutationObserver(freshenNav).observe($('app-nav'), {
        attributes: true, attributeFilter: ['hidden'], childList: true, subtree: true
    });

    // Put back the way it was left, without the putting back being something
    // anybody watches happen: the class goes on, the first frame is drawn with
    // it, and only then is the sidebar allowed to move again.
    document.body.classList.add('is-still');
    fold(railed.read());
    requestAnimationFrame(() => requestAnimationFrame(
        () => document.body.classList.remove('is-still')));

    freshenNav();

    const showView = (name) => {
        // Every view starts with no way back. The two that have one put it
        // there themselves, after this has run.
        showBack(null);

        // And with nothing in the sidebar marked as the open one. Every screen
        // marks its own line afterwards, so a line cannot be left lit by the
        // screen before it — which is what happened to Μηνύματα, because
        // opening a project only ever lit its own and told nobody else.
        document.querySelectorAll('.app-nav-item.is-on')
            .forEach(one => one.classList.remove('is-on'));

        ['grid', 'accounts', 'clients', 'partners', 'chat', 'client', 'project',
         'mygrids', 'myprojects', 'profile', 'blank']
            .forEach(view => {
            $(`view-${view}`).hidden = view !== name;
        });

        // The conversation is the only screen where the window itself should
        // not scroll: the name and the box hold still and the talk between them
        // moves, at every size rather than only on a phone.
        document.body.classList.toggle('is-messages', name === 'chat');

        // Which section of the portal this screen belongs to, for the bar along
        // the bottom of a phone. The admin's three pages are one section, and
        // somebody else's own page is theirs.
        const SECTION = {
            grid: 'grids', mygrids: 'grids',
            project: 'projects', myprojects: 'projects',
            chat: 'chat', profile: 'me',
            accounts: 'admin', clients: 'admin', partners: 'admin',
            client: state.me && state.me.role === 'admin' ? 'admin' : 'account'
        };
        paintTabs(SECTION[name] || null);

        closeSidebar();
        fitToKeyboard(true);
    };

    // --- the bar along the bottom of a phone --------------------------------
    // Which of the six it shows depends on who is looking. Never more than
    // five, so every one of them stays wide enough to hit with a thumb.
    const paintTabs = (which) => {
        document.querySelectorAll('.app-tab').forEach(tab => {
            tab.classList.toggle('is-on', tab.dataset.tab === which);
            tab.setAttribute('aria-current', tab.dataset.tab === which ? 'page' : 'false');
        });
    };

    const fitTabs = () => {
        if (!state.me) return;
        const boss = state.me.role === 'admin';
        const show = {
            grids: true,
            projects: !$('app-projects-nav').hidden,
            chat: !$('app-chat-nav').hidden,
            admin: boss,
            account: !boss && purse.list.length > 0,
            me: true
        };
        document.querySelectorAll('.app-tab').forEach(tab => {
            tab.hidden = !show[tab.dataset.tab];
        });
        $('app-tabs').hidden = false;
    };

    // Every tab lands on a page. Where the desktop has a list in the sidebar
    // the phone gets that list as a page of its own, and where the list holds
    // one thing there is no list worth showing: it goes straight to the thing.
    const openSection = (which) => {
        if (which === 'chat') return openChat();
        if (which === 'me')   return openProfile();

        if (which === 'grids') {
            if (state.grids.length === 1) return openGrid(state.grids[0].id);
            return openMyGrids();
        }

        // Projects always land on the list, even when it holds one, because the
        // way to start a second one is a button on that page. Walking straight
        // past it would leave somebody with one project and no way to have two.
        if (which === 'projects') return openMyProjects();

        if (which === 'admin')   return openClients();
        if (which === 'account') {
            if (purse.list.length) openClient(purse.list[0].id);
        }
    };

    $('app-tabs').addEventListener('click', (event) => {
        const tab = event.target.closest('.app-tab');
        if (tab) openSection(tab.dataset.tab);
    });

    // --- the sections as pages ---------------------------------------------
    // What the sidebar holds as a list, a phone gets as a screen. The same
    // rows, the same faces, the same order; a page rather than a drawer.
    const openMyGrids = () => {
        $('view-mygrids').innerHTML = `
            <section class="panel">
                <div class="panel-head">
                    <h2>Τα grids μου</h2>
                    <p>Πάτα ένα για να το ανοίξεις.</p>
                </div>
                <ul class="lister">${state.grids.length
                    ? state.grids.map(grid => `
                        <li>
                            ${faceOf(grid, 'lister-face')}
                            <span class="lister-who">
                                <span class="lister-name">${esc(grid.name)}</span>
                                <span class="lister-sub">${grid.handle
                                    ? `@${esc(grid.handle)}` : 'Χωρίς handle'}</span>
                            </span>
                            <span class="lister-acts">
                                <button class="lister-gear" type="button" data-grid="${esc(grid.id)}"
                                        aria-label="Άνοιγμα: ${esc(grid.name)}">${ARROW}</button>
                            </span>
                        </li>`).join('')
                    : '<li class="none-yet">Κανένα grid ακόμα</li>'}</ul>
            </section>`;

        $('app-title').textContent = 'Τα grids μου';
        showView('mygrids');
        where.write('mygrids');
    };

    const openMyProjects = () => {
        const mayStart = state.me && state.me.role !== 'client';

        $('view-myprojects').innerHTML = `
            <section class="panel">
                <div class="panel-head">
                    <h2>Projects</h2>
                    <p>Οι ομάδες στις οποίες δουλεύεις.</p>
                </div>

                ${mayStart ? `
                <div class="new-row">
                    <button class="btn btn-primary" type="button" id="myprojects-new">Νέο project</button>
                </div>` : ''}

                <ul class="lister">${rooms.list.length
                    ? rooms.list.map(one => `
                        <li>
                            ${faceOf({ id: one.id, name: one.name, icon: one.icon }, 'lister-face')}
                            <span class="lister-who">
                                <span class="lister-name">${esc(one.name)}</span>
                                <span class="lister-sub">${one.members.length === 1
                                    ? '1 άτομο' : `${one.members.length} άτομα`}</span>
                            </span>
                            <span class="lister-acts">
                                ${one.lit ? `<span class="app-nav-badge"
                                    title="Αιτήματα που περιμένουν εσένα">${one.lit}</span>` : ''}
                                <button class="lister-gear" type="button" data-project="${esc(one.id)}"
                                        aria-label="Άνοιγμα: ${esc(one.name)}">${ARROW}</button>
                            </span>
                        </li>`).join('')
                    : '<li class="none-yet">Κανένα project ακόμα</li>'}</ul>
            </section>`;

        $('app-title').textContent = 'Projects';
        showView('myprojects');
        where.write('myprojects');
    };

    // Both pages hand a tap on to whatever already opens that thing.
    $('view-mygrids').addEventListener('click', (event) => {
        const go = event.target.closest('[data-grid]');
        if (go) openGrid(go.dataset.grid);
    });

    $('view-myprojects').addEventListener('click', (event) => {
        if (event.target.closest('#myprojects-new')) return openProjectPanel(null);
        const go = event.target.closest('[data-project]');
        if (go) openProject(go.dataset.project);
    });

    // --- the profile --------------------------------------------------------
    // Everybody had a card and nobody had anywhere to read one, their own least
    // of all: the details were behind a gear, in a form, which is a thing you
    // fill in rather than a thing you look at. This is the looking at it, with
    // the filling in one press away.
    //
    // Whose card it is depends on who is asking. The admin's is the house's,
    // kept on the document. A partner keeps their own. A client's card is the
    // details we hold about them, which is why there is nothing to press: the
    // one who changes those is us.
    const cardOf = () => {
        if (!state.me) return { fields: [], mine: false, why: '' };

        if (state.me.role === 'admin') {
            return {
                fields: house.mine || {},
                mine: true,
                why: 'Τα στοιχεία μας, όπως τα βλέπουν οι συνεργάτες και οι πελάτες στη σελίδα τους.'
            };
        }

        const own = purse.list[0];

        if (state.me.role === 'partner') {
            return {
                fields: (own && own.billing) || {},
                mine: true,
                why: 'Τα στοιχεία σου για τα παραστατικά, όπως τα βλέπει η Nelyce.'
            };
        }

        return {
            fields: {
                company: (own && own.company) || '',
                email: (own && own.email) || '',
                phone: (own && own.phone) || ''
            },
            mine: false,
            why: 'Τα στοιχεία που έχουμε για σένα. Αν κάτι δεν είναι σωστό, γράψε μας.'
        };
    };

    const openProfile = async () => {
        // The house's card is not carried about with everything else, so it is
        // fetched the first time somebody goes looking for it.
        if (state.me.role === 'admin' && !house.mine) {
            busy('Φόρτωση…');
            try {
                const data = await api('/api/clients?house=1');
                house.mine = data.house;
            } catch { /* the rest of the page is still worth drawing */ }
            finally { busy(''); }
        }

        const card = cardOf();
        const said = BILL_FIELDS.filter(([key]) => card.fields[key]);

        $('view-profile').innerHTML = `
            <section class="panel">
                <div class="client-id">
                    <span class="client-face" id="profile-me"></span>
                    <span class="client-who">
                        <strong>${esc(state.me.name)}</strong>
                        <span>@${esc(state.me.username)} · ${esc(ROLE_NAMES[state.me.role] || '')}</span>
                    </span>
                </div>
            </section>

            <section class="panel">
                <div class="panel-top">
                    <div class="panel-head">
                        <h2>Η καρτέλα μου</h2>
                        <p>${esc(card.why)}</p>
                    </div>
                    ${card.mine ? `<button class="lister-gear" type="button" id="profile-edit"
                            aria-label="Αλλαγή καρτέλας">${GEAR}</button>` : ''}
                </div>

                ${said.length
                    ? `<ul class="bill">${said.map(([key, label]) =>
                        `<li><span>${label}</span><strong>${esc(card.fields[key])}</strong></li>`).join('')}</ul>`
                    : `<p class="bill-none">${card.mine
                        ? 'Δεν τα έχεις συμπληρώσει ακόμα. Πάτα το γρανάζι.'
                        : 'Δεν έχουμε ακόμα στοιχεία για σένα.'}</p>`}
            </section>

            <section class="panel">
                <div class="panel-head">
                    <h2>Ο λογαριασμός μου</h2>
                    <p>Η φωτογραφία και το όνομα που βλέπουν οι υπόλοιποι δίπλα σου.</p>
                </div>
                <div class="profile-acts">
                    <button class="app-ghost" type="button" id="profile-settings">Ρυθμίσεις</button>
                    <button class="app-ghost app-danger" type="button" id="profile-out">Έξοδος</button>
                </div>
            </section>`;

        paintFace($('profile-me'), state.me, 'client-face');

        $('app-title').textContent = 'Το προφίλ μου';
        showView('profile');
        where.write('profile');
    };

    $('view-profile').addEventListener('click', (event) => {
        if (event.target.closest('#profile-settings')) return openMe();
        if (event.target.closest('#profile-out')) return $('logout').click();
        if (!event.target.closest('#profile-edit')) return;

        // The same drawer that edits anybody's card, pointed at whichever one
        // is theirs to change.
        if (state.me.role === 'admin') openMoney('house', null);
        else if (purse.list.length) openClient(purse.list[0].id);
    });

    $('me-profile').addEventListener('click', () => { closeMeMenu(); openProfile(); });

    // --- opening a grid ----------------------------------------------------
    const openGrid = async (id) => {
        busy('Φόρτωση…');
        try {
            const data = await api(`/api/grid?id=${encodeURIComponent(id)}`);
            state.grid = data.grid;
            state.posts = data.posts || [];
            state.moving = null;
            remember.write(id);

            $('app-title').textContent = state.grid.name;
            renderGrid();
            showView('grid');
            where.write('grid', id);

            // After the view has changed, not before: changing it is what puts
            // out whatever was lit last, so a line marked first would be marked
            // and then unmarked in the same breath.
            document.querySelectorAll('.app-nav-item').forEach(item => {
                item.classList.toggle('is-on', item.dataset.grid === id);
            });
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

        $('profile-hint').innerHTML = grid.canEdit
            ? `Πάτα ένα κενό κουτάκι για να ανεβάσεις.${tip(
                'Η νέα φωτογραφία μπαίνει πρώτη, πάνω αριστερά, όπως στο Instagram. Σύρε μια φωτογραφία όπου θες για να την πας εκεί, ή κράτησέ την πατημένη αν είσαι σε κινητό. Τα κουμπιά από κάτω αλλάζουν πόσα κουτάκια έχει το grid.')}`
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
        // Which square was pressed. Normally that is simply what the click
        // landed on, but a pointer that has been captured is reported against
        // the element holding the capture rather than the button underneath
        // it, and the grid holds one from the moment a finger or a mouse goes
        // down on it, in case what follows is a drag. When that happens the
        // click arrives against the grid itself, belongs to no square, and
        // nothing on the grid can be pressed at all. So where the target is
        // not inside a square, the square is whatever is under the pointer.
        const aimed = event.target.closest('.cell')
            ? event.target
            : (document.elementFromPoint(event.clientX, event.clientY) || event.target);

        const cell = aimed.closest('.cell');
        if (!cell) return;

        const slot = Number(cell.dataset.slot);

        // A move is in the air: the next cell that is clicked is where the
        // post lands, whether that slot is taken or free.
        if (state.moving !== null) {
            if (state.moving !== slot && Number.isInteger(slot)) move(state.moving, slot);
            else cancelMove();
            return;
        }

        const act = aimed.closest('[data-act]');
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

        // Given back before the click that follows this is worked out, so that
        // the click is reported against the button it was on rather than
        // against the grid that was holding the pointer.
        if (drag.pointer !== null) {
            try { board.releasePointerCapture(drag.pointer); }
            catch { /* the browser has already taken it back */ }
        }

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

        state.viewing = { slot, index: index || 0, shots: null };
        state.replyTo = null;
        state.editingNote = null;
        showReplying();
        $('post-modal').hidden = false;
        document.body.classList.add('is-locked');
        renderViewer();
    };

    // The page stays still while any of the three panels is open.
    const unlock = () => {
        const open = ['post-modal', 'edit-modal', 'hl-modal', 'acct-modal', 'me-modal',
                      'money-modal', 'prj-modal', 'ask-modal', 'say-modal']
            .some(id => !$(id).hidden);
        if (!open) document.body.classList.remove('is-locked');
    };

    const closeViewer = () => {
        state.viewing = null;
        $('post-modal').hidden = true;
        $('post-modal').classList.remove('is-bare');
        unlock();
    };

    // Pictures on their own: the ones hung on a request, opened the same way a
    // carousel is, with the column beside them put away because there is
    // nothing to say about them here.
    const openShots = (urls, index) => {
        if (!urls.length) return;

        state.viewing = { slot: null, index: index || 0, shots: urls.map(url => ({ url })) };
        state.replyTo = null;
        state.editingNote = null;
        showReplying();

        $('post-modal').classList.add('is-bare');
        $('post-modal').hidden = false;
        document.body.classList.add('is-locked');
        renderViewer();
    };

    const renderViewer = () => {
        const { slot, index, shots } = state.viewing;
        const post = shots ? null : state.posts[slot];
        if (!post && !shots) { closeViewer(); return; }

        const images = post ? post.images : shots;

        // The strip is rebuilt only when what is on it has changed. Every note
        // written about a post comes back through here, and rebuilding it would
        // fetch every picture again to show the same ones.
        const track = $('post-track');
        const key = post
            ? `${post.id}:${post.updatedAt || ''}:${post.images.length}`
            : `shots:${images.map(one => one.url).join('|')}`;

        if (track.dataset.key !== key) {
            track.dataset.key = key;
            track.innerHTML = images
                .map(one => `<img src="${esc(one.url)}" alt="" draggable="false">`).join('');
        }

        const many = images.length > 1;
        $('post-prev').hidden = !many;
        $('post-next').hidden = !many;
        $('post-count').hidden = !many;
        $('post-dots').innerHTML = many ? images.map(() => '<span></span>').join('') : '';

        markIndex();
        placeTrack(0, false);

        // Everything below belongs to a post. Pictures on their own have none
        // of it, and the column that holds it is put away rather than left
        // standing empty beside them.
        if (!post) return;

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

    // What the viewer is showing. A post's pictures, or the ones hung on a
    // request, which have no caption, no heart and nothing said under them.
    // Everything that only needs to know how many there are asks here, so the
    // arrows, the dots, the keyboard and the finger all work either way.
    const showing = () => {
        if (!state.viewing) return [];
        if (state.viewing.shots) return state.viewing.shots;
        const post = state.posts[state.viewing.slot];
        return post ? post.images : [];
    };

    const markIndex = () => {
        if (!state.viewing) return;

        const images = showing();
        if (!images.length) return;

        const at = state.viewing.index;
        $('post-count').textContent = `${at + 1}/${images.length}`;

        Array.from($('post-dots').children)
            .forEach((one, i) => one.classList.toggle('is-on', i === at));
    };

    // Everything that changes which picture is showing goes through here: the
    // arrows, the keyboard and the finger all mean the same thing.
    const goTo = (want) => {
        const images = showing();
        const count = images.length;
        if (!count) return;

        state.viewing.index = ((want % count) + count) % count;

        placeTrack(0, true);
        markIndex();

        const post = state.viewing.shots ? null : state.posts[state.viewing.slot];
        if (post) renderLike(post, post.images[state.viewing.index]);
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

    // Guarded, because an arrow is a button on a page and a button on a page
    // can be reached when the thing it pages through is not open.
    $('post-prev').addEventListener('click', () => { if (state.viewing) goTo(state.viewing.index - 1); });
    $('post-next').addEventListener('click', () => { if (state.viewing) goTo(state.viewing.index + 1); });

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

        // Four things a picture can be for, and only one of them is a grid.
        // Each word here has to be answered by name: anything this does not
        // recognise falls through to the grid, and a picture that was never
        // meant for one then fails saying the grid could not be found, which
        // sends whoever is reading it looking in the wrong place.
        const belongs = where === 'me' ? { kind: 'me' }
            : where === 'project' ? { kind: 'project' }
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
        const res = await fetch('/api/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ kind: 'link', grid: state.grid.id, url })
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
            else if (button.closest('#prj-modal')) shutPrj();
            else if (button.closest('#ask-modal')) shutAsk();
            else if (button.closest('#say-modal')) shutSay();
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
            if (!$('hello').hidden) hush();
            else if (!$('me-menu').hidden) closeMeMenu();
            else if (!$('bell-panel').hidden) closeBell();
            else if (!$('me-modal').hidden) closeMe();
            else if (!$('picker').hidden) picker.close();
            else if (!$('say-modal').hidden) shutSay();
            else if (!$('ask-modal').hidden) shutAsk();
            else if (!$('prj-modal').hidden) shutPrj();
            else if (!$('money-modal').hidden) closeMoney();
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
            if (showing().length > 1) {
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


    // --- the light the portal is lit by --------------------------------------
    // Everything the lights are is in the stylesheet. This says two things to
    // it: which pair of colours, and whether there is to be any light at all.
    //
    // A choice is those two colours, kept as one string with a bar between
    // them, so what was written last time is one thing to read and one thing
    // to put back. A value saved before there were two is a single colour and
    // still reads: the swatch it came from is asked what goes with it.
    //
    // Remembered here rather than on the server, like the fold: it is how this
    // browser looks to whoever is at it, and a round trip to be told the
    // colour of your own background is a round trip too many. Which does mean
    // it does not follow anybody to another machine — and is why somebody
    // arriving on a new one is told where the switch is (see greet, below).
    const LEVEL = 40;

    // The top of the bar. It was a hundred, which let somebody light the room
    // brightly enough that the tinted things in it stopped being tinted: the
    // selected row went nearly solid, the rules across the sidebar became
    // stripes. Eighty is the brightest the portal looks good at, so the bar
    // ends there rather than ending past it and asking people not to go.
    const MOST = 80;

    const glow = {
        read() { try { return localStorage.getItem('nelyce-glow'); } catch { return null; } },
        write(value) {
            try { localStorage.setItem('nelyce-glow', value); }
            catch { /* nothing to remember with */ }
        }
    };

    // How much of it, nought to MOST. Nothing written yet is not nought:
    // Number(null) is nought, and reading it that way would open the portal
    // dark for everybody and call it their choice. Anything else that is not a
    // number at all is somebody else's rubbish in our key, and is ignored.
    //
    // A number above MOST is not rubbish, though — it is somebody who set the
    // bar higher back when the bar went higher. That is brought down to the
    // new top rather than thrown away for the default: they asked for as much
    // light as there was, and this is as much as there is.
    const level = {
        read() {
            try {
                const saved = localStorage.getItem('nelyce-level');
                if (!saved) return LEVEL;
                const asked = Number(saved);
                if (!Number.isFinite(asked) || asked < 0) return LEVEL;
                return Math.min(asked, MOST);
            } catch { return LEVEL; }
        },
        write(value) {
            try { localStorage.setItem('nelyce-level', String(value)); }
            catch { /* nothing to remember with */ }
        }
    };

    const dots = () => document.querySelectorAll('.me-tint-dot');

    const pairOf = (hue) => {
        const dot = [...dots()].find(one => one.dataset.glow === hue);
        return (dot && dot.dataset.glowTwo) || hue;
    };

    // The two things anybody can say about the light — which colour and how
    // much of it — and one place that puts both on. Either of them alone can
    // mean darkness: no colour chosen, or none of it asked for.
    let hue = glow.read();
    let much = level.read();

    const relight = () => {
        const root = document.documentElement;
        const bar = $('me-tint-bar');
        const [one, two] = String(hue || '').split('|');

        if (one) {
            root.style.setProperty('--glow', one);
            root.style.setProperty('--glow-2', two || pairOf(one));
        }
        root.style.setProperty('--glow-lvl', String(much));
        root.classList.toggle('is-lit', Boolean(one) && much > 0);

        bar.value = much;
        bar.style.setProperty('--fill', `${(much / MOST) * 100}%`);
        bar.disabled = !one;

        dots().forEach(dot => {
            dot.setAttribute('aria-checked',
                dot.dataset.glow === (one || '') ? 'true' : 'false');
        });
    };

    $('me-tint').addEventListener('click', (event) => {
        const dot = event.target.closest('.me-tint-dot');
        if (!dot) return;
        hue = dot.dataset.glow ? `${dot.dataset.glow}|${dot.dataset.glowTwo}` : '';
        glow.write(hue);
        relight();
    });

    // On input rather than on change, so the page is what the bar says while
    // it is still being dragged: the only way to set a light is to look at it.
    $('me-tint-bar').addEventListener('input', () => {
        much = Number($('me-tint-bar').value);
        level.write(much);
        relight();
    });

    // The colour and the level are already on the document — the head put them
    // there before the first frame. This is the menu catching up with them.
    relight();

    // --- said once a day ----------------------------------------------------
    // Somebody opening the portal gets one line about where the light switch
    // is, the first time they open it on a given day. A switch nobody finds is
    // the same as no switch, and once a day is often enough to be found
    // without being in the way of anybody working: after the first hello the
    // rest of the day is quiet, and tomorrow it says it again.
    //
    // Remembered per browser, like the colour. That is the right unit for it:
    // what it is explaining is where a thing is on the screen in front of
    // them, and a new screen is a fair reason to be told again.
    const today = () => {
        const now = new Date();
        const two = (n) => String(n).padStart(2, '0');
        return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
    };

    const greeted = {
        read() {
            try {
                return localStorage.getItem('nelyce-hello') === today();
            } catch { return true; }
        },
        write() {
            try { localStorage.setItem('nelyce-hello', today()); }
            catch { /* nothing to remember with */ }
        }
    };

    const hush = () => {
        if ($('hello').hidden) return;
        $('hello').hidden = true;
        document.body.classList.remove('is-greeting');
        greeted.write();
    };

    // A beat after the portal has finished arriving, so it is not one more
    // thing landing in the middle of everything else landing.
    const greet = () => {
        if (greeted.read()) return;
        setTimeout(() => {
            if (greeted.read()) return;
            $('hello').hidden = false;
            document.body.classList.add('is-greeting');
            // Written the moment it is shown, not when it is dismissed: it has
            // been said for today either way, and a reload is not a new day.
            greeted.write();
        }, 900);
    };

    $('hello-ok').addEventListener('click', hush);

    // Going to the gear is the same answer as pressing the button, and a
    // better one: they have done the thing it was asking for.
    $('me-open').addEventListener('click', hush);
    $('me-tint').addEventListener('click', hush);

    document.addEventListener('click', (event) => {
        // The Προφίλ tab opens this menu, and its click carries on up to here.
        // Without it in the exception the menu would close on the way.
        if (!$('me-menu').hidden && !event.target.closest('.app-me, .app-tab')) closeMeMenu();
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
        idea:   'πρόσθεσε μια ιδέα στο brainstorming',
        'file-ask': 'ζητάει ξανά τον σύνδεσμο ενός αρχείου',
        bill:   'σου καταχώρισε τιμολόγιο',
        ask:    'σου ζητάει κάτι',
        'ask-back': 'απάντησε σε ένα αίτημα',
        'ask-got':  'έλαβε το αίτημά σου'
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

    const FILE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true">'
        + '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/>'
        + '<path d="M14 3v5h5"/></svg>';

    const BILL_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true">'
        + '<path d="M5 3v18l2-1.4 2 1.4 2-1.4 2 1.4 2-1.4 2 1.4V3l-2 1.4L13 3l-2 1.4L9 3 7 4.4z"/>'
        + '<path d="M9 8h6M9 12h6"/></svg>';

    const BELL_ICONS = {
        chat: SAID_ICON,
        'file-ask': FILE_ICON,
        bill: BILL_ICON,
        ask: IDEA_ICON,
        'ask-back': SAID_ICON,
        'ask-got': SAID_ICON,
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

        // A request opens the room it was asked in.
        if (['ask', 'ask-back', 'ask-got'].includes(event.kind)) {
            if (event.projectId) await openProject(event.projectId);
            return;
        }

        // A bill opens the page of whoever sent it, which is the page it is on.
        if (event.kind === 'bill') {
            if (event.actorId) await openClient(event.actorId);
            return;
        }

        // A request for a file opens the page it was asked from, where the row
        // that is waiting says so itself.
        if (event.kind === 'file-ask') {
            if (event.clientId) await openClient(event.clientId);
            return;
        }

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
        // Anybody who is not the admin can always write to the admin, grid or
        // no grid: a client who is not on a project still has somebody to ask
        // how to be on one. The admin's own button waits until there is a
        // portal for it to be about.
        $('app-chat-nav').hidden = Boolean(!state.grids.length && (!state.me || state.me.role === 'admin'));
        // What the button is about, for somebody it is only half about.
        $('nav-chat').querySelector('small').textContent =
            state.grids.length ? 'Ομάδα και προσωπικά' : 'Προσωπικά μηνύματα';
        $('nav-chat').classList.toggle('has-new', Boolean(total));
        $('nav-chat-badge').hidden = !total;
        $('nav-chat-badge').textContent = total > 99 ? '99+' : String(total || '');
        // The same news, in the one place a number has nowhere to go.
        $('tab-chat-pip').hidden = !total;
        fitTabs();
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

        // Somebody who is on no project has one kind of conversation, and a
        // pair of tabs where one of them can only ever be empty is a choice
        // that is not a choice.
        const alone = !c.teams.length;
        if (alone) c.kind = 'people';
        $('chat-kinds').hidden = alone;

        // A dot on the tab that has something waiting, so the other kind is
        // never the one being missed.
        document.querySelectorAll('#chat-kinds button').forEach(button => {
            const kind = button.dataset.kind;
            const on = kind === c.kind;
            button.classList.toggle('is-on', on);
            button.setAttribute('aria-selected', on ? 'true' : 'false');
            button.querySelector('.chat-pip').hidden = !count(kind === 'teams' ? c.teams : c.people);
        });

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
    // There is no drawer any more, on any screen. On a phone every section has
    // a tab along the bottom and every tab lands on a page of its own; on a
    // desktop the sidebar is simply standing there. Nothing is slid over
    // anything, so there is nothing to close: this is kept because every screen
    // calls it on its way in and one empty function is cheaper than finding
    // them all to say the same nothing.
    const closeSidebar = () => {};

    $('app-side').addEventListener('click', (event) => {
        const item = event.target.closest('.app-nav-item');
        if (!item) return;

        if (item.dataset.grid) openGrid(item.dataset.grid);
        else if (item.dataset.project) openProject(item.dataset.project);
        else if (item.dataset.client) openClient(item.dataset.client);
        else if (item.dataset.view === 'chat') openChat();
        else if (item.dataset.view === 'accounts') openAccounts();
        else if (item.dataset.view === 'clients') openClients();
        else if (item.dataset.view === 'partners') openPartners();

        // On a phone the drawer is over the thing it was just asked to open.
        closeSidebar();
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
            $('app-title').textContent = 'Grids';
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

    // The arrow a section is opened by. It points down while the section is
    // shut, which is the direction the section will come from.
    const CARET = '<svg class="fold-arrow" viewBox="0 0 24 24" aria-hidden="true">'
        + '<path d="M6 9l6 6 6-6"/></svg>';

    const EYE = '<button class="pw-eye" type="button" aria-pressed="false" aria-label="Εμφάνιση κωδικού">'
        + '<svg class="pw-open" viewBox="0 0 24 24" aria-hidden="true">'
        + '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
        + '<svg class="pw-shut" viewBox="0 0 24 24" aria-hidden="true">'
        + '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 '
        + '9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>'
        + '<path d="M1 1l22 22"/></svg></button>';

    const people = (count) => (count === 1 ? '1 άτομο' : `${count} άτομα`);

    const ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';

    // --- what a panel is, and the rules behind it ---------------------------
    // A panel used to explain itself in a paragraph, which meant everybody read
    // the rules of the house every time they came to look at one number. The
    // line above a panel now says what it is, in one breath, and everything
    // that is true but only needed once sits behind the i beside it.
    //
    // Opened by click, because half the people here are on a phone and a phone
    // has no hover. On a mouse, hovering shows it too — that is the stylesheet
    // being generous, not the way in.
    const tip = (more) => more ? `
        <span class="why-tip">
            <button class="why-i" type="button" aria-expanded="false"
                    aria-label="Περισσότερα">i</button>
            <span class="why-more" role="note">${more}</span>
        </span>` : '';

    const why = (line, more) => `<p class="panel-why">${line}${tip(more)}</p>`;

    // One open at a time, and a click anywhere else closes it.
    document.addEventListener('click', (event) => {
        const asked = event.target.closest('.why-i');
        const tip = asked && asked.parentElement;

        document.querySelectorAll('.why-tip.is-open').forEach(one => {
            if (one === tip) return;
            one.classList.remove('is-open');
            one.querySelector('.why-i').setAttribute('aria-expanded', 'false');
        });

        if (!tip) return;
        const open = tip.classList.toggle('is-open');
        asked.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        document.querySelectorAll('.why-tip.is-open').forEach(one => {
            one.classList.remove('is-open');
            one.querySelector('.why-i').setAttribute('aria-expanded', 'false');
        });
    });

    const line = (id, what, name, under, person, go) => `
        <li>
            ${faceOf(person || { id, name }, 'lister-face', dot(person))}
            <span class="lister-who">
                <span class="lister-name">${esc(name)}</span>
                <span class="lister-sub">${under}</span>
            </span>
            <span class="lister-acts">
                ${go ? `<button class="lister-gear" type="button" data-go="${esc(id)}"
                                aria-label="Τιμολόγια: ${esc(name)}">${ARROW}</button>` : ''}
                <button class="lister-gear" type="button" data-open="${what}" data-id="${esc(id)}"
                        aria-label="Ρυθμίσεις: ${esc(name)}">${GEAR}</button>
            </span>
        </li>`;

    // Which client something belongs to, said by name. Used by every page that
    // lists something a client can own.
    const named = (clientId) => {
        const one = purse.list.find(client => client.id === clientId);
        return one ? ` · ${esc(one.name)}` : '';
    };

    const renderAccounts = () => {
        // What a partner is still waiting to be paid, said on the line their
        // name is on. Without it, a bill from one of them would sit on a page
        // there is no reason to open.
        const waitingFor = (user) => {
            if (user.role !== 'partner') return '';
            const one = purse.partners.find(row => row.id === user.id);
            return one && one.owed ? ` · <span class="is-due">${esc(euro(one.owed))} προς πληρωμή</span>` : '';
        };

        const gridLines = admin.grids
            .map(grid => line(grid.id, 'grid', grid.name,
                `${grid.handle ? `@${esc(grid.handle)} · ` : ''}${people((grid.memberIds || []).length)}${named(grid.clientId)}`,
                grid))
            .join('');

        $('view-accounts').innerHTML = `
            <section class="panel">
                <div class="panel-head">
                    <h2>Grids</h2>
                    <p>Ένα grid ανά σελίδα Instagram.${tip(
                        'Το γρανάζι του λέει ποιος δουλεύει πάνω του και σε ποιον πελάτη ανήκει. Τους συνεργάτες και τους πελάτες τους φτιάχνεις στις δικές τους σελίδες και τους αντιστοιχείς εδώ.')}</p>
                </div>

                <form class="new-row" id="new-grid">
                    <input name="name" placeholder="Όνομα, π.χ. Vito" maxlength="60" required>
                    <input name="handle" placeholder="Instagram handle" maxlength="40">
                    <button class="btn btn-primary" type="submit">Νέο grid</button>
                </form>

                <p class="panel-error" id="grid-error" role="alert" hidden></p>
                <ul class="lister">${gridLines}</ul>
            </section>

        `;
    };

    // --- the people who do the work, on a page of their own ----------------
    // A partner is an account and nothing else: there is no record behind them
    // the way there is behind a client, so the account is made here and that
    // is the whole of it. The arrow opens what has been invoiced between us.
    const userForm = (id, role, extra) => `
        <form class="new-row" id="${id}">
            <input name="name" placeholder="Όνομα" maxlength="60" required>
            <input name="username" placeholder="Όνομα χρήστη, λατινικά" maxlength="32"
                   pattern="[A-Za-z0-9._\-]{3,32}"
                   title="3 ως 32 λατινικοί χαρακτήρες, αριθμοί, τελεία, παύλα ή κάτω παύλα, χωρίς κενά"
                   autocapitalize="none" spellcheck="false" required>
            ${extra || ''}
            <input type="hidden" name="role" value="${role}">
            <span class="pw-field">
                <input name="password" type="password" placeholder="Κωδικός, 8+ χαρακτήρες"
                       minlength="8" autocomplete="new-password" required>
                ${EYE}
            </span>
            <button class="btn btn-primary" type="submit">Προσθήκη</button>
        </form>`;

    const renderPartners = () => {
        const owed = (user) => {
            const one = purse.partners.find(row => row.id === user.id);
            return one && one.owed ? ` · <span class="is-due">${esc(euro(one.owed))} προς πληρωμή</span>` : '';
        };

        const partners = admin.users.filter(user => user.role === 'partner');
        const bosses = admin.users.filter(user => user.role === 'admin');

        $('view-partners').innerHTML = `
            <section class="panel">
                <div class="panel-head">
                    <h2>Συνεργάτες</h2>
                    <p>Όποιος δουλεύει μαζί σου.${tip(
                        'Ο λογαριασμός φτιάχνεται εδώ και από εδώ μπαίνει σε projects και σε grids. Το όνομα είναι για τα μάτια σας και δέχεται ελληνικά, το όνομα χρήστη είναι αυτό που πληκτρολογεί στην είσοδο. Το βελάκι ανοίγει τα τιμολόγια μεταξύ σας, το γρανάζι όλα τα υπόλοιπα.')}</p>
                </div>

                ${userForm('new-partner', 'partner')}

                <p class="panel-error" id="user-error" role="alert" hidden></p>
                <ul class="lister">${partners.length
                    ? partners.map(user => line(user.id, 'user', user.name,
                        `@${esc(user.username)}${owed(user)} · ${esc(here(user))}`, user, true)).join('')
                    : '<li class="none-yet">Κανένας συνεργάτης ακόμα</li>'}</ul>
            </section>

            <section class="panel">
                <div class="panel-head">
                    <h2>Διαχειριστές</h2>
                    <p>Οι λογαριασμοί που τα βλέπουν όλα.${tip(
                        'Είναι εδώ για να μπορείς να αλλάξεις κωδικό ή όνομα, και για να μη γίνεται αυτό από πουθενά αλλού.')}</p>
                </div>
                <ul class="lister">${bosses.map(user => line(user.id, 'user', user.name,
                    `@${esc(user.username)} · ${esc(here(user))}`, user)).join('')}</ul>
            </section>`;
    };

    const openPartners = async () => {
        busy('Φόρτωση…');
        try {
            const data = await api('/api/accounts');
            admin.users = data.users || [];
            admin.grids = data.grids || [];
            await loadClients();
            $('app-title').textContent = 'Συνεργάτες';
            renderPartners();
            showView('partners');
            where.write('partners');
            document.querySelectorAll('.app-nav-item').forEach(item => {
                item.classList.toggle('is-on', item.dataset.view === 'partners');
            });
        } catch (err) {
            toast(explain(err), 'bad');
        } finally {
            busy('');
        }
    };

    $('view-partners').addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.target;
        try {
            await api('/api/accounts', {
                method: 'POST',
                body: { kind: 'user', ...Object.fromEntries(new FormData(form).entries()) }
            });
            form.reset();
            toast('Ο συνεργάτης μπήκε.');
            await openPartners();
        } catch (err) {
            complain(form, explain(err));
        }
    });

    // After a change behind a gear, the page somebody is actually on is the one
    // that should come back — not always the grids.
    const refreshAdmin = async () => {
        if (!$('view-partners').hidden) return openPartners();
        if (!$('view-clients').hidden) return openClients();
        return openAccounts();
    };

    $('view-partners').addEventListener('click', (event) => {
        const go = event.target.closest('[data-go]');
        if (go) { openClient(go.dataset.go); return; }

        const gear = event.target.closest('[data-open]');
        if (gear) openDrawer(gear.dataset.open, gear.dataset.id);
    });

    // --- the clients, on a page of their own -------------------------------
    // Every client in the sidebar was every client in the sidebar: fine with
    // four, unreadable with forty, and in the way of the work either way. They
    // are a place you go to, like the accounts, not a list you live beside.
    const renderClients = () => {
        const many = purse.list.length > LONG_LIST;

        const wanted = hunt
            ? purse.list.filter(one => plain(one.name).includes(hunt)
                                    || plain(one.company).includes(hunt))
            : purse.list;

        $('view-clients').innerHTML = `
            <section class="panel">
                <div class="panel-head">
                    <h2>Πελάτες</h2>
                    <p>Αυτοί που τιμολογείς. Πάτα έναν για τα τιμολόγια, τις συνδρομές και τα αρχεία του.</p>
                </div>

                <form class="new-row" id="new-client">
                    <input name="name" placeholder="Όνομα, π.χ. Μελίνα Φωτεινού" maxlength="80" required>
                    <input name="company" placeholder="Εταιρεία, αν υπάρχει" maxlength="80">
                    <button class="btn btn-primary" type="submit">Νέος πελάτης</button>
                </form>

                ${many ? `
                    <input class="me-name-field" id="client-hunt" type="search" value="${esc(hunt)}"
                           placeholder="Αναζήτηση πελάτη" aria-label="Αναζήτηση πελάτη"
                           autocomplete="off" autocapitalize="none" spellcheck="false">` : ''}

                <p class="panel-error" id="client-error" role="alert" hidden></p>
                <ul class="lister" id="client-list">${wanted.length
                    ? wanted.map(one => `
                        <li>
                            ${faceOf(faceFor(one), 'lister-face')}
                            <span class="lister-who">
                                <span class="lister-name">${esc(one.name)}</span>
                                <span class="lister-sub">${one.owed
                                    ? `<span class="is-due">${esc(euro(one.owed))} εκκρεμεί</span>`
                                    : esc(one.company || 'Τακτοποιημένα')}</span>
                            </span>
                            <span class="lister-acts">
                                <button class="lister-gear" type="button" data-go="${esc(one.id)}"
                                        aria-label="Άνοιγμα: ${esc(one.name)}">${ARROW}</button>
                            </span>
                        </li>`).join('')
                    : `<li class="none-yet">${purse.list.length
                        ? 'Κανένα αποτέλεσμα' : 'Κανένας πελάτης ακόμα'}</li>`}</ul>
            </section>

            <section class="panel">
                <div class="panel-head">
                    <h2>Λογαριασμοί πελατών</h2>
                    <p>Οι άνθρωποι που κάνουν είσοδο. Ένας πελάτης μπορεί να έχει δύο, και βλέπουν το ίδιο ιστορικό.</p>
                </div>

                ${userForm('new-client-user', 'client',
                    `<select name="clientId" aria-label="Σε ποιον πελάτη">
                        <option value="">Χωρίς πελάτη ακόμα</option>
                        ${purse.list.map(one =>
                            `<option value="${esc(one.id)}">${esc(one.name)}</option>`).join('')}
                    </select>`)}

                <p class="panel-error" id="client-user-error" role="alert" hidden></p>
                <ul class="lister">${(() => {
                    const rows = admin.users.filter(user => user.role === 'client');
                    return rows.length
                        ? rows.map(user => line(user.id, 'user', user.name,
                            `@${esc(user.username)}${named(user.clientId)} · ${esc(here(user))}`, user)).join('')
                        : '<li class="none-yet">Κανένας λογαριασμός πελάτη ακόμα</li>';
                })()}</ul>
            </section>`;
    };

    const openClients = async () => {
        await loadClients();
        // The accounts are wanted here too, because the people who sign in on
        // behalf of a client are made on this page.
        try {
            const data = await api('/api/accounts');
            admin.users = data.users || [];
            admin.grids = data.grids || [];
        } catch { /* the list of clients is still worth drawing */ }

        $('app-title').textContent = 'Πελάτες';
        renderClients();
        showView('clients');
        where.write('clients');
        document.querySelectorAll('.app-nav-item').forEach(item => {
            item.classList.toggle('is-on', item.dataset.view === 'clients');
        });
    };

    $('view-clients').addEventListener('input', (event) => {
        if (event.target.id !== 'client-hunt') return;
        hunt = plain(event.target.value.trim());
        const box = $('client-list');
        const wanted = hunt
            ? purse.list.filter(one => plain(one.name).includes(hunt)
                                    || plain(one.company).includes(hunt))
            : purse.list;
        // Only the list is redrawn, so the cursor stays where somebody is
        // still typing.
        box.innerHTML = wanted.length
            ? wanted.map(one => `
                <li>
                    ${faceOf(faceFor(one), 'lister-face')}
                    <span class="lister-who">
                        <span class="lister-name">${esc(one.name)}</span>
                        <span class="lister-sub">${one.owed
                            ? `<span class="is-due">${esc(euro(one.owed))} εκκρεμεί</span>`
                            : esc(one.company || 'Τακτοποιημένα')}</span>
                    </span>
                    <span class="lister-acts">
                        <button class="lister-gear" type="button" data-go="${esc(one.id)}"
                                aria-label="Άνοιγμα: ${esc(one.name)}">${ARROW}</button>
                    </span>
                </li>`).join('')
            : '<li class="none-yet">Κανένα αποτέλεσμα</li>';
    });

    $('view-clients').addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.target;
        const said = Object.fromEntries(new FormData(form).entries());

        try {
            if (form.id === 'new-client-user') {
                await api('/api/accounts', { method: 'POST', body: { kind: 'user', ...said } });
                toast('Ο λογαριασμός δημιουργήθηκε.');
            } else {
                await api('/api/clients', { method: 'POST', body: { kind: 'client', ...said } });
                hunt = '';
                toast('Ο πελάτης δημιουργήθηκε.');
            }
            form.reset();
            await openClients();
        } catch (err) {
            complain(form, explain(err));
        }
    });

    $('view-clients').addEventListener('click', (event) => {
        const gear = event.target.closest('[data-open]');
        if (gear) { openDrawer(gear.dataset.open, gear.dataset.id); return; }

        const row = event.target.closest('li');
        const go = row && row.querySelector('[data-go]');
        if (go) openClient(go.dataset.go);
    });

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
            await api('/api/accounts', { method: 'POST', body: { kind: 'grid', ...data } });
            toast('Το grid δημιουργήθηκε.');
            await loadGrids();
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
                <p class="pw-note">Μόνο για λογαριασμούς με ρόλο πελάτη.${tip(
                    'Ο πελάτης είναι η εταιρεία ή ο άνθρωπος που τιμολογείς. Είναι αυτό που δίνει στον λογαριασμό τη σελίδα «Ο λογαριασμός μου», με τα τιμολόγιά του.')}</p>

                <label class="edit-label pw-head" for="acct-password">Κωδικός</label>
                <span class="pw-field">
                    <input id="acct-password" data-f="password" type="password" minlength="8"
                           value="${esc(known)}" autocomplete="off" spellcheck="false"
                           placeholder="${known ? '' : 'Γράψε νέον κωδικό'}">
                    ${EYE}
                </span>
                <p class="pw-note">${known
                    ? 'Πάτα το ματάκι για να τον δεις. Γράψε από πάνω και αποθήκευσε για να τον αλλάξεις.'
                    : `Ο κωδικός του δεν διαβάζεται.${tip(
                        'Φτιάχτηκε πριν κρατηθεί αντίγραφο. Όρισε νέον εδώ και από δω και πέρα θα τον βλέπεις με το ματάκι.')}`}</p>
            `;

            // Your own account is the one you cannot take away.
            $('acct-delete').hidden = user.id === state.me.id;
        } else {
            const grid = admin.grids.find(g => g.id === id);
            if (!grid) return;
            const members = admin.users.filter(u => u.role !== 'admin');

            drawer.icon = grid.ownIcon || null;
            $('acct-title').textContent = grid.name;
            $('acct-sub').textContent = 'Όποιος μπει πάνω του μπορεί να το αλλάξει. Τα σχόλια των πελατών σηκώνουν ένδειξη μέχρι να απαντηθούν.';

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
                <p class="pw-note">Μόνο εσύ το ορίζεις.${tip(
                    'Φαίνεται στο τετραγωνάκι δίπλα στο όνομα του project, στη λίστα αριστερά. Δεν είναι η φωτογραφία προφίλ του ίδιου του grid.')}</p>

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
            await refreshAdmin();
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
            await refreshAdmin();
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
    const purse = { list: [], partners: [], id: null, kind: 'client', client: null,
                    partner: null, money: null, files: [], seesGrids: false,
                    people: [], grids: [] };

    // Our own card. The admin reads it to edit it; everybody else is handed it
    // with their own page and reads it to know who they are dealing with.
    const house = { mine: null };

    // How long a link is the client's. The server decides it; this is only the
    // same number, for the sentence that explains it.
    const FILE_MONTHS = 12;

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
    const STEPS = { month: 1, quarter: 3, year: 12 };

    // The same arithmetic the server does, counted in UTC for the same reason:
    // a period that ends on the thirtieth should say the thirtieth wherever it
    // is read. The server still decides; this is so that a box which is no
    // longer typed into shows what is about to be saved rather than what was
    // saved last time.
    const dayShift = (iso, days) => {
        const at = new Date(`${iso}T00:00:00Z`);
        at.setUTCDate(at.getUTCDate() + days);
        return at.toISOString().slice(0, 10);
    };

    const monthShift = (iso, months) => {
        const from = new Date(`${iso}T00:00:00Z`);
        const wanted = from.getUTCDate();
        const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + months, 1));
        const last = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
        start.setUTCDate(Math.min(wanted, last));
        return start.toISOString().slice(0, 10);
    };
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

        // The sidebar holds what is somebody's own: their account, and nothing
        // else. Every client the admin has was every client the admin has,
        // standing beside the work all day; they have a page of their own now,
        // under Διαχείριση, which is where you go to look somebody up rather
        // than where you are made to look at everybody.
        const boss = state.me && state.me.role === 'admin';

        if (boss || !purse.list.length) { wrap.hidden = true; return; }

        wrap.hidden = false;
        label.textContent = 'Ο λογαριασμός μου';

        list.innerHTML = purse.list.map(one => `
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

    const loadClients = async () => {
        if (!state.me) { purse.list = []; renderClientNav(); return; }

        try {
            const data = await api('/api/clients');
            // Three different answers to the same question, because three
            // different people are asking it: every client, the one client
            // this account belongs to, or the partner themselves.
            if (data.partners) purse.partners = data.partners;
            if (data.clients) purse.list = data.clients;
            else if (data.partner) {
                purse.list = [{ ...data.partner, faceOf: data.partner.id, partner: true,
                                owed: owedOneWay(data.money, 'in') }];
            } else if (data.client) {
                purse.list = [{ ...data.client, owed: (data.money || {}).owed || 0 }];
            } else purse.list = [];
        } catch {
            purse.list = [];
        }
        renderClientNav();
    };

    // What is still unpaid in one direction. A partner's column runs both ways
    // and the two must never be added together: one of them is money you are
    // waiting for and the other is money somebody is waiting for from you.
    // Whose column is open, in the shape the server asks for it. Said in one
    // place so that a form, a panel and a deletion can never disagree.
    const purseRef = () => (purse.kind === 'partner'
        ? { partnerId: purse.id }
        : { clientId: purse.id });

    const owedOneWay = (money, way) => ((money && money.entries) || [])
        .filter(entry => entry.way === way && entry.status !== 'paid')
        .reduce((total, entry) => total + entry.cents, 0);

    const openClient = async (id) => {
        const mine = state.me.role !== 'admin';
        // A partner's column is the one under their own account. They only ever
        // ask for their own; the admin asks by name, and an account id says so
        // in its own prefix.
        const asPartner = state.me.role === 'partner' || String(id || '').startsWith('usr_');

        busy('Φόρτωση…');
        try {
            const data = await api(asPartner
                ? (mine ? '/api/clients' : `/api/clients?partner=${encodeURIComponent(id)}`)
                : (mine ? '/api/clients' : `/api/clients?id=${encodeURIComponent(id)}`));

            if (asPartner) {
                if (!data.partner) { toast('Δεν βρέθηκε ο λογαριασμός.', 'bad'); return; }

                purse.kind = 'partner';
                purse.id = data.partner.id;
                purse.partner = data.partner;
                purse.client = null;
                purse.files = [];
                purse.money = data.money || { subs: [], entries: [], owed: 0 };
                if ('house' in data) house.mine = data.house;

                $('app-title').textContent = mine ? 'Ο λογαριασμός μου' : data.partner.name;
                renderClient();
                showView('client');
                showBack('partners', 'Συνεργάτες');
                where.write('client', purse.id);

                document.querySelectorAll('.app-nav-item').forEach(item => {
                    item.classList.toggle('is-on', item.dataset.client === purse.id);
                });
                return;
            }

            if (!data.client) { toast('Δεν υπάρχει ακόμα λογαριασμός για σένα.', 'bad'); return; }

            purse.kind = 'client';
            purse.partner = null;
            purse.id = data.client.id;
            purse.client = data.client;
            purse.money = data.money || { subs: [], entries: [], owed: 0, paid: 0 };
            purse.files = data.files || [];
            purse.seesGrids = Boolean(data.seesGrids);
            purse.people = data.people || [];
            purse.grids = data.grids || [];
            if ('house' in data) house.mine = data.house;

            $('app-title').textContent = mine ? 'Ο λογαριασμός μου' : data.client.name;
            renderClient();
            showView('client');
            showBack('clients', 'Πελάτες');
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

    // Twelve squares for the year, and nothing but a reading of the charges
    // underneath. Each one is filled as far as it has been paid for, so a turn
    // that runs from the middle of one month to the middle of the next leaves
    // both of them half lit rather than claiming or disowning either. None can
    // be pressed: a month is not where money is recorded, and two places to
    // record it is one too many.
    //
    // The year is the one we are in, and anything older is in the ledger, which
    // is where a year-old month belongs.
    //
    // A quarter fills three of them and a year fills all twelve, without this
    // having to know which: it asks each month whether some period covers it.
    const monthsOf = (sub) => {
        const now = new Date();
        const year = now.getFullYear();
        const ours = purse.money.entries.filter(entry => entry.subId === sub.id && entry.to);

        const cells = MONTHS.map((name, month) => {
            const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
            const opens = Date.UTC(year, month, 1);

            // Where inside the month each turn sits, as a share of it. A turn
            // that runs to the fifteenth fills the left half of August, and one
            // that begins on the twenty-eighth fills the last few days of it:
            // the square is a little timeline of the month, read left to right.
            const bands = ours.map(entry => {
                const from = Math.max(0, (Date.parse(`${entry.on}T00:00:00Z`) - opens) / 86400000);
                const to = Math.min(days, (Date.parse(`${entry.to}T00:00:00Z`) - opens) / 86400000 + 1);
                return { from: from / days, to: to / days, paid: entry.status === 'paid' };
            }).filter(band => band.to > band.from).sort((one, two) => one.from - two.from);

            const share = (paid) => bands
                .filter(band => !paid || band.paid)
                .reduce((total, band) => total + (band.to - band.from), 0);

            // Stops land on whole days and the two ends land exactly on the
            // edges, so a band that runs to the end of the month runs to the
            // end of the square rather than a rounding of a percent short of it.
            const pin = (n) => {
                const at = Math.min(1, Math.max(0, n));
                return at <= 0 ? '0%' : at >= 1 ? '100%' : `${(at * 100).toFixed(2)}%`;
            };

            const paints = [];
            let at = 0;

            bands.forEach(band => {
                if (band.from - at > 0.001) paints.push(`transparent ${pin(at)} ${pin(band.from)}`);
                paints.push(`${band.paid ? 'rgba(255,107,53,.85)' : 'rgba(255,107,53,.22)'} `
                    + `${pin(Math.max(at, band.from))} ${pin(band.to)}`);
                at = Math.max(at, band.to);
            });
            if (1 - at > 0.001) paints.push(`transparent ${pin(at)} 100%`);

            // All of it paid for reads as a full square with dark lettering.
            // Anything less keeps the lighter lettering, because half a square
            // of orange is no background to put dark text on.
            const how = share(true) >= 0.99 ? ' is-full' : share(false) > 0 ? ' is-part' : '';
            const owing = bands.some(band => !band.paid) ? ' is-due' : '';

            const covered = Math.round(share(false) * days);
            const said = covered === 0 ? 'χωρίς χρέωση'
                : covered >= days ? (share(true) >= 0.99 ? 'πληρωμένος' : 'χρεωμένος, εκκρεμεί')
                : `καλυμμένες ${covered} από ${days} μέρες`;

            return `<span class="month${how}${owing}${month === now.getMonth() ? ' is-now' : ''}"
                          style="background-image: linear-gradient(to right, ${paints.join(', ')})"
                          title="${name} ${year}: ${said}">${name}</span>`;
        }).join('');

        return `<div class="months"><span class="months-year">${year}</span>${cells}</div>`;
    };

    const subCard = (sub, boss) => {
        const stopped = Boolean(sub.endedAt);
        const cycle = CYCLE_NAMES[sub.cycle] || 'μήνα';

        const said = stopped ? `Σταμάτησε ${onDay(sub.endedAt)}`
            : sub.paidUntil ? `Πληρωμένο μέχρι ${onDay(sub.paidUntil)}`
            : 'Δεν έχει πληρωθεί ακόμα';

        // Everything on this line is read off the charges underneath. Nothing
        // about a subscription is stored twice, so nothing can disagree.
        const ours = purse.money.entries.filter(entry => entry.subId === sub.id);

        const last = ours.filter(entry => entry.status === 'paid' && entry.paidAt)
            .map(entry => entry.paidAt).sort().pop();

        const owed = ours.filter(entry => entry.status === 'due')
            .reduce((total, entry) => total + entry.cents, 0);

        const owing = owed
            ? ` · <span class="is-due">${esc(euro(owed))} εκκρεμεί</span>`
            : '';

        const paid = last ? ` · Τελευταία πληρωμή ${onDay(last)}` : '';

        return `
            <li class="sub${stopped ? ' is-stopped' : ''}" data-sub="${esc(sub.id)}">
                <div class="sub-top">
                    <span class="sub-name">${esc(sub.title)}</span>
                    <span class="sub-price">${esc(euro(sub.cents))} / ${cycle}</span>
                    ${boss ? `<button class="lister-gear" type="button" data-open="sub"
                                      data-id="${esc(sub.id)}" aria-label="Ρυθμίσεις: ${esc(sub.title)}">${GEAR}</button>` : ''}
                </div>
                <p class="sub-when">${said}${paid}${owing}${
                    boss && !sub.social ? ' · <span class="not-social">εκτός social media</span>' : ''}</p>
                ${monthsOf(sub)}

            </li>`;
    };

    const ledgerRow = (entry, boss) => {
        const sub = entry.subId && purse.money.subs.find(one => one.id === entry.subId);
        const under = [];
        if (entry.to) under.push(`Καλύπτει ως ${onDay(entry.to)}`);
        // The date in the margin is the day the money came in, because that is
        // what somebody reading down this column is looking for. Where the
        // charge was made on another day, that day is said here rather than
        // lost: an invoice from November settled in September is both.
        if (entry.status === 'paid' && entry.paidAt && entry.paidAt !== entry.on) {
            under.push(`Χρεώθηκε ${onDay(entry.on)}`);
        }
        if (entry.invoiceNo) under.push(`Τιμολόγιο ${esc(entry.invoiceNo)}`);
        if (sub && sub.title !== entry.title) under.push(esc(sub.title));

        // Whether a charge has been paid and whether it has been invoiced are
        // two different facts, and a row that is waiting on the second says so
        // rather than showing nothing: a client who is owed a document should
        // be able to see that it is coming, and the admin should be able to
        // read down the column and find what is still to be issued.
        const acts = [
            entry.invoiceUrl
                ? `<a class="app-ghost" href="${esc(entry.invoiceUrl)}"
                      target="_blank" rel="noopener noreferrer">Τιμολόγιο</a>`
                : '<span class="led-nobill">Εκκρεμεί έκδοση</span>',
            entry.status !== 'paid' && entry.payUrl ? `<a class="app-ghost is-pay" href="${esc(entry.payUrl)}"
                                   target="_blank" rel="noopener noreferrer">Πληρωμή</a>` : '',
            boss ? `<button class="lister-gear" type="button" data-open="entry"
                            data-id="${esc(entry.id)}" aria-label="Επεξεργασία χρέωσης">${GEAR}</button>` : ''
        ].filter(Boolean);

        return `
            <li class="led" data-entry="${esc(entry.id)}">
                <span class="led-when">${onDay(entry.status === 'paid' && entry.paidAt ? entry.paidAt : entry.on)}</span>
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

    // One piece of work, and the address it was left at. What the client is
    // shown depends on whether that address is still theirs: while it is, the
    // link itself; once it is not, a way of asking for it back.
    const fileRow = (file, boss) => `
        <li class="file${file.expired ? ' is-old' : ''}${file.askedAt ? ' is-asked' : ''}">
            <div class="file-said">
                <strong>${esc(file.title)}</strong>
                <small>${file.expired
                    ? `Ο σύνδεσμος έληξε στις ${onDay(file.expiresOn)}`
                    : `Διαθέσιμο μέχρι τις ${onDay(file.expiresOn)}`}${
                    boss && file.askedAt ? ` · Ζητήθηκε ${esc(ago(file.askedAt))}` : ''}</small>
            </div>

            <div class="file-do">
                ${file.url
                    ? `<a class="app-ghost" href="${esc(file.url)}"
                          target="_blank" rel="noopener noreferrer">Άνοιγμα</a>` : ''}
                ${!boss && file.expired ? (file.askedAt
                    ? '<span class="file-asked">Το αίτημα στάλθηκε</span>'
                    : `<button class="btn btn-primary" type="button"
                               data-ask="${esc(file.id)}">Αίτημα για σύνδεσμο</button>`) : ''}
                ${boss ? `<button class="file-drop" type="button" data-drop="${esc(file.id)}"
                                  aria-label="Διαγραφή">&times;</button>` : ''}
            </div>

            ${boss ? `
            <details class="file-edit">
                <summary>Αλλαγή</summary>
                <form class="new-row" data-file="${esc(file.id)}">
                    <input name="title" value="${esc(file.title)}" maxlength="80" required>
                    <input name="url" value="${esc(file.url || '')}" maxlength="600"
                           placeholder="https://" required>
                    <button class="btn btn-primary" type="submit">Αποθήκευση</button>
                </form>
            </details>` : ''}
        </li>`;

    // A partner's page. The same column of charges as a client's, read twice:
    // once for what they have invoiced us and once for what we have invoiced
    // them. The two are never added together — one is money somebody is
    // waiting for, the other is money somebody owes — so they are two lists
    // and two figures and never a single total.
    const billsForm = (way) => `
        <form class="new-row" data-way="${way}">
            <input type="hidden" name="way" value="${way}">
            <input name="title" placeholder="Τι αφορά, π.χ. Σχεδιασμός banner" maxlength="80" required>
            <input name="amount" placeholder="Ποσό" inputmode="decimal" required>
            <input name="on" type="date" aria-label="Ημερομηνία">
            <select name="status" aria-label="Κατάσταση">
                <option value="due">Εκκρεμεί</option>
                <option value="paid">Πληρώθηκε</option>
            </select>
            <button class="btn btn-primary" type="submit">Προσθήκη</button>
        </form>`;

    // Whether the person reading a charge may change it. The admin may change
    // anything; a partner may change what they have invoiced us and not what we
    // have invoiced them, because a bill is not something its recipient edits.
    const mayEditEntry = (entry) => state.me.role === 'admin'
        || (purse.kind === 'partner' && Boolean(entry) && entry.way === 'in');

    const billsPanel = (way, title, whys, rows, mayEdit, openBy) => `
        <details class="panel panel-fold" data-fold="${way === 'in' ? 'bills-in' : 'bills-out'}"${
            folded.open(way === 'in' ? 'bills-in' : 'bills-out', openBy) ? ' open' : ''}>
            <summary class="panel-head">
                <h2>${title}</h2>
                ${CARET}
            </summary>
            ${why(...whys)}

            ${mayEdit ? billsForm(way) : ''}

            <p class="panel-error" role="alert" hidden></p>
            <ul class="ledger${mayEdit ? ' is-live' : ''}">${rows.length
                ? rows.map(entry => ledgerRow(entry, mayEdit)).join('')
                : '<li class="none-yet">Κανένα ακόμα</li>'}</ul>
        </details>`;

    // What an invoice needs, in the order somebody reads it off one. The same
    // list draws the panel and the form behind it, so neither can grow a field
    // the other has never heard of.
    const BILL_FIELDS = [
        ['company', 'Επωνυμία'],
        ['vat', 'ΑΦΜ'],
        ['taxOffice', 'ΔΟΥ'],
        ['email', 'Email'],
        ['phone', 'Τηλέφωνο'],
        ['address', 'Διεύθυνση']
    ];

    // Ours, on the page of whoever we are working with. A card rather than a
    // form: there is nothing here for them to change, and the only reason it
    // is on their page at all is so they never have to ask us for it.
    // The same fields in the same order as anybody's card, drawn the same way.
    const housePanel = () => {
        const card = house.mine;
        if (!card) return '';

        const said = BILL_FIELDS.filter(([key]) => card[key]);
        if (!said.length) return '';

        return `
            <section class="panel">
                <div class="panel-head">
                    <h2>Η καρτέλα της Nelyce</h2>
                    <p>Τα στοιχεία μας, για ό,τι χρειαστείς.</p>
                </div>
                <ul class="bill">${said.map(([key, label]) =>
                    `<li><span>${label}</span><strong>${esc(card[key])}</strong></li>`).join('')}</ul>
            </section>`;
    };

    const billingPanel = (who, boss) => {
        const bill = who.billing || {};
        const said = BILL_FIELDS.filter(([key]) => bill[key]);

        return `
            <section class="panel">
                <div class="panel-top">
                    <div class="panel-head">
                        <h2>Στοιχεία τιμολόγησης</h2>
                        <p>${boss
                            ? `Ό,τι χρειάζεται για να κοπεί παραστατικό.${tip(
                                'Τα συμπληρώνεις εσύ ή τα συμπληρώνει ο ίδιος από τη σελίδα του, και είναι ένα αντίγραφο για τους δυο σας.')}`
                            : `Τα στοιχεία σου για τα παραστατικά.${tip(
                                'Συμπλήρωσέ τα μια φορά και δεν θα χρειαστεί να τα ξαναστείλεις.')}`}</p>
                    </div>
                    <button class="lister-gear" type="button" data-open="partner" data-id="${esc(who.id)}"
                            aria-label="Αλλαγή στοιχείων τιμολόγησης">${GEAR}</button>
                </div>

                ${said.length
                    ? `<ul class="bill">${said.map(([key, label]) =>
                        `<li><span>${label}</span><strong>${esc(bill[key])}</strong></li>`).join('')}</ul>`
                    : `<p class="bill-none">${boss
                        ? 'Δεν έχουν συμπληρωθεί ακόμα. Πάτα το γρανάζι για να τα βάλεις.'
                        : 'Δεν τα έχεις συμπληρώσει ακόμα. Πάτα το γρανάζι.'}</p>`}
            </section>`;
    };

    const renderPartner = () => {
        const boss = state.me.role === 'admin';
        const who = purse.partner;
        const all = purse.money.entries || [];

        const theirs = all.filter(entry => entry.way === 'in');
        const ours = all.filter(entry => entry.way === 'out');

        const waiting = owedOneWay(purse.money, 'in');
        const owing = owedOneWay(purse.money, 'out');

        $('view-client').innerHTML = `
            <section class="panel client-card">
                <div class="client-id">
                    ${faceOf(faceFor({ ...who, faceOf: who.id }), 'client-face')}
                    <div class="client-who">
                        <h2>${esc(who.name)}</h2>
                        <p>@${esc(who.username)} · Συνεργάτης</p>
                    </div>
                </div>

                <div class="client-sums">
                    ${waiting
                        ? `<span class="sum-due"><strong>${esc(euro(waiting))}</strong> ${
                            boss ? 'προς πληρωμή σε αυτόν' : 'περιμένεις να λάβεις'}</span>`
                        : `<span><strong>Τακτοποιημένα</strong> ${
                            boss ? 'προς αυτόν' : 'προς εσένα'}</span>`}
                    ${owing ? `<span><strong>${esc(euro(owing))}</strong> ${
                        boss ? 'σου οφείλει' : 'οφείλεις'}</span>` : ''}
                </div>
            </section>

            ${billingPanel(who, boss)}

            ${boss ? '' : housePanel()}

            ${billsPanel('in', 'Τιμολόγια προς Nelyce',
                boss
                    ? ['Ό,τι σου έχει τιμολογήσει αυτός ο συνεργάτης.',
                       'Τα καταχωρεί ο ίδιος και ο ίδιος λέει αν πληρώθηκαν. Εσύ μπορείς να διορθώσεις μια γραμμή που δεν βγάζει νόημα.']
                    : ['Ό,τι έχεις τιμολογήσει στη Nelyce.',
                       'Τα καταχωρείς εσύ, βάζεις τον σύνδεσμο προς το δικό σου παραστατικό, και εσύ λες πότε πληρώθηκε. Πάτα πάνω σε μια γραμμή για να την αλλάξεις.'],
                theirs, true, true)}

            ${billsPanel('out', 'Τιμολόγια από Nelyce',
                boss
                    ? ['Ό,τι του έχεις τιμολογήσει εσύ.',
                       'Σπάνιο, αλλά υπάρχει, και έχει τη θέση του εδώ ώστε η μία σελίδα να λέει όλη την ιστορία.']
                    : ['Ό,τι σου έχει τιμολογήσει η Nelyce, με τον σύνδεσμο για να το κατεβάσεις.',
                       'Αυτή η μισή σελίδα είναι για ανάγνωση.'],
                ours, boss, false)}
        `;
    };

    const renderClient = () => {
        // The two pages share a shell, a ledger and every handler underneath
        // them. What they do not share is what a column of charges means, so
        // the partner's is drawn by its own hand.
        if (purse.kind === 'partner') return renderPartner();

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

            ${boss ? '' : housePanel()}

            <details class="panel panel-fold" data-fold="subs"${folded.open('subs', true) ? ' open' : ''}>
                <summary class="panel-head">
                    <h2>Συνδρομές</h2>
                    ${CARET}
                </summary>
                ${why('Τι τρέχει αυτή τη στιγμή.',
                    `Οι μήνες είναι η φετινή χρονιά. Γεμάτος ο πληρωμένος, περιγραμμένος ο τιμολογημένος που δεν πληρώθηκε ακόμα, θαμπός αυτός που δεν χρεώθηκε καθόλου. Ό,τι παλιότερο είναι στο ιστορικό, πιο κάτω.${boss
                        ? ' Κάθε μήνας γεμίζει όσο τον καλύπτουν οι χρεώσεις, οπότε μια περίοδος που πιάνει δύο μήνες τους αφήνει και τους δύο μισογεμάτους. Για να πληρωθεί ένας μήνας, βάλε τη χρέωσή του στο ιστορικό πάνω σε αυτή τη συνδρομή.'
                        : ''}`)}

                ${boss ? `
                <form class="new-row" id="new-sub">
                    <input name="title" placeholder="Τι είναι, π.χ. Πρόγραμμα Social Media" maxlength="80" required>
                    <input name="amount" placeholder="Ποσό ανά περίοδο" inputmode="decimal" required>
                    <select name="cycle">
                        <option value="month">Κάθε μήνα</option>
                        <option value="quarter">Κάθε τρίμηνο</option>
                        <option value="year">Κάθε χρόνο</option>
                    </select>
                    <label class="member row-mark">
                        <input type="checkbox" name="social" value="1" checked>
                        <span>Social media</span>
                    </label>
                    <button class="btn btn-primary" type="submit">Νέα συνδρομή</button>
                </form>` : ''}

                ${boss ? `<p class="sees-grids${purse.seesGrids ? ' is-on' : ''}">${purse.seesGrids
                    ? 'Βλέπει τα grids που του έχεις δώσει: έχει πληρώσει συνδρομή social media τουλάχιστον μία φορά, και αυτό δεν χάνεται.'
                    : 'Δεν βλέπει grids: καμία πληρωμένη χρέωση πάνω σε συνδρομή social media. Μόλις μπει η πρώτη, τα grids του ανοίγουν και μένουν ανοιχτά.'}</p>` : ''}

                <p class="panel-error" role="alert" hidden></p>
                <ul class="subs">${owned.subs.length
                    ? owned.subs.map(sub => subCard(sub, boss)).join('')
                    : '<li class="none-yet">Καμία συνδρομή ακόμα</li>'}</ul>
            </details>

            <details class="panel panel-fold" data-fold="files"${folded.open('files', false) ? ' open' : ''}>
                <summary class="panel-head">
                    <h2>${boss ? 'Αρχεία' : 'Τα αρχεία μου'}</h2>
                    ${CARET}
                </summary>
                ${boss
                    ? why('Η κάθε δουλειά με τον σύνδεσμό της στο cloud.',
                        `Ο πελάτης τον βλέπει για ${FILE_MONTHS} μήνες. Μετά του μένει το όνομα της δουλειάς και ένα κουμπί που σου ζητάει καινούριον. Εσύ τον βλέπεις πάντα, και κάθε νέος σύνδεσμος ξεκινά τους ${FILE_MONTHS} μήνες από την αρχή.`)
                    : why('Οι δουλειές σου, με τον σύνδεσμο για να τις κατεβάσεις.',
                        `Ο κάθε σύνδεσμος μένει ανοιχτός ${FILE_MONTHS} μήνες. Όταν λήξει, ζήτα τον ξανά και θα τον ανεβάσουμε πάλι.`)}

                ${boss ? `
                <form class="new-row" id="new-file">
                    <input name="title" placeholder="Τι είναι, π.χ. Λογότυπο σε vector" maxlength="80" required>
                    <input name="url" placeholder="https://… ο σύνδεσμος του φακέλου" maxlength="600" required>
                    <button class="btn btn-primary" type="submit">Προσθήκη</button>
                </form>` : ''}

                <p class="panel-error" role="alert" hidden></p>
                <ul class="files">${purse.files.length
                    ? purse.files.map(file => fileRow(file, boss)).join('')
                    : '<li class="none-yet">Κανένα αρχείο ακόμα</li>'}</ul>
            </details>

            <details class="panel panel-fold" data-fold="ledger"${folded.open('ledger', false) ? ' open' : ''}>
                <summary class="panel-head">
                    <h2>Ιστορικό και τιμολόγια</h2>
                    ${CARET}
                </summary>
                ${boss
                        ? why('Κάθε χρέωση όπως εκδόθηκε, και αν έχει εξοφληθεί.',
                            'Βάλε μια χρέωση πάνω σε συνδρομή και ανάβουν μόνοι τους οι μήνες της. Η πληρωμή και το τιμολόγιο είναι χωριστά: μπορείς να καταχωρήσεις δουλειά που εκκρεμεί πριν εκδώσεις παραστατικό, και όσο δεν έχει σύνδεσμο η γραμμή γράφει «Εκκρεμεί έκδοση». Τα υπόλοιπα στοιχεία κάθε γραμμής είναι πίσω από το γρανάζι της.')
                        : why('Κάθε δουλειά που έχει χρεωθεί, με το τιμολόγιό της.',
                            'Όπου γράφει «Εκκρεμεί έκδοση», το παραστατικό δεν έχει βγει ακόμα.')}

                ${boss ? `
                <form class="new-row" id="new-entry">
                    <input name="title" placeholder="Τι αφορά, π.χ. Λογότυπο" maxlength="80" required>
                    <input name="amount" placeholder="Ποσό" inputmode="decimal" required>
                    <input name="on" type="date" aria-label="Ημερομηνία">
                    ${owned.subs.length ? `
                        <select name="subId" aria-label="Ανήκει σε">
                            <option value="">Μεμονωμένη χρέωση</option>
                            ${owned.subs.map(sub => `<option value="${esc(sub.id)}">${esc(sub.title)}</option>`).join('')}
                        </select>` : ''}
                    <select name="status" aria-label="Κατάσταση">
                        <option value="paid">Πληρώθηκε</option>
                        <option value="due">Εκκρεμεί</option>
                    </select>
                    <button class="btn btn-primary" type="submit">Προσθήκη</button>
                </form>` : ''}

                <p class="panel-error" role="alert" hidden></p>
                <ul class="ledger${boss ? ' is-live' : ''}">${owned.entries.length
                    ? owned.entries.map(entry => ledgerRow(entry, boss)).join('')
                    : '<li class="none-yet">Καμία χρέωση ακόμα</li>'}</ul>
            </details>
        `;
    };

    // --- adding, changing and taking away ------------------------------------
    const afterMoney = async (back, message) => {
        purse.money = back.money;
        renderClient();
        await loadClients();
        toast(message);
    };

    // The files are their own document on the server, so what comes back from
    // a change to them is the list and nothing else.
    const afterFiles = (back, message) => {
        purse.files = back.files || [];
        renderClient();
        toast(message);
    };

    $('view-client').addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.target;

        // A file is handed over, or handed over again under the same name. Both
        // are the same sentence to the server, told apart by whether the row
        // already exists.
        if (form.id === 'new-file' || form.dataset.file) {
            const said = Object.fromEntries(new FormData(form).entries());
            busy('Αποθήκευση…');
            try {
                const back = await api('/api/clients', {
                    method: form.dataset.file ? 'PATCH' : 'POST',
                    body: { kind: 'file', clientId: purse.id,
                            ...(form.dataset.file ? { id: form.dataset.file } : {}), ...said }
                });
                if (!form.dataset.file) form.reset();
                afterFiles(back, form.dataset.file ? 'Ο σύνδεσμος ανανεώθηκε.' : 'Το αρχείο μπήκε.');
            } catch (err) {
                complain(form, explain(err));
            } finally {
                busy('');
            }
            return;
        }

        const kind = form.id === 'new-sub' ? 'sub' : 'entry';

        busy('Αποθήκευση…');
        try {
            // A box nobody ticked sends nothing at all, and a subscription
            // that is not social media work has to say so rather than simply
            // not say the opposite.
            const said = Object.fromEntries(new FormData(form).entries());
            if (kind === 'sub') said.social = Boolean(form.social && form.social.checked);

            const back = await api('/api/clients', {
                method: 'POST',
                body: { kind, ...purseRef(), ...said }
            });
            form.reset();
            await afterMoney(back, kind === 'sub' ? 'Η συνδρομή μπήκε.' : 'Η χρέωση μπήκε.');
        } catch (err) {
            complain(form, explain(err));
        } finally {
            busy('');
        }
    });

    // A section opening does not bubble the way a click does, so it is caught
    // on the way down instead.
    $('view-client').addEventListener('toggle', (event) => {
        const fold = event.target.closest && event.target.closest('.panel-fold[data-fold]');
        if (fold) folded.write(fold.dataset.fold, fold.open);
    }, true);

    $('view-client').addEventListener('click', async (event) => {
        // Asking for a link back. The row says so from then on, whether or not
        // the bell that has just gone off is ever looked at.
        const ask = event.target.closest('[data-ask]');
        if (ask) {
            ask.disabled = true;
            busy('Αποστολή…');
            try {
                const back = await api('/api/clients', {
                    method: 'POST', body: { kind: 'file', action: 'ask', id: ask.dataset.ask }
                });
                afterFiles(back, 'Το αίτημα στάλθηκε.');
            } catch (err) {
                ask.disabled = false;
                toast(explain(err), 'bad');
            } finally {
                busy('');
            }
            return;
        }

        const drop = event.target.closest('[data-drop]');
        if (drop) {
            const row = purse.files.find(one => one.id === drop.dataset.drop);
            if (!confirm(`Να φύγει η γραμμή «${row ? row.title : ''}»; Το ίδιο το αρχείο στο cloud μένει εκεί που είναι.`)) return;
            busy('Διαγραφή…');
            try {
                const back = await api(
                    `/api/clients?kind=file&clientId=${encodeURIComponent(purse.id)}`
                    + `&id=${encodeURIComponent(drop.dataset.drop)}`,
                    { method: 'DELETE' });
                afterFiles(back, 'Η γραμμή έφυγε.');
            } catch (err) {
                toast(explain(err), 'bad');
            } finally {
                busy('');
            }
            return;
        }

        const gear = event.target.closest('[data-open]');
        if (gear) { openMoney(gear.dataset.open, gear.dataset.id); return; }

        // A gear is a small target for the thing this page is mostly used for,
        // so the whole row opens it. Not the links inside it, which go where
        // they say they go.
        const row = event.target.closest('.led');
        if (row && !event.target.closest('a')
            && mayEditEntry(purse.money.entries.find(one => one.id === row.dataset.entry))) {
            openMoney('entry', row.dataset.entry);
        }
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
            $('money-sub').textContent = 'Τα στοιχεία του και τι του ανήκει. Τις σημειώσεις σου δεν τις βλέπει.';

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
                    <p class="pw-note">Η φωτογραφία του λογαριασμού ${esc(client.account.name)}, μία για τους δυο σας.</p>`
                : `<p class="pw-note">Σύνδεσε πρώτα έναν λογαριασμό από κάτω. Η φωτογραφία του είναι και η φωτογραφία του πελάτη.</p>`}

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

        // Ours. The same card everybody else has, with the same fields in the
        // same order, so that what a partner reads on their page and what we
        // fill in here are recognisably one thing.
        if (kind === 'house') {
            const bill = house.mine || {};
            const box = (key, label, extra = '') =>
                `<label>${label}<input data-f="${key}" value="${esc(bill[key] || '')}"${extra}></label>`;

            $('money-title').textContent = 'Η καρτέλα μου';
            $('money-sub').textContent = 'Τη βλέπουν οι συνεργάτες και οι πελάτες στη σελίδα τους.';

            body.innerHTML = `
                <div class="row-fields">
                    ${box('company', 'Επωνυμία', ' maxlength="90"')}
                    ${box('vat', 'ΑΦΜ', ' maxlength="20" inputmode="numeric" spellcheck="false"')}
                    ${box('taxOffice', 'ΔΟΥ', ' maxlength="60"')}
                </div>

                <div class="row-fields">
                    ${box('email', 'Email', ' maxlength="140" inputmode="email" autocapitalize="none" spellcheck="false"')}
                    ${box('phone', 'Τηλέφωνο', ' maxlength="40" inputmode="tel"')}
                </div>

                <label class="edit-label pw-head" for="house-address">Διεύθυνση</label>
                <input class="me-name-field" id="house-address" data-f="address"
                       value="${esc(bill.address || '')}" maxlength="160">
                <p class="pw-note">Ό,τι αφήσεις κενό δεν εμφανίζεται πουθενά.${tip(
                    'Ένας συνεργάτης που θέλει να σου κόψει παραστατικό τα βρίσκει μόνος του αντί να σου τα ζητήσει, και ένας πελάτης βλέπει σε ποιον πλήρωσε.')}</p>
            `;
        }

        if (kind === 'partner') {
            const who = purse.partner;
            if (!who) return;
            const bill = who.billing || {};
            const box = (key, label, extra = '') =>
                `<label>${label}<input data-f="${key}" value="${esc(bill[key] || '')}"${extra}></label>`;

            $('money-title').textContent = who.name;
            $('money-sub').textContent = 'Τα στοιχεία που μπαίνουν στα παραστατικά. Ένα αντίγραφο για τους δυο σας.';

            body.innerHTML = `
                <div class="row-fields">
                    ${box('company', 'Επωνυμία', ' maxlength="90"')}
                    ${box('vat', 'ΑΦΜ', ' maxlength="20" inputmode="numeric" spellcheck="false"')}
                    ${box('taxOffice', 'ΔΟΥ', ' maxlength="60"')}
                </div>

                <div class="row-fields">
                    ${box('email', 'Email', ' maxlength="140" inputmode="email" autocapitalize="none" spellcheck="false"')}
                    ${box('phone', 'Τηλέφωνο', ' maxlength="40" inputmode="tel"')}
                </div>

                <label class="edit-label pw-head" for="bill-address">Διεύθυνση</label>
                <input class="me-name-field" id="bill-address" data-f="address"
                       value="${esc(bill.address || '')}" maxlength="160">
                <p class="pw-note">Τίποτα από αυτά δεν ελέγχεται.${tip(
                    'Ένα ΑΦΜ είναι εννιά ψηφία στην Ελλάδα και κάτι άλλο αλλού, και ένα κουτάκι που αρνείται ό,τι γράφεις είναι χειρότερο από ένα που το κρατάει.')}</p>
            `;
        }

        if (kind === 'sub') {
            const sub = purse.money.subs.find(one => one.id === id);
            if (!sub) return;

            $('money-title').textContent = sub.title;
            $('money-sub').textContent = 'Η συμφωνία. Οι χρεώσεις που έχουν ήδη εκδοθεί δεν αλλάζουν.';

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
                <p class="pw-note">Μπαίνει μόνος του σε κάθε νέα περίοδο.${tip(
                    'Ο πελάτης βλέπει κουμπί πληρωμής όσο η χρέωση εκκρεμεί.')}</p>

                <label class="edit-label pw-head" for="sub-note">Σημείωση, μόνο για σένα</label>
                <textarea class="me-name-field" id="sub-note" data-f="note" rows="2" maxlength="2000">${esc(sub.note || '')}</textarea>

                <label class="member sub-stop">
                    <input type="checkbox" id="sub-social"${sub.social ? ' checked' : ''}>
                    <span>Είναι συνδρομή social media</span>
                </label>
                <p class="pw-note">Αυτό ανοίγει τα grids για τον πελάτη.${tip(
                    'Μια πληρωμένη χρέωση πάνω σε τέτοια συνδρομή τα ανοίγει μια για πάντα. Αν την ξεμαρκάρεις δεν μετράει πια, και αν δεν έχει μείνει καμία άλλη, ο πελάτης παύει να βλέπει τα grids του.')}</p>

                <label class="member sub-stop">
                    <input type="checkbox" id="sub-ended"${sub.endedAt ? ' checked' : ''}>
                    <span>Έχει σταματήσει</span>
                </label>
            `;
        }

        if (kind === 'entry') {
            const entry = purse.money.entries.find(one => one.id === id);
            if (!entry) return;

            const boss = state.me.role === 'admin';

            $('money-title').textContent = entry.title;
            $('money-sub').textContent = boss
                ? 'Μία χρέωση, όπως εκδόθηκε. Ο σύνδεσμος του τιμολογίου κρατάει το κλειδί του αρχείου, οπότε δώσ\' τον μόνο εδώ.'
                : 'Ένα τιμολόγιό σου, όπως το έκοψες. Τον σύνδεσμο τον βλέπει μόνο η Nelyce.';

            body.innerHTML = `
                <div class="row-fields">
                    <label>Τι αφορά<input data-f="title" value="${esc(entry.title)}" maxlength="80"></label>
                    <label>Ποσό<input data-f="amount" value="${(entry.cents / 100).toFixed(2)}" inputmode="decimal"></label>
                    <label>Κατάσταση<select data-f="status">
                        <option value="due"${entry.status === 'due' ? ' selected' : ''}>Εκκρεμεί</option>
                        <option value="paid"${entry.status === 'paid' ? ' selected' : ''}>Πληρώθηκε</option>
                    </select></label>
                    <label id="entry-paidat"${entry.status === 'paid' ? '' : ' hidden'}>Πληρώθηκε στις<input data-f="paidAt" type="date" value="${esc(entry.paidAt || '')}"></label>
                </div>

                <div class="row-fields">
                    ${boss ? `<label>Ανήκει σε<select data-f="subId">
                        <option value="">Μεμονωμένη χρέωση</option>
                        ${purse.money.subs.map(sub =>
                            `<option value="${esc(sub.id)}"${sub.id === entry.subId ? ' selected' : ''}>${esc(sub.title)}</option>`).join('')}
                    </select></label>` : ''}
                    <label>Αριθμός τιμολογίου<input data-f="invoiceNo" value="${esc(entry.invoiceNo)}" maxlength="40"></label>
                </div>

                <div class="row-fields">
                    <label><span id="entry-on-name">Ημερομηνία</span><input id="entry-on" data-f="on" type="date" value="${esc(entry.on || '')}"></label>
                    <label id="entry-covers" hidden>Καλύπτει ως<input data-f="to" type="date" value="${esc(entry.to || '')}"></label>
                </div>
                <p class="pw-note" id="entry-on-note" hidden>Οι ημερομηνίες βγαίνουν μόνες τους.${tip(
                    'Ο μήνας ξεκινάει τη μέρα που πληρώθηκε η χρέωση και τρέχει έναν κύκλο από εκεί. Άλλαξε το «πληρώθηκε στις» και μετακινούνται μαζί.')}</p>

                <label class="edit-label pw-head" for="entry-file">Σύνδεσμος τιμολογίου</label>
                <input class="me-name-field" id="entry-file" data-f="invoiceUrl" value="${esc(entry.invoiceUrl)}"
                       placeholder="https://mega.nz/…" spellcheck="false">

                <label class="edit-label pw-head" for="entry-pay">Σύνδεσμος πληρωμής</label>
                <input class="me-name-field" id="entry-pay" data-f="payUrl" value="${esc(entry.payUrl)}"
                       placeholder="https://…" spellcheck="false">

                ${boss ? `
                <label class="edit-label pw-head" for="entry-note">Σημείωση, μόνο για σένα</label>
                <textarea class="me-name-field" id="entry-note" data-f="note" rows="2" maxlength="2000">${esc(entry.note || '')}</textarea>` : ''}
            `;
        }

        if (kind === 'entry') shapeEntry();

        // There is nothing to delete about a set of details: emptying the boxes
        // is how they go away, and a red button beside them would only ever be
        // pressed by mistake.
        $('money-delete').hidden = kind === 'partner' || kind === 'house';

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

    // What a charge is decides which of its boxes mean anything, so one function
    // settles the whole panel rather than each box knowing about the others.
    //
    // A one-off is dated and that is all. A turn of a subscription covers a
    // period, and once it has been paid that period starts on the day of the
    // payment, so its first date stops being something to type and becomes
    // something to read.
    const shapeEntry = () => {
        const body = $('money-body');
        const paid = body.querySelector('[data-f="status"]').value === 'paid';
        const when = body.querySelector('[data-f="paidAt"]');

        // The day the money arrived is asked for the moment somebody says it
        // did, and this much is true of every charge there is.
        $('entry-paidat').hidden = !paid;

        // The rest of it is about belonging to a subscription. A page with no
        // subscriptions on it has none of that to work out.
        const belongs = body.querySelector('[data-f="subId"]');
        if (!belongs) return;

        const inside = Boolean(belongs.value);
        const from = $('entry-on');
        const until = $('entry-covers').querySelector('input');

        $('entry-covers').hidden = !inside;
        $('entry-on-name').textContent = inside ? 'Καλύπτει από' : 'Ημερομηνία';
        $('entry-on-note').hidden = !inside;

        if (!inside) {
            from.disabled = false;
            until.value = '';
            return;
        }

        // Paid, so the turn has started and started when the money came in.
        const fixed = paid && Boolean(when.value);
        from.disabled = fixed;
        if (fixed) from.value = when.value;

        // And it runs one cycle from there, whoever it was that set the start.
        const sub = purse.money.subs.find(one => one.id === belongs.value);
        until.disabled = true;
        until.value = from.value
            ? dayShift(monthShift(from.value, STEPS[sub && sub.cycle] || 1), -1)
            : '';
    };

    $('money-body').addEventListener('change', () => {
        if (tray.kind === 'entry') shapeEntry();
    });

    $('money-save').addEventListener('click', async () => {
        if (!tray.kind) return;
        const body = $('money-body');
        sayMoney('');
        busy('Αποθήκευση…');

        try {
            if (tray.kind === 'house') {
                const data = await api('/api/clients', {
                    method: 'PATCH',
                    body: { kind: 'house', billing: fields(body) }
                });
                house.mine = data.house;
                closeMoney();
                toast('Αποθηκεύτηκε.');
                // Every page that draws it is redrawn by being reopened, and
                // the admin is never standing on one of them: ours is read by
                // partners and clients, on their own pages.
                return;
            }

            if (tray.kind === 'partner') {
                await api('/api/clients', {
                    method: 'PATCH',
                    body: { kind: 'partner', id: tray.id, billing: fields(body) }
                });
            } else if (tray.kind === 'client') {
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
                const extra = tray.kind === 'sub'
                    ? { ended: $('sub-ended').checked, social: $('sub-social').checked }
                    : {};
                await api('/api/clients', {
                    method: 'PATCH',
                    body: { kind: tray.kind, ...purseRef(), id: tray.id, ...fields(body), ...extra }
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
            const whose = purse.kind === 'partner' ? 'partnerId' : 'clientId';
            const tail = tray.kind === 'client'
                ? `kind=client&id=${encodeURIComponent(tray.id)}`
                : `kind=${tray.kind}&id=${encodeURIComponent(tray.id)}`
                  + `&${whose}=${encodeURIComponent(purse.id)}`;
            await api(`/api/clients?${tail}`, { method: 'DELETE' });

            const gone = tray.kind === 'client';
            closeMoney();
            toast('Διαγράφηκε.');

            if (gone) {
                purse.id = null;
                await loadClients();
                await openClients();
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
