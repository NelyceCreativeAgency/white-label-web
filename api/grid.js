// A grid and what is in it.
//
// GET                 -> every grid this account may open, with its badge counts
// GET  ?id=<gridId>   -> that grid and its twenty-four slots
// POST { id, action } -> save-post | delete-post | move-post | add-note | resolve-note
//
// Editors are the admin and the partners put on the grid. A client sees the
// same grid and writes on it, and that is the whole of what a client can do:
// the note they leave is the request for a change, not the change itself.
const accounts = require('./_accounts');
const blob = require('./_blob');

const MAX_IMAGES = 10;      // what a carousel holds on Instagram
const MAX_CAPTION = 2200;   // what a caption holds on Instagram
const MAX_NOTE = 1000;
const MAX_NOTES = 100;

// The circles under the bio. Instagram shows no more than a profile can hold
// before they stop being a summary of anything.
const MAX_HIGHLIGHTS = 12;
const MAX_HIGHLIGHT_NAME = 24;

// Only urls this deployment's own image store handed back. Anything else would
// let a signed-in account point a post at a picture on someone else's server.
const BLOB_HOST = /^[a-z0-9-]+\.(public\.)?blob\.vercel-storage\.com$/i;

const isOurImage = (url) => {
    let parsed;
    try { parsed = new URL(String(url)); }
    catch { return false; }
    return parsed.protocol === 'https:' && BLOB_HOST.test(parsed.hostname);
};

const text = (value, max) => String(value == null ? '' : value).trim().slice(0, max);

const readBody = (req) =>
    typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

const size = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 && n < 20000 ? Math.round(n) : null;
};

const cleanImages = (raw) => {
    if (!Array.isArray(raw) || !raw.length) throw new Error('no-images');

    const images = raw.slice(0, MAX_IMAGES).map(img => {
        if (!img || !isOurImage(img.url)) throw new Error('bad-image');
        return { url: String(img.url), w: size(img.w), h: size(img.h) };
    });

    return images;
};

// The profile picture and a highlight cover are single pictures rather than a
// carousel, but they live in the same store and answer to the same rule: only
// somewhere this deployment put them.
const oneImage = (url) => {
    if (!isOurImage(url)) throw new Error('bad-image');
    return String(url);
};

const urlsOf = (post) =>
    post && Array.isArray(post.images) ? post.images.map(img => img.url) : [];

// A picture nobody points at any more is deleted from the store, but never at
// the cost of the write itself: the grid is what the visitor sees, and it has
// already been saved by the time this runs.
const forget = async (req, urls) => {
    if (!urls.length) return;
    try { await blob.client(req).del(urls); } catch { /* litter, not a failure */ }
};

const slotOf = (value) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n >= accounts.SLOTS) throw new Error('bad-slot');
    return n;
};

const summary = (grid, posts, user) => ({
    id: grid.id,
    name: grid.name,
    handle: grid.handle || '',
    avatar: grid.avatar || null,
    highlights: Array.isArray(grid.highlights) ? grid.highlights : [],
    filled: posts.filter(Boolean).length,
    openNotes: accounts.openNoteCount(posts),
    canEdit: accounts.canEdit(user, grid)
});

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');

    try {
        const doc = await accounts.readAccounts();
        const me = await accounts.currentUser(req, doc);
        if (!me) return res.status(401).json({ error: 'not-signed-in' });

        const id = (req.query && req.query.id) || (req.method === 'POST' ? readBody(req).id : null);

        // The whole list, for the sidebar.
        if (req.method === 'GET' && !id) {
            const grids = accounts.gridsFor(doc, me);
            const out = [];
            for (const grid of grids) {
                out.push(summary(grid, await accounts.readPosts(grid.id), me));
            }
            return res.status(200).json({ grids: out });
        }

        const grid = accounts.findGrid(doc, id);
        if (!grid || !accounts.canView(me, grid)) return res.status(404).json({ error: 'no-such-grid' });

        const posts = await accounts.readPosts(grid.id);

        if (req.method === 'GET') {
            return res.status(200).json({ grid: summary(grid, posts, me), posts });
        }

        if (req.method !== 'POST') {
            res.setHeader('Allow', 'GET, POST');
            return res.status(405).json({ error: 'Method not allowed.' });
        }

        const body = readBody(req);
        const action = body.action;
        const mayEdit = accounts.canEdit(me, grid);
        const now = new Date().toISOString();

        // --- the editors' actions -------------------------------------------
        if (['save-post', 'delete-post', 'move-post', 'resolve-note',
             'set-avatar', 'save-highlight', 'delete-highlight'].includes(action)) {
            if (!mayEdit) return res.status(403).json({ error: 'not-allowed' });
        }

        if (action === 'save-post') {
            const slot = slotOf(body.slot);
            const images = cleanImages(body.images);
            const existing = posts[slot];

            posts[slot] = {
                id: existing ? existing.id : accounts.newId('pst'),
                images,
                caption: text(body.caption, MAX_CAPTION),
                createdAt: existing ? existing.createdAt : now,
                updatedAt: now,
                // Notes belong to the conversation about the post, not to the
                // pictures, so replacing an image never wipes what was said.
                notes: existing && Array.isArray(existing.notes) ? existing.notes : []
            };

            await accounts.writePosts(grid.id, posts);

            const kept = images.map(img => img.url);
            await forget(req, urlsOf(existing).filter(url => !kept.includes(url)));

            return res.status(200).json({ post: posts[slot], slot });
        }

        if (action === 'delete-post') {
            const slot = slotOf(body.slot);
            const gone = posts[slot];
            posts[slot] = null;

            await accounts.writePosts(grid.id, posts);
            await forget(req, urlsOf(gone));

            return res.status(200).json({ slot });
        }

        if (action === 'move-post') {
            const from = slotOf(body.from);
            const to = slotOf(body.to);
            const moved = posts[from];
            posts[from] = posts[to];
            posts[to] = moved;

            await accounts.writePosts(grid.id, posts);
            return res.status(200).json({ from, to });
        }

        if (action === 'set-avatar') {
            const was = grid.avatar || null;
            grid.avatar = body.url ? oneImage(body.url) : null;

            await accounts.writeAccounts(doc);
            if (was && was !== grid.avatar) await forget(req, [was]);

            return res.status(200).json({ avatar: grid.avatar });
        }

        if (action === 'save-highlight') {
            grid.highlights = Array.isArray(grid.highlights) ? grid.highlights : [];

            const name = text(body.name, MAX_HIGHLIGHT_NAME);
            if (!name) throw new Error('bad-name');
            const url = oneImage(body.url);

            const existing = body.highlight
                ? grid.highlights.find(h => h.id === body.highlight)
                : null;
            let was = null;

            if (existing) {
                was = existing.url;
                existing.name = name;
                existing.url = url;
            } else {
                if (grid.highlights.length >= MAX_HIGHLIGHTS) throw new Error('too-many-highlights');
                grid.highlights.push({ id: accounts.newId('hlt'), name, url });
            }

            await accounts.writeAccounts(doc);
            if (was && was !== url) await forget(req, [was]);

            return res.status(200).json({ highlights: grid.highlights });
        }

        if (action === 'delete-highlight') {
            const all = Array.isArray(grid.highlights) ? grid.highlights : [];
            const gone = all.find(h => h.id === body.highlight);

            grid.highlights = all.filter(h => h.id !== body.highlight);
            await accounts.writeAccounts(doc);
            if (gone) await forget(req, [gone.url]);

            return res.status(200).json({ highlights: grid.highlights });
        }

        if (action === 'add-note') {
            const slot = slotOf(body.slot);
            const post = posts[slot];
            if (!post) return res.status(404).json({ error: 'no-such-post' });

            const said = text(body.text, MAX_NOTE);
            if (!said) return res.status(400).json({ error: 'empty-note' });

            post.notes = Array.isArray(post.notes) ? post.notes : [];
            if (post.notes.length >= MAX_NOTES) return res.status(400).json({ error: 'too-many-notes' });

            const note = {
                id: accounts.newId('nte'),
                userId: me.id,
                name: me.name || me.username,
                role: me.role,
                text: said,
                at: now,
                resolved: false
            };
            post.notes.push(note);

            await accounts.writePosts(grid.id, posts);
            return res.status(200).json({ slot, note });
        }

        if (action === 'resolve-note') {
            const slot = slotOf(body.slot);
            const post = posts[slot];
            if (!post || !Array.isArray(post.notes)) return res.status(404).json({ error: 'no-such-post' });

            const note = post.notes.find(n => n.id === body.noteId);
            if (!note) return res.status(404).json({ error: 'no-such-note' });

            note.resolved = body.resolved !== false;
            note.resolvedAt = note.resolved ? now : null;

            await accounts.writePosts(grid.id, posts);
            return res.status(200).json({ slot, note });
        }

        return res.status(400).json({ error: 'bad-action' });
    } catch (err) {
        const known = ['bad-slot', 'no-images', 'bad-image', 'bad-name', 'too-many-highlights'];
        const status = known.includes(err.message) ? 400 : 500;
        return res.status(status).json({ error: err.message });
    }
};
