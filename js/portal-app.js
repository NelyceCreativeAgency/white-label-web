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
        'too-many-redirects': 'Ο σύνδεσμος γυρίζει σε πολλές ανακατευθύνσεις.'
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
        dragging: null  // the slot being carried by the mouse
    };

    const canEdit = () => Boolean(state.grid && state.grid.canEdit);

    // --- boot --------------------------------------------------------------
    const boot = async () => {
        let session;
        try { session = await api('/api/session'); }
        catch { return; }

        if (!session.user) { location.replace(LOGIN); return; }

        state.me = session.user;
        $('me-name').textContent = state.me.name;
        $('me-role').textContent = ROLE_NAMES[state.me.role] || '';
        $('me-avatar').textContent = initials(state.me.name);
        $('app-admin-nav').hidden = state.me.role !== 'admin';

        await loadGrids();

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

        if (!state.grids.length) {
            list.innerHTML = '<li class="app-grids-empty">Κανένα ακόμα</li>';
            return;
        }

        list.innerHTML = state.grids.map(grid => `
            <li>
                <button class="app-nav-item${state.grid && state.grid.id === grid.id ? ' is-on' : ''}"
                        type="button" data-grid="${esc(grid.id)}">
                    <span class="app-nav-dot" aria-hidden="true">${esc(initials(grid.name))}</span>
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
        ['grid', 'accounts', 'blank'].forEach(view => {
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

        menu.innerHTML = `
            <button type="button" data-do="view">Προβολή</button>
            <button type="button" data-do="edit">Επεξεργασία</button>
            <button type="button" data-do="move">Μετακίνηση</button>
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
        const open = ['post-modal', 'edit-modal', 'hl-modal', 'acct-modal'].some(id => !$(id).hidden);
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

        $('post-actions').hidden = !canEdit();
        renderNotes(post, slot);
    };

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
    const acquire = async (source, maxSide) => {
        const { blob, w, h } = await shrink(source, maxSide);
        const data = await asBase64(blob);
        const res = await api('/api/upload', {
            method: 'POST',
            body: { grid: state.grid.id, type: blob.type || FORMAT, data }
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
            else closeViewer();
        });
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            if (!$('picker').hidden) picker.close();
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

    const line = (id, what, name, under) => `
        <li>
            <span class="lister-face" aria-hidden="true">${esc(initials(name))}</span>
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
                `@${esc(user.username)} · ${ROLE_NAMES[user.role]}`))
            .join('');

        const gridLines = admin.grids
            .map(grid => line(grid.id, 'grid', grid.name,
                `${grid.handle ? `@${esc(grid.handle)} · ` : ''}${people((grid.memberIds || []).length)}`))
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
    const drawer = { kind: null, id: null, password: '' };

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

            $('acct-title').textContent = grid.name;
            $('acct-sub').textContent = 'Όποιος μπει πάνω του μπορεί να το αλλάξει. Τα σχόλια των πελατών ξεχωρίζουν και σηκώνουν ένδειξη μέχρι να απαντηθούν.';

            body.innerHTML = `
                <div class="row-fields">
                    <label>Όνομα<input data-f="name" value="${esc(grid.name)}" maxlength="60"></label>
                    <label>Instagram handle<input data-f="handle" value="${esc(grid.handle)}" maxlength="40" placeholder="χωρίς το @"></label>
                </div>

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
                    body: { kind: 'grid', id: drawer.id, ...fields(body), memberIds }
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
