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
        chat: { gridId: null, gridName: '', picked: null, people: [],
                messages: [], unread: 0, onlineCount: 0 }
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
        loadFeed();

        // The grid that was open last time, if it is still there.
        const remembered = remember.read();
        const first = state.grids.find(g => g.id === remembered) || state.grids[0];

        if (first) openGrid(first.id);
        else if (state.me.role === 'admin') openAccounts();
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

    const showView = (name) => {
        ['grid', 'accounts', 'chat', 'blank'].forEach(view => {
            $(`view-${view}`).hidden = view !== name;
        });
        closeSidebar();
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

            // The messages belong to the project, so opening another one points
            // them at it and counts what is waiting there.
            if (state.chat.gridId !== id) {
                state.chat = { gridId: id, gridName: state.grid.name, picked: null,
                               people: [], messages: [], unread: 0, onlineCount: 0, last: null };
            }
            loadChats();
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
        if (Number.isInteger(to) && to !== from) move(from, to);
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
        const open = ['post-modal', 'edit-modal', 'hl-modal', 'acct-modal', 'me-modal']
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

        const image = post.images[index] || post.images[0];
        $('post-image').src = image.url;

        const many = post.images.length > 1;
        $('post-prev').hidden = !many;
        $('post-next').hidden = !many;
        $('post-dots').innerHTML = many
            ? post.images.map((_, i) => `<span class="${i === index ? 'is-on' : ''}"></span>`).join('')
            : '';

        $('post-caption').textContent = post.caption || '';
        $('post-caption').hidden = !post.caption;

        renderLike(post, image);
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

    $('post-prev').addEventListener('click', () => {
        const post = state.posts[state.viewing.slot];
        state.viewing.index = (state.viewing.index - 1 + post.images.length) % post.images.length;
        renderViewer();
    });

    $('post-next').addEventListener('click', () => {
        const post = state.posts[state.viewing.slot];
        state.viewing.index = (state.viewing.index + 1) % post.images.length;
        renderViewer();
    });

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
    const CELL = 560;           // one picture's box, four across by five down
    const CELL_GAP = 22;
    const SHEET_PAD = 56;
    const SHEET_HEAD = 172;
    const CAPTION_COL = 1180;   // as wide as a line of text should ever be

    // A row of ten would be a sheet eight times wider than it is tall. Five is
    // where a row stops being something anybody can look at.
    const PER_ROW = 5;

    // A canvas has a size past which a phone quietly refuses to hand back what
    // was drawn on it.
    const SHEET_AREA = 12 * 1000 * 1000;

    const INK = '#15151b';
    const FADED = '#6f7078';
    const PAPER = '#f6f5f3';
    const CELL_BG = '#e9e7e3';

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

    // The whole picture inside its box, never cropped: an export is for showing
    // somebody what was made, and a sheet that trimmed it would be showing them
    // something else.
    const fit = (picture, x, y, w, h) => {
        const scale = Math.min(w / picture.naturalWidth, h / picture.naturalHeight);
        const pw = picture.naturalWidth * scale;
        const ph = picture.naturalHeight * scale;
        return { x: x + (w - pw) / 2, y: y + (h - ph) / 2, w: pw, h: ph };
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

            const cellH = Math.round(CELL * 5 / 4);
            const width = SHEET_PAD * 2 + across * CELL + (across - 1) * CELL_GAP;
            const inner = width - SHEET_PAD * 2;
            const wall = rows * cellH + (rows - 1) * CELL_GAP;

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

            ctx.fillStyle = '#ff6b35';
            ctx.fillRect(SHEET_PAD, SHEET_HEAD - 28, 74, 3);

            // --- the pictures, side by side -----------------------------------
            pictures.forEach((picture, i) => {
                const x = SHEET_PAD + (i % across) * (CELL + CELL_GAP);
                const y = SHEET_HEAD + Math.floor(i / across) * (cellH + CELL_GAP);

                ctx.save();
                roundRect(ctx, x, y, CELL, cellH, 20);
                ctx.clip();
                ctx.fillStyle = CELL_BG;
                ctx.fillRect(x, y, CELL, cellH);

                const box = fit(picture, x, y, CELL, cellH);
                ctx.drawImage(picture, box.x, box.y, box.w, box.h);
                ctx.restore();

                // Which one of how many, so the order survives being sent on.
                if (pictures.length > 1) {
                    const label = `${i + 1}/${pictures.length}`;
                    ctx.font = font(24, 500);

                    const w = ctx.measureText(label).width + 32;
                    const h = 44;
                    const bx = x + CELL - w - 16;
                    const by = y + 16;

                    ctx.fillStyle = 'rgba(10, 10, 14, .62)';
                    roundRect(ctx, bx, by, w, h, h / 2);
                    ctx.fill();

                    ctx.fillStyle = '#fff';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(label, bx + 16, by + h / 2 + 1);
                    ctx.textBaseline = 'alphabetic';
                }
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
                try { canvas.toBlob(one => one ? resolve(one) : reject(new Error('sheet-failed')), 'image/jpeg', 0.92); }
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

        const images = state.draft.images;
        const [moved] = images.splice(from, 1);
        images.splice(to, 0, moved);
        renderStrip();
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

        // A picture of a person hangs off no grid; everything else does, and
        // says which one, because an admin may be looking at any of them.
        const belongs = where === 'me'
            ? { kind: 'me' }
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
            if (!$('bell-panel').hidden) closeBell();
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
                if (event.key === 'ArrowLeft') $('post-prev').click();
                if (event.key === 'ArrowRight') $('post-next').click();
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

    const renderMe = () => {
        paintFace($('me-avatar'), state.me, 'app-avatar');
        paintFace($('me-face'), state.me, 'face-big');
        $('me-clear').hidden = !state.me.avatar;
    };

    const closeMe = () => { $('me-modal').hidden = true; unlock(); };

    $('me-open').addEventListener('click', () => {
        sayMe('');
        renderMe();
        $('me-modal').hidden = false;
        document.body.classList.add('is-locked');
    });

    const setMyFace = async (url) => {
        const data = await api('/api/session', { method: 'PATCH', body: { avatar: url } });
        state.me = data.user;
        renderMe();

        // Wherever else this account is drawn on the screen it is standing on.
        if (!$('view-accounts').hidden) openAccounts();
    };

    $('me-pick').addEventListener('click', () => {
        pickFiles(false, async (files) => {
            sayMe('');
            busy('Ανέβασμα…');
            try {
                const { url } = await acquire(files[0], SMALL_SIDE, 'me');
                await setMyFace(url);
                toast('Η φωτογραφία σου μπήκε.');
            } catch (err) {
                sayMe(explain(err));
            } finally {
                busy('');
            }
        });
    });

    $('me-clear').addEventListener('click', async () => {
        sayMe('');
        busy('…');
        try { await setMyFace(null); }
        catch (err) { sayMe(explain(err)); }
        finally { busy(''); }
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
                        <small class="bell-when">${esc(event.gridName)} · ${esc(ago(event.at))}</small>
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
            if (!state.grid || state.grid.id !== event.gridId) await openGrid(event.gridId);
            await openChat(event.kind === 'dm' ? event.actorId : null);
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
    // Two conversations that must never be mistaken for one another: the
    // project thread, which everybody on the grid reads, and a private one
    // between two of them. They are separate documents on the server, separate
    // lists on screen, and each one says in words who can read it.
    const TEAM_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true">'
        + '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>'
        + '<path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>';

    const LOCK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true">'
        + '<rect x="3" y="11" width="18" height="11" rx="2"/>'
        + '<path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

    const chatGridId = () =>
        (state.grid && state.grid.id) || (state.grids[0] && state.grids[0].id) || null;

    const chatTotal = () =>
        state.chat.unread + state.chat.people.reduce((sum, one) => sum + (one.unread || 0), 0);

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

    // The list on the left. The two kinds sit under headings of their own and
    // never in the same list, which is the whole design.
    const renderChatList = () => {
        const c = state.chat;

        $('chat-project').innerHTML = `
            <button class="chat-pick${c.picked === null ? ' is-on' : ''}${c.unread ? ' has-new' : ''}"
                    type="button" data-thread="">
                <span class="chat-face is-team" aria-hidden="true">${TEAM_ICON}</span>
                <span class="chat-pick-text">
                    <strong>Όλη η ομάδα</strong>
                    <small>${c.last ? esc(lastLine(c.last)) : `Το διαβάζουν όλοι στο ${esc(c.gridName)}`}</small>
                </span>
                ${c.unread ? `<span class="chat-count">${c.unread}</span>` : ''}
            </button>`;

        $('chat-people').innerHTML = c.people.length
            ? c.people.map(one => `
                <button class="chat-pick${c.picked === one.id ? ' is-on' : ''}${one.unread ? ' has-new' : ''}"
                        type="button" data-thread="${esc(one.id)}">
                    ${faceOf(one, 'chat-face', dot(one))}
                    <span class="chat-pick-text">
                        <strong>${esc(one.name)}</strong>
                        <small>${one.last ? esc(lastLine(one.last)) : `Μόνο εσύ και ${esc(one.name)}`}</small>
                    </span>
                    ${one.unread ? `<span class="chat-count">${one.unread}</span>` : ''}
                </button>`).join('')
            : '<p class="chat-none">Δεν υπάρχει άλλος πάνω σε αυτό το project ακόμα.</p>';

        renderChatBadge();
    };

    const renderRoom = () => {
        const c = state.chat;
        const team = c.picked === null;
        const person = c.people.find(one => one.id === c.picked) || null;
        const name = person ? person.name : '';

        const live = Boolean(person && person.online);

        $('chat-head-face').className = `chat-head-face${team ? ' is-team' : ''}${
            !team && person && person.avatar ? ' has-photo' : ''}`;
        $('chat-head-face').style.setProperty('--face', toneOf(person ? person.id : ''));
        $('chat-head-face').innerHTML = team
            ? TEAM_ICON
            : (person && person.avatar
                ? `<img src="${esc(person.avatar)}" alt="">${dot(person)}`
                : `${esc(initials(name))}${dot(person)}`);

        $('chat-head-name').textContent = team ? 'Όλη η ομάδα' : name;

        // In the project thread the same fact is a count, because a name is not
        // what is online there.
        $('chat-head-who').className = live ? 'is-live' : '';
        $('chat-head-who').textContent = team
            ? `Συζήτηση του project ${c.gridName}${c.onlineCount ? ` · ${c.onlineCount} σε σύνδεση` : ''}`
            : person ? here(person) : 'Προσωπικό μήνυμα';

        // The sentence that says who is reading. It stays on screen for as long
        // as the conversation does, because forgetting which of the two you are
        // in is the one mistake this screen exists to prevent.
        $('chat-banner').className = `chat-banner ${team ? 'is-team' : 'is-private'}`;
        $('chat-banner').innerHTML = team
            ? `${TEAM_ICON}<span>Το διαβάζουν <strong>όλοι</strong> όσοι δουλεύουν στο ${esc(c.gridName)}.</span>`
            : `${LOCK_ICON}<span>Ιδιωτικό. Το βλέπετε <strong>μόνο εσύ και ${esc(name)}</strong>.</span>`;

        $('chat-text').placeholder = team
            ? 'Γράψε σε όλη την ομάδα'
            : `Γράψε στον/στην ${name}`;

        // Links and ideas are the project's. A private conversation has none of
        // them, so opening one puts the talk back in front rather than leaving
        // somebody looking at a wall of notes with a padlock over it.
        $('room-tabs').hidden = !team;
        if (!team && tab !== 'talk') {
            tab = 'talk';
            ['talk', 'links', 'ideas'].forEach(one => { $(`pane-${one}`).hidden = one !== 'talk'; });
        }

        const log = $('chat-log');

        // Somebody who has scrolled up to read yesterday stays there. Somebody
        // already at the bottom is carried down to whatever just arrived, and
        // an empty log counts as at the bottom, which is how a conversation
        // opens on its most recent line.
        const atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 80;

        if (!c.messages.length) {
            log.innerHTML = `<li class="chat-empty">${team
                ? 'Κανείς δεν έχει γράψει ακόμα εδώ. Ό,τι γράψεις το βλέπει όλη η ομάδα του project.'
                : `Δεν έχετε ανταλλάξει μήνυμα ακόμα. Ό,τι γράψεις εδώ το βλέπετε μόνο εσείς οι δύο.`}</li>`;
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
                    ${signed ? `<p class="chat-name">${esc(message.name)}</p>` : ''}
                    <div class="chat-bubble">${esc(message.text)}</div>
                    <p class="chat-foot">
                        <span>${esc(clock(message.at))}</span>
                        ${mine ? '<button type="button" data-do="unsay">Διαγραφή</button>' : ''}
                    </p>
                </li>`;
        }).join('');

        if (atEnd) log.scrollTop = log.scrollHeight;
    };

    // Opening a conversation is reading it, so the count beside it goes.
    const markRead = async (picked) => {
        try {
            await api('/api/chat', {
                method: 'POST',
                body: { grid: state.chat.gridId, with: picked || undefined, action: 'seen' }
            });
        } catch { /* it will be marked on the next opening */ }
    };

    const lastId = (messages) => (messages.length ? messages[messages.length - 1].id : null);

    const isLive = (c, picked) => {
        const person = c.people.find(one => one.id === picked);
        return picked ? Boolean(person && person.online) : c.onlineCount || 0;
    };

    const openThread = async (picked, { quiet = false } = {}) => {
        const c = state.chat;
        const before = lastId(c.messages);
        const wasLive = isLive(c, picked);

        c.picked = picked;

        // A quiet refresh never moves the screen. Somebody scrolled up reading
        // yesterday, or back on the list on a phone, stays where they are.
        if (!quiet) {
            $('view-chat').classList.add('is-open');
            renderChatList();
            renderRoom();
        }

        try {
            const data = picked
                ? await api(`/api/chat?grid=${encodeURIComponent(c.gridId)}&with=${encodeURIComponent(picked)}`)
                : await api(`/api/chat?grid=${encodeURIComponent(c.gridId)}`);

            c.messages = data.messages || [];
            if (!picked) {
                c.people = data.people || [];
                c.last = data.last || null;
                c.gridName = (data.grid && data.grid.name) || c.gridName;
                c.onlineCount = data.onlineCount || 0;
                c.unread = 0;
            } else {
                const person = c.people.find(one => one.id === picked);
                if (person) {
                    person.unread = 0;
                    if (data.withUser) person.online = data.withUser.online;
                }
                // Arriving straight at a private thread from the bell, before
                // the list of people has been fetched at all.
                else if (data.withUser) c.people = c.people.concat({ ...data.withUser, unread: 0, last: null });
            }
        } catch (err) {
            if (!quiet) toast(explain(err), 'bad');
            return;
        }

        // Somebody arriving or leaving redraws the room too: the dot beside
        // their name is the point of showing it at all.
        const changed = lastId(c.messages) !== before || isLive(c, picked) !== wasLive;

        // Reading is what clears a conversation's count, and a refresh that
        // brought nothing new is not a fresh reading: it would write the store
        // every fifteen seconds for nobody.
        if (!quiet || changed) await markRead(picked);

        renderChatList();
        if (!quiet || changed) renderRoom();
    };

    // The list, without opening anything: what the badge in the sidebar counts.
    const loadChats = async () => {
        const gridId = chatGridId();
        if (!gridId) { state.chat.people = []; state.chat.unread = 0; renderChatBadge(); return; }

        try {
            const data = await api(`/api/chat?grid=${encodeURIComponent(gridId)}`);
            const c = state.chat;
            c.gridId = gridId;
            c.gridName = (data.grid && data.grid.name) || '';
            c.people = data.people || [];
            c.last = data.last || null;
            c.unread = data.unread || 0;
            c.onlineCount = data.onlineCount || 0;
            if (c.picked === null && !$('view-chat').hidden) c.messages = data.messages || [];
        } catch {
            return;
        }

        renderChatBadge();
        // The list only. Whatever is open on the right is the business of
        // openThread, which knows whether anything in it actually changed.
        if (!$('view-chat').hidden) renderChatList();
    };

    const openChat = async (picked = null) => {
        const gridId = chatGridId();
        if (!gridId) { toast('Δεν υπάρχει project για συζήτηση.'); return; }

        state.chat.gridId = gridId;
        // Another project's links are not this one's, so arriving at messages
        // always arrives at the talk.
        tab = 'talk';
        $('app-title').textContent = 'Μηνύματα';
        showView('chat');
        document.querySelectorAll('.app-nav-item').forEach(item => {
            item.classList.toggle('is-on', item.dataset.view === 'chat');
        });

        // On a phone the list comes first and a conversation covers it, so
        // arriving here without one named shows the list.
        $('view-chat').classList.toggle('is-open', Boolean(picked));

        busy('Φόρτωση…');
        try { await openThread(picked); }
        finally { busy(''); }

        // A private thread opened on its own knows about one person. The rest
        // of the list catches up behind it.
        if (picked) loadChats();
    };

    $('chat-side').addEventListener('click', (clicked) => {
        const pick = clicked.target.closest('[data-thread]');
        if (!pick) return;
        openThread(pick.dataset.thread || null);
    });

    $('chat-back').addEventListener('click', () => {
        $('view-chat').classList.remove('is-open');
    });

    const say = async () => {
        const box = $('chat-text');
        const said = box.value.trim();
        if (!said) return;

        box.value = '';
        box.style.height = 'auto';
        $('chat-send').disabled = true;

        try {
            const data = await api('/api/chat', {
                method: 'POST',
                body: { grid: state.chat.gridId, with: state.chat.picked || undefined, text: said }
            });
            state.chat.messages = data.messages || state.chat.messages.concat(data.message);
            renderRoom();
        } catch (err) {
            box.value = said;
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
    // allows, and then scrolls.
    $('chat-text').addEventListener('input', () => {
        const box = $('chat-text');
        box.style.height = 'auto';
        box.style.height = `${box.scrollHeight}px`;
    });

    $('chat-log').addEventListener('click', async (clicked) => {
        const button = clicked.target.closest('button[data-do="unsay"]');
        if (!button) return;
        if (!confirm('Να διαγραφεί το μήνυμα;')) return;

        const id = button.closest('.chat-msg').dataset.message;
        try {
            const data = await api('/api/chat', {
                method: 'POST',
                body: {
                    grid: state.chat.gridId,
                    with: state.chat.picked || undefined,
                    action: 'delete', id
                }
            });
            state.chat.messages = data.messages || [];
            renderRoom();
        } catch (err) {
            toast(explain(err), 'bad');
        }
    });

    // Nothing is pushed from the server here either. An open conversation asks
    // often, and the counts in the sidebar ask at the same pace as the bell.
    // A private thread's own request says nothing about anybody else, so every
    // third turn the list is fetched as well and the rest of the dots catch up.
    let ticks = 0;
    setInterval(() => {
        if (document.hidden) return;

        if ($('view-chat').hidden) { loadChats(); return; }

        ticks += 1;
        openThread(state.chat.picked, { quiet: true });
        if (state.chat.picked && ticks % 3 === 0) loadChats();
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

    const wall = { links: [], notes: [], tag: null, editing: null, colour: COLOURS[0] };

    // Which of the three is showing. Only the project thread has them at all.
    let tab = 'talk';

    const showTab = (which) => {
        tab = which;
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
        $('link-list').innerHTML = wall.links.length
            ? wall.links.map(link => `
                <li data-link="${esc(link.id)}">
                    ${GRIP}
                    <span class="link-face" aria-hidden="true">${LINK_ICON}</span>
                    <span class="link-text">
                        <a href="${esc(link.url)}" target="_blank" rel="noopener noreferrer"
                           draggable="false">${esc(link.title)}</a>
                        <small>${esc(host(link.url))} · ${esc(link.name)} · ${esc(ago(link.at))}</small>
                    </span>
                    ${link.userId === state.me.id || state.me.role === 'admin'
                        ? '<button class="link-drop" type="button" data-do="drop-link">Αφαίρεση</button>'
                        : '<span></span>'}
                </li>`).join('')
            : '<li class="room-none">Κανένας σύνδεσμος ακόμα. Βάλε εδώ ό,τι ψάχνει συνέχεια η ομάδα: φάκελο στο Drive, brief, ημερολόγιο.</li>';
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

            const body = editing
                ? `<div class="idea-edit">
                       <textarea maxlength="1200" data-edit>${esc(note.text)}</textarea>
                       <input maxlength="140" data-tags value="${esc((note.tags || []).join(', '))}"
                              placeholder="Ετικέτες, χωρισμένες με κόμμα">
                       <p class="idea-foot">
                           <button type="button" data-do="save-idea">Αποθήκευση</button>
                           <button type="button" data-do="cancel-idea">Ακύρωση</button>
                       </p>
                   </div>`
                : `<p class="idea-said">${esc(note.text)}</p>
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

    const moveLink = async (gridId, id, to) => {
        const data = await api('/api/board', {
            method: 'POST',
            body: { grid: gridId, action: 'move-link', id, to }
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

    $('link-new').addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.target;
        const { url, title } = Object.fromEntries(new FormData(form).entries());

        try {
            const data = await boardAction({ action: 'add-link', url, title });
            wall.links = data.links || [];
            form.reset();
            renderLinks();
        } catch (err) {
            toast(explain(err), 'bad');
        }
    });

    $('link-list').addEventListener('click', async (clicked) => {
        const button = clicked.target.closest('button[data-do="drop-link"]');
        if (!button) return;
        if (!confirm('Να αφαιρεθεί ο σύνδεσμος;')) return;

        const gridId = state.chat.gridId;
        const id = button.closest('[data-link]').dataset.link;

        try {
            const data = await boardAction({ action: 'delete-link', id });
            wall.links = data.links || [];
            renderLinks();
            keepUndo({ what: 'Ο σύνδεσμος επανήλθε.', run: () => undelete(gridId, id) });
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
        row.classList.add('is-lifting');
        document.body.classList.add('is-dragging-link');

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

        // Where it lands once it is no longer where it was: everything below a
        // row that has been lifted out has already moved up one.
        let to = spot.after ? onto + 1 : onto;
        if (from < to) to -= 1;
        if (to === from) return;

        // The list is redrawn in its new order before the server has answered,
        // because a row that snaps back for a moment reads as a failed drag.
        const gridId = state.chat.gridId;
        const [moved] = wall.links.splice(from, 1);
        wall.links.splice(to, 0, moved);
        renderLinks();

        try {
            await moveLink(gridId, id, to);
            keepUndo({ what: 'Η μετακίνηση αναιρέθηκε.', run: () => moveLink(gridId, id, from) });
        } catch (err) {
            toast(explain(err), 'bad');
            renderLinks();
        }
    };

    linkList.addEventListener('pointerdown', (event) => {
        if (event.button > 0) return;

        const row = event.target.closest('li[data-link]');
        if (!row || event.target.closest('.link-drop')) return;

        haul.id = row.dataset.link;
        haul.pointer = event.pointerId;
        haul.touch = event.pointerType !== 'mouse';
        haul.startX = haul.x = event.clientX;
        haul.startY = haul.y = event.clientY;
        haul.moved = false;
        haul.active = false;

        linkList.setPointerCapture(event.pointerId);
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

    $('idea-new').addEventListener('submit', async (event) => {
        event.preventDefault();
        const text = $('idea-text').value.trim();
        if (!text) return;

        try {
            const data = await boardAction({
                action: 'add-note',
                text,
                colour: wall.colour,
                tags: $('idea-tags').value
            });
            wall.notes = data.notes || [];
            $('idea-text').value = '';
            $('idea-tags').value = '';
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
                    text: card.querySelector('[data-edit]').value,
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
            document.querySelectorAll('.app-nav-item').forEach(item => {
                item.classList.toggle('is-on', item.dataset.view === 'accounts');
            });
        } catch (err) {
            toast(explain(err), 'bad');
        } finally {
            busy('');
        }
    };

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
        const userLines = admin.users
            .map(user => line(user.id, 'user', user.name,
                `@${esc(user.username)} · ${ROLE_NAMES[user.role]} · ${esc(here(user))}`, user))
            .join('');

        const gridLines = admin.grids
            .map(grid => line(grid.id, 'grid', grid.name,
                `${grid.handle ? `@${esc(grid.handle)} · ` : ''}${people((grid.memberIds || []).length)}`,
                grid))
            .join('');

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
                </div>

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

            drawer.icon = grid.icon || null;
            $('acct-title').textContent = grid.name;
            $('acct-sub').textContent = 'Όποιος μπει πάνω του μπορεί να το αλλάξει. Τα σχόλια των πελατών ξεχωρίζουν και σηκώνουν ένδειξη μέχρι να απαντηθούν.';

            body.innerHTML = `
                <div class="row-fields">
                    <label>Όνομα<input data-f="name" value="${esc(grid.name)}" maxlength="60"></label>
                    <label>Instagram handle<input data-f="handle" value="${esc(grid.handle)}" maxlength="40" placeholder="χωρίς το @"></label>
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

            paintFace($('grid-face'), { id: grid.id, name: grid.name, icon: drawer.icon }, 'face-big');
            $('acct-body').querySelector('[data-do="clear-icon"]').hidden = !drawer.icon;

            $('acct-delete').hidden = false;
        }

        drawer.kind = kind;
        drawer.id = id;
        $('acct-modal').hidden = false;
        document.body.classList.add('is-locked');
    };

    $('view-accounts').addEventListener('click', (event) => {
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

    boot();
})();
