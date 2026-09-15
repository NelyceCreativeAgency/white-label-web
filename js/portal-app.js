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
        draft: null,    // { slot, images, caption } while the editor is open
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

        $('profile-avatar').textContent = initials(grid.name);
        $('profile-name').textContent = grid.name;
        $('profile-handle').textContent = grid.handle ? `@${grid.handle}` : '';

        const filled = state.posts.filter(Boolean).length;
        $('profile-stats').innerHTML = `
            <span><strong>${filled}</strong> αναρτήσεις</span>
            <span><strong>${SLOTS - filled}</strong> ελεύθερες θέσεις</span>
            ${open && grid.canEdit ? `<span class="stat-flag"><strong>${open}</strong> θέλουν αλλαγή</span>` : ''}
        `;

        $('profile-hint').textContent = grid.canEdit
            ? 'Πάτα το + για να βάλεις εικόνα, από αρχείο ή από σύνδεσμο. Σύρε ένα κουτάκι με το ποντίκι για να αλλάξεις θέση. Οι τρεις τελείες ανοίγουν επεξεργασία, carousel και διαγραφή.'
            : 'Πάτα μια εικόνα για να τη δεις μεγάλη και να αφήσεις σχόλιο.';

        const editing = grid.canEdit;
        const cells = [];

        for (let slot = 0; slot < SLOTS; slot++) {
            const post = state.posts[slot];
            const target = state.moving !== null && state.moving !== slot;

            if (!post) {
                cells.push(editing
                    ? `<button class="cell cell-empty${target ? ' is-target' : ''}" type="button" data-slot="${slot}" data-act="add">
                           <span class="cell-plus" aria-hidden="true">+</span>
                           <span class="visually-hidden">Προσθήκη εικόνας στη θέση ${slot + 1}</span>
                       </button>`
                    : `<div class="cell cell-empty is-quiet" aria-hidden="true"></div>`);
                continue;
            }

            const cover = (post.images || [])[0];
            if (!cover) { cells.push('<div class="cell cell-empty is-quiet"></div>'); continue; }
            const notes = (post.notes || []).filter(n => n.role === 'client' && !n.resolved).length;

            cells.push(`
                <div class="cell is-filled${state.moving === slot ? ' is-moving' : ''}${target ? ' is-target' : ''}"
                     data-slot="${slot}"${editing ? ' draggable="true"' : ''}>
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

        $('ig-grid').innerHTML = cells.join('');
    };

    // --- clicking around the grid ------------------------------------------
    $('ig-grid').addEventListener('click', (event) => {
        const cell = event.target.closest('.cell');
        if (!cell) return;

        const slot = Number(cell.dataset.slot);

        // A move is in the air: the next cell that is clicked is where the
        // post lands, whether that slot is taken or free.
        if (state.moving !== null) {
            if (state.moving !== slot) swap(state.moving, slot);
            else cancelMove();
            return;
        }

        const act = event.target.closest('[data-act]');
        const what = act ? act.dataset.act : null;

        if (what === 'menu') { openMenu(act, slot); return; }
        if (what === 'add') { openEditor(slot, null); return; }
        if (state.posts[slot]) openViewer(slot, 0);
    });

    // Dragging a post onto another swaps the two, and onto an empty slot moves
    // it there. Nothing else on the grid shifts, so a drag is always one change
    // and always undone by dragging back.
    const board = $('ig-grid');

    const clearDrop = () => {
        board.querySelectorAll('.is-dragging, .is-over')
            .forEach(cell => cell.classList.remove('is-dragging', 'is-over'));
    };

    board.addEventListener('dragstart', (event) => {
        const cell = event.target.closest('.cell.is-filled');
        if (!cell || !canEdit()) { event.preventDefault(); return; }

        state.dragging = Number(cell.dataset.slot);
        cell.classList.add('is-dragging');
        event.dataTransfer.effectAllowed = 'move';
        // Firefox starts no drag at all unless something is carried.
        event.dataTransfer.setData('text/plain', String(state.dragging));
    });

    board.addEventListener('dragover', (event) => {
        if (state.dragging === null) return;
        const cell = event.target.closest('.cell');
        if (!cell || Number(cell.dataset.slot) === state.dragging) return;

        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        if (!cell.classList.contains('is-over')) {
            board.querySelectorAll('.is-over').forEach(c => c.classList.remove('is-over'));
            cell.classList.add('is-over');
        }
    });

    board.addEventListener('drop', (event) => {
        event.preventDefault();
        const cell = event.target.closest('.cell');
        const from = state.dragging;
        const to = cell ? Number(cell.dataset.slot) : NaN;

        state.dragging = null;
        clearDrop();

        if (from !== null && Number.isInteger(to) && from !== to) swap(from, to);
    });

    board.addEventListener('dragend', () => {
        state.dragging = null;
        clearDrop();
    });

    const swap = async (from, to) => {
        cancelMove();
        busy('Μετακίνηση…');
        try {
            await api('/api/grid', { method: 'POST', body: { id: state.grid.id, action: 'move-post', from, to } });
            const moved = state.posts[from];
            state.posts[from] = state.posts[to];
            state.posts[to] = moved;
            renderGrid();
        } catch (err) {
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
            <button type="button" data-do="carousel"${post.images.length >= MAX_IMAGES ? ' disabled' : ''}>
                Προσθήκη για carousel
            </button>
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
            case 'carousel': openEditor(slot, post); break;
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
        $('post-modal').hidden = false;
        document.body.classList.add('is-locked');
        renderViewer();
    };

    const closeViewer = () => {
        state.viewing = null;
        $('post-modal').hidden = true;
        if ($('edit-modal').hidden) document.body.classList.remove('is-locked');
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

    const renderNotes = (post, slot) => {
        const notes = post.notes || [];
        const list = $('note-list');

        list.innerHTML = notes.length
            ? notes.map(note => `
                <li class="note${note.resolved ? ' is-done' : ''}${note.role === 'client' ? ' is-client' : ''}">
                    <p class="note-who">
                        <strong>${esc(note.name)}</strong>
                        <small>${esc(ROLE_NAMES[note.role] || '')} · ${esc(when(note.at))}</small>
                    </p>
                    <p class="note-text">${esc(note.text)}</p>
                    ${canEdit() && note.role === 'client' ? `
                        <button class="note-done" type="button" data-note="${esc(note.id)}" data-slot="${slot}"
                                data-resolved="${note.resolved ? '1' : '0'}">
                            ${note.resolved ? 'Άνοιγμα ξανά' : 'Έγινε'}
                        </button>` : ''}
                </li>`).join('')
            : '<li class="note-none">Κανένα σχόλιο ακόμα.</li>';
    };

    $('note-list').addEventListener('click', async (event) => {
        const button = event.target.closest('.note-done');
        if (!button) return;

        const slot = Number(button.dataset.slot);
        try {
            const data = await api('/api/grid', {
                method: 'POST',
                body: {
                    id: state.grid.id, action: 'resolve-note',
                    slot, noteId: button.dataset.note,
                    resolved: button.dataset.resolved !== '1'
                }
            });
            const post = state.posts[slot];
            const note = (post.notes || []).find(n => n.id === data.note.id);
            if (note) Object.assign(note, data.note);
            renderNotes(post, slot);
            renderGrid();
            refreshBadge();
        } catch (err) {
            toast(explain(err), 'bad');
        }
    });

    $('note-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const field = $('note-text');
        const said = field.value.trim();
        if (!said || !state.viewing) return;

        const { slot } = state.viewing;
        field.disabled = true;

        try {
            const data = await api('/api/grid', {
                method: 'POST',
                body: { id: state.grid.id, action: 'add-note', slot, text: said }
            });
            const post = state.posts[slot];
            post.notes = post.notes || [];
            post.notes.push(data.note);
            field.value = '';
            renderNotes(post, slot);
            renderGrid();
            refreshBadge();
            toast(state.me.role === 'client' ? 'Το σχόλιο στάλθηκε.' : 'Το σχόλιο μπήκε.');
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
            slot,
            images: post ? post.images.slice() : [],
            pending: 0
        };
        $('edit-title').textContent = post ? 'Επεξεργασία ανάρτησης' : 'Νέα ανάρτηση';
        $('edit-caption').value = post ? (post.caption || '') : '';
        sayEdit('');
        $('edit-modal').hidden = false;
        document.body.classList.add('is-locked');
        $('edit-link').hidden = true;
        $('edit-link-url').value = '';
        renderStrip();
    };

    const closeEditor = () => {
        state.draft = null;
        $('edit-modal').hidden = true;
        if ($('post-modal').hidden) document.body.classList.remove('is-locked');
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
                <button class="strip-tile strip-add" type="button" data-do="add">
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

        if (button.dataset.do === 'add') { openSourceMenu(button); return; }

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

    // Two ways in, asked as a question rather than assumed.
    const sources = document.createElement('div');
    sources.className = 'cell-menu source-menu';
    sources.hidden = true;
    sources.innerHTML = `
        <button type="button" data-from="file">Από τον υπολογιστή</button>
        <button type="button" data-from="link">Από σύνδεσμο</button>
    `;
    document.body.appendChild(sources);

    const openSourceMenu = (button) => {
        sources.hidden = false;
        const box = button.getBoundingClientRect();
        const left = Math.min(box.left, window.innerWidth - sources.offsetWidth - 12);
        const top = box.bottom + sources.offsetHeight > window.innerHeight
            ? box.top - sources.offsetHeight - 6
            : box.bottom + 6;
        sources.style.left = `${Math.max(12, left) + window.scrollX}px`;
        sources.style.top = `${Math.max(12, top) + window.scrollY}px`;
    };

    sources.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-from]');
        if (!button) return;
        sources.hidden = true;

        if (button.dataset.from === 'file') { pickFiles(); return; }

        $('edit-link').hidden = false;
        $('edit-link-url').focus();
    });

    document.addEventListener('click', (event) => {
        if (!sources.hidden && !sources.contains(event.target) && !event.target.closest('[data-do="add"]')) {
            sources.hidden = true;
        }
    });

    // --- pictures in ------------------------------------------------------
    // A phone takes twelve-megapixel photographs and a grid cell is two hundred
    // pixels across. The browser redraws the picture at a sane size before any
    // of it goes over the wire, which is what keeps the upload quick and the
    // store small.
    const MAX_SIDE = 1440;
    const TARGET_BYTES = 2.6 * 1024 * 1024;

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

    const draw = (source, quality) => new Promise((resolve, reject) => {
        const width = source.width;
        const height = source.height;
        const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
        const w = Math.max(1, Math.round(width * scale));
        const h = Math.max(1, Math.round(height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(source, 0, 0, w, h);

        canvas.toBlob(
            blob => blob ? resolve({ blob, w, h }) : reject(new Error('unreadable')),
            'image/jpeg',
            quality
        );
    });

    const shrink = async (file) => {
        const source = await loadImage(file);
        let quality = 0.82;
        let out = await draw(source, quality);

        // Very large photographs can still come out above what a request is
        // allowed to carry. Each pass costs quality rather than size, so the
        // picture keeps its dimensions and the grid keeps its sharpness.
        while (out.blob.size > TARGET_BYTES && quality > 0.5) {
            quality -= 0.12;
            out = await draw(source, quality);
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

    const pickFiles = () => {
        const input = $('file-input');
        input.value = '';
        input.click();
    };

    $('file-input').addEventListener('change', async (event) => {
        const files = Array.from(event.target.files || []);
        if (!files.length || !state.draft) return;

        const room = MAX_IMAGES - state.draft.images.length - state.draft.pending;
        if (room <= 0) { sayEdit(`Ένα carousel παίρνει μέχρι ${MAX_IMAGES} εικόνες.`); return; }

        const taking = files.slice(0, room);
        if (files.length > room) sayEdit(`Μπήκαν οι ${room} πρώτες. Ένα carousel παίρνει μέχρι ${MAX_IMAGES}.`);
        else sayEdit('');

        state.draft.pending += taking.length;
        renderStrip();

        for (const file of taking) {
            try {
                await absorb(file);
            } catch (err) {
                sayEdit(err.message === 'unreadable'
                    ? `Η εικόνα "${file.name}" δεν διαβάζεται. Δοκίμασε JPG ή PNG.`
                    : explain(err));
            } finally {
                if (state.draft) {
                    state.draft.pending = Math.max(0, state.draft.pending - 1);
                    renderStrip();
                }
            }
        }
    });

    // Shrink it, send it, and put it in the draft. Both ways in end here, so a
    // picture from a link is stored exactly like a picture from the desktop and
    // nothing downstream has to know the difference.
    const absorb = async (source) => {
        const { blob, w, h } = await shrink(source);
        const data = await asBase64(blob);
        const res = await api('/api/upload', {
            method: 'POST',
            body: { grid: state.grid.id, type: 'image/jpeg', data }
        });

        if (!state.draft) return;   // the editor was closed while it uploaded
        state.draft.images.push({ url: res.url, w, h });
    };

    // --- a picture that lives somewhere else --------------------------------
    // The server fetches it, because a browser cannot read back what it drew
    // from another site, and because a Drive link is a page rather than a file.
    const addFromLink = async () => {
        const field = $('edit-link-url');
        const url = field.value.trim();
        if (!url || !state.draft) return;

        if (state.draft.images.length + state.draft.pending >= MAX_IMAGES) {
            sayEdit(`Ένα carousel παίρνει μέχρι ${MAX_IMAGES} εικόνες.`);
            return;
        }

        sayEdit('');
        field.disabled = true;
        state.draft.pending++;
        renderStrip();

        try {
            const res = await fetch('/api/link', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ grid: state.grid.id, url })
            });

            if (res.status === 401) { location.replace(LOGIN); return; }
            if (!res.ok) {
                const said = await res.json().catch(() => ({}));
                throw new Error(said.error || `HTTP ${res.status}`);
            }

            await absorb(await res.blob());
            field.value = '';
            $('edit-link').hidden = true;
        } catch (err) {
            sayEdit(err.message === 'unreadable'
                ? 'Το αρχείο στον σύνδεσμο δεν διαβάζεται σαν εικόνα.'
                : explain(err));
        } finally {
            field.disabled = false;
            if (state.draft) {
                state.draft.pending = Math.max(0, state.draft.pending - 1);
                renderStrip();
            }
        }
    };

    $('edit-link-add').addEventListener('click', addFromLink);

    $('edit-link-url').addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        addFromLink();
    });

    $('edit-save').addEventListener('click', async () => {
        const draft = state.draft;
        if (!draft) return;

        if (draft.pending) { sayEdit('Περίμενε να ανέβουν οι εικόνες.'); return; }
        if (!draft.images.length) { sayEdit('Βάλε τουλάχιστον μία εικόνα.'); return; }

        busy('Αποθήκευση…');
        try {
            const data = await api('/api/grid', {
                method: 'POST',
                body: {
                    id: state.grid.id,
                    action: 'save-post',
                    slot: draft.slot,
                    images: draft.images,
                    caption: $('edit-caption').value
                }
            });
            state.posts[draft.slot] = data.post;
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

    // --- closing things ----------------------------------------------------
    document.querySelectorAll('[data-close]').forEach(button => {
        button.addEventListener('click', () => {
            if (button.closest('#edit-modal')) closeEditor();
            else closeViewer();
        });
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            if (!$('edit-modal').hidden) closeEditor();
            else if (!$('post-modal').hidden) closeViewer();
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

    const renderAccounts = () => {
        const members = admin.users.filter(u => u.role !== 'admin');

        const userRows = admin.users.map(user => `
            <li class="row" data-user="${esc(user.id)}">
                <div class="row-fields">
                    <label>Όνομα<input data-f="name" value="${esc(user.name)}" maxlength="60"></label>
                    <label>Όνομα χρήστη<input data-f="username" value="${esc(user.username)}" maxlength="32" pattern="[A-Za-z0-9._\-]{3,32}" title="3 ως 32 λατινικοί χαρακτήρες, αριθμοί, τελεία, παύλα ή κάτω παύλα, χωρίς κενά" autocapitalize="none" spellcheck="false"></label>
                    <label>Ρόλος<select data-f="role">${roleOptions(user.role)}</select></label>
                    <label>Νέος κωδικός<input data-f="password" type="password" minlength="8" placeholder="αμετάβλητος" autocomplete="new-password"></label>
                </div>
                <div class="row-foot">
                    <small>${user.lastLoginAt ? `Τελευταία είσοδος: ${esc(when(user.lastLoginAt))}` : 'Δεν έχει μπει ακόμα'}</small>
                    <span class="row-buttons">
                        <button class="app-ghost" type="button" data-do="save-user">Αποθήκευση</button>
                        ${user.id === state.me.id ? '' : '<button class="app-ghost app-danger" type="button" data-do="delete-user">Διαγραφή</button>'}
                    </span>
                </div>
            </li>
        `).join('');

        const gridRows = admin.grids.map(grid => `
            <li class="row" data-gridrow="${esc(grid.id)}">
                <div class="row-fields">
                    <label>Όνομα<input data-f="name" value="${esc(grid.name)}" maxlength="60"></label>
                    <label>Instagram handle<input data-f="handle" value="${esc(grid.handle)}" maxlength="40" placeholder="χωρίς το @"></label>
                </div>
                <fieldset class="row-members">
                    <legend>Ποιοι το βλέπουν</legend>
                    ${members.length ? members.map(user => `
                        <label class="member">
                            <input type="checkbox" data-member="${esc(user.id)}"${grid.memberIds.includes(user.id) ? ' checked' : ''}>
                            <span>${esc(user.name)} <small>${ROLE_NAMES[user.role]}</small></span>
                        </label>`).join('')
                        : '<p class="row-none">Δεν υπάρχουν ακόμα λογαριασμοί για να μπουν.</p>'}
                </fieldset>
                <div class="row-foot">
                    <small>Οι συνεργάτες αλλάζουν το grid. Οι πελάτες το βλέπουν και σχολιάζουν.</small>
                    <span class="row-buttons">
                        <button class="app-ghost" type="button" data-do="save-grid">Αποθήκευση</button>
                        <button class="app-ghost app-danger" type="button" data-do="delete-grid">Διαγραφή</button>
                    </span>
                </div>
            </li>
        `).join('');

        $('view-accounts').innerHTML = `
            <section class="panel">
                <div class="panel-head">
                    <h2>Λογαριασμοί</h2>
                    <p>Εσύ ανοίγεις και κλείνεις τους λογαριασμούς. Το όνομα είναι για τα μάτια σου και δέχεται ελληνικά. Το όνομα χρήστη είναι αυτό που πληκτρολογεί στην είσοδο, θέλει λατινικούς χαρακτήρες χωρίς κενά. Ο κωδικός δίνεται μία φορά και δεν ξαναφαίνεται.</p>
                </div>

                <form class="new-row" id="new-user">
                    <input name="name" placeholder="Όνομα" maxlength="60" required>
                    <input name="username" placeholder="Όνομα χρήστη, λατινικά" maxlength="32" pattern="[A-Za-z0-9._\-]{3,32}" title="3 ως 32 λατινικοί χαρακτήρες, αριθμοί, τελεία, παύλα ή κάτω παύλα, χωρίς κενά" autocapitalize="none" spellcheck="false" required>
                    <select name="role">${roleOptions('client')}</select>
                    <input name="password" type="password" placeholder="Κωδικός, 8+ χαρακτήρες" minlength="8" autocomplete="new-password" required>
                    <button class="btn btn-primary" type="submit">Προσθήκη</button>
                </form>

                <p class="panel-error" id="user-error" role="alert" hidden></p>
                <ul class="rows">${userRows}</ul>
            </section>

            <section class="panel">
                <div class="panel-head">
                    <h2>Grids</h2>
                    <p>Ένα grid ανά σελίδα Instagram. Βάλε πάνω του όποιον πρέπει να το βλέπει.</p>
                </div>

                <form class="new-row" id="new-grid">
                    <input name="name" placeholder="Όνομα, π.χ. Vito" maxlength="60" required>
                    <input name="handle" placeholder="Instagram handle" maxlength="40">
                    <button class="btn btn-primary" type="submit">Νέο grid</button>
                </form>

                <p class="panel-error" id="grid-error" role="alert" hidden></p>
                <ul class="rows">${gridRows}</ul>
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

    $('view-accounts').addEventListener('click', async (event) => {
        const button = event.target.closest('button[data-do]');
        if (!button) return;

        const row = button.closest('.row');
        const what = button.dataset.do;

        try {
            if (what === 'save-user') {
                const body = { kind: 'user', id: row.dataset.user, ...fields(row) };
                if (!body.password) delete body.password;
                await api('/api/accounts', { method: 'PATCH', body });
                toast('Αποθηκεύτηκε.');
                await openAccounts();
                return;
            }

            if (what === 'delete-user') {
                if (!confirm('Να αφαιρεθεί ο λογαριασμός; Χάνει αμέσως την πρόσβασή του.')) return;
                await api(`/api/accounts?kind=user&id=${encodeURIComponent(row.dataset.user)}`, { method: 'DELETE' });
                toast('Ο λογαριασμός αφαιρέθηκε.');
                await openAccounts();
                return;
            }

            if (what === 'save-grid') {
                const memberIds = Array.from(row.querySelectorAll('[data-member]'))
                    .filter(box => box.checked)
                    .map(box => box.dataset.member);
                await api('/api/accounts', {
                    method: 'PATCH',
                    body: { kind: 'grid', id: row.dataset.gridrow, ...fields(row), memberIds }
                });
                toast('Αποθηκεύτηκε.');
                await loadGrids();
                await openAccounts();
                return;
            }

            if (what === 'delete-grid') {
                if (!confirm('Να διαγραφεί το grid μαζί με όλες τις εικόνες του; Δεν γίνεται αναίρεση.')) return;
                await api(`/api/accounts?kind=grid&id=${encodeURIComponent(row.dataset.gridrow)}`, { method: 'DELETE' });
                if (state.grid && state.grid.id === row.dataset.gridrow) {
                    state.grid = null;
                    remember.write(null);
                }
                toast('Το grid διαγράφηκε.');
                await loadGrids();
                await openAccounts();
            }
        } catch (err) {
            complain(button, explain(err));
        }
    });

    boot();
})();
