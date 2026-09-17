// A grid and what is in it.
//
// GET                 -> every grid this account may open, with its badge counts
// GET  ?id=<gridId>   -> that grid and its twenty-four slots
// POST { id, action } -> save-post | delete-post | move-post | add-note | resolve-note | like
//
// Editors are the admin and the partners put on the grid. A client sees the
// same grid and writes on it, and that is the whole of what a client can do:
// the note they leave is the request for a change, not the change itself.
// Liking a picture is the one thing everybody on a grid does alike.
const accounts = require('./_accounts');
const blob = require('./_blob');
const feed = require('./_feed');
const presence = require('./_presence');

const MAX_IMAGES = 10;      // what a carousel holds on Instagram
const MAX_CAPTION = 2200;   // what a caption holds on Instagram
const MAX_NOTE = 1000;
const MAX_NOTES = 100;

// The circles under the bio. Instagram shows no more than a profile can hold
// before they stop being a summary of anything.
const MAX_HIGHLIGHTS = 12;
const MAX_HIGHLIGHT_NAME = 24;

// A grid nobody has planned yet shows four rows, which is what a profile shows
// under the bio before anyone scrolls. From there the plan is whatever it has
// been set to, posts included, and never more than the grid holds.
const DEFAULT_SLOTS = 12;

// How far down the last picture reaches. A grid can never be shorter than
// that, whatever the plan says.
const used = (posts) => posts.reduce((far, post, i) => (post ? i + 1 : far), 0);

const planOf = (grid, posts) => {
    const set = grid.slots === undefined || grid.slots === null ? DEFAULT_SLOTS : Number(grid.slots);
    const wanted = Number.isFinite(set) ? set : DEFAULT_SLOTS;
    return Math.max(used(posts), Math.min(accounts.SLOTS, wanted));
};

// Only urls this deployment's own image store handed back, which is the one
// rule every picture in the portal answers to. See api/_blob.js.
const isOurImage = blob.isOurImage;

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

// A like is on one picture, not on the post, so a carousel carries one list per
// picture and they are kept under the url rather than the position: reordering
// a carousel should not hand a picture somebody else's hearts.
const likesOf = (post) => (post && post.likes && typeof post.likes === 'object') ? post.likes : {};

// What survives a post being saved again: the hearts on the pictures that are
// still in it. A picture that has been replaced takes its hearts with it.
const keptLikes = (post, images) => {
    const was = likesOf(post);
    const out = {};
    images.forEach(img => { if (Array.isArray(was[img.url])) out[img.url] = was[img.url]; });
    return out;
};

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
    // How many squares the grid is planned to have: the posts, plus however
    // many empty ones have been put after them to hold the place of what is
    // still to come.
    slots: planOf(grid, posts),
    // The little square beside the name in the sidebar: the admin's own if they
    // set one, and otherwise the grid's profile picture, which is the face
    // everybody working on it already knows the project by.
    icon: accounts.faceOf(grid),
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

        // Working on a grid is being at your screen. This is most of what
        // anybody does here, so it is most of what presence is made of.
        await presence.touch(me.id);

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
        if (['save-post', 'add-post', 'set-slots', 'add-slot', 'remove-slot', 'delete-post', 'move-post', 'resolve-note',
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
                notes: existing && Array.isArray(existing.notes) ? existing.notes : [],
                likes: keptLikes(existing, images)
            };

            await accounts.writePosts(grid.id, posts);

            const kept = images.map(img => img.url);
            await forget(req, urlsOf(existing).filter(url => !kept.includes(url)));

            await feed.push({
                gridId: grid.id, gridName: grid.name,
                actorId: me.id, actorName: me.name || me.username, actorRole: me.role,
                kind: existing ? 'edit' : 'post',
                slot, postId: posts[slot].id, image: images[0].url
            });

            return res.status(200).json({ post: posts[slot], slot });
        }

        // A new post is the newest post, so it goes to the front and everything
        // else moves down one, the way a profile fills up. Editing an existing
        // one stays where it is, which is what save-post above does.
        if (action === 'add-post') {
            const images = cleanImages(body.images);

            // Everything moves down one to make room at the front, so the last
            // square has to be free or a picture would fall off the end of the
            // grid to make room for this one.
            if (posts[accounts.SLOTS - 1]) return res.status(400).json({ error: 'grid-full' });

            posts.unshift({
                id: accounts.newId('pst'),
                images,
                caption: text(body.caption, MAX_CAPTION),
                createdAt: now,
                updatedAt: now,
                notes: [],
                likes: {}
            });
            if (posts.length > accounts.SLOTS) posts.length = accounts.SLOTS;

            await accounts.writePosts(grid.id, posts);

            await feed.push({
                gridId: grid.id, gridName: grid.name,
                actorId: me.id, actorName: me.name || me.username, actorRole: me.role,
                kind: 'post', slot: 0, postId: posts[0].id, image: images[0].url
            });

            // The plan keeps up with the grid when the grid overtakes it.
            const slots = planOf(grid, posts);
            if (slots !== grid.slots) { grid.slots = slots; await accounts.writeAccounts(doc); }

            return res.status(200).json({ posts, slots });
        }

        // How many squares to show. Fewer than there are posts is not a number
        // the grid can be, and more than it holds is not either.
        if (action === 'set-slots') {
            const want = Number(body.slots);
            if (!Number.isInteger(want)) return res.status(400).json({ error: 'bad-slots' });

            const slots = Math.max(used(posts), Math.min(accounts.SLOTS, want));
            grid.slots = slots;
            await accounts.writeAccounts(doc);

            return res.status(200).json({ slots });
        }

        // A new square goes to the front, where the next post will go, and
        // everything already there moves down one to make room for it.
        if (action === 'add-slot') {
            const shown = planOf(grid, posts);
            if (shown >= accounts.SLOTS || posts[accounts.SLOTS - 1]) {
                return res.status(400).json({ error: 'grid-full' });
            }

            posts.unshift(null);
            posts.length = accounts.SLOTS;
            await accounts.writePosts(grid.id, posts);

            grid.slots = shown + 1;
            await accounts.writeAccounts(doc);

            return res.status(200).json({ posts, slots: grid.slots });
        }

        // Taking a square off the grid altogether. Only an empty one: a square
        // with a picture in it is deleted by deleting the picture, which says
        // what is actually being thrown away.
        if (action === 'remove-slot') {
            const slot = slotOf(body.slot);
            if (posts[slot]) return res.status(400).json({ error: 'not-empty' });

            const shown = planOf(grid, posts);

            posts.splice(slot, 1);
            posts.push(null);
            await accounts.writePosts(grid.id, posts);

            grid.slots = Math.max(used(posts), shown - 1);
            await accounts.writeAccounts(doc);

            return res.status(200).json({ posts, slots: grid.slots });
        }

        if (action === 'delete-post') {
            const slot = slotOf(body.slot);
            const gone = posts[slot];

            // The square stays where it is and goes empty, holding the place
            // in case something else is meant for it.
            posts[slot] = null;

            await accounts.writePosts(grid.id, posts);
            await forget(req, urlsOf(gone));

            // No thumbnail on this one: the picture it would show is the one
            // being deleted from the store on the line above.
            await feed.push({
                gridId: grid.id, gridName: grid.name,
                actorId: me.id, actorName: me.name || me.username, actorRole: me.role,
                kind: 'delete', slot, postId: gone ? gone.id : null
            });

            return res.status(200).json({ slot });
        }

        // Two squares trade places, whatever is in them. A picture onto an
        // empty square lands on that square and the empty one takes its old
        // place, which is also how an empty square is moved: from the other
        // end of the same gesture.
        if (action === 'move-post') {
            const from = slotOf(body.from);
            const to = slotOf(body.to);

            const moved = posts[from];
            posts[from] = posts[to];
            posts[to] = moved;

            await accounts.writePosts(grid.id, posts);
            return res.status(200).json({ from, to, posts });
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

            // A reply belongs to the note it answers, and an answer to an
            // answer belongs to the same one: a thread here is one level deep,
            // because the panel it is read in is the width of a phone.
            let replyTo = null;
            if (body.replyTo) {
                const parent = post.notes.find(n => n.id === body.replyTo);
                if (parent) replyTo = parent.replyTo || parent.id;
            }

            const note = {
                id: accounts.newId('nte'),
                userId: me.id,
                name: me.name || me.username,
                role: me.role,
                text: said,
                at: now,
                resolved: false,
                replyTo
            };
            post.notes.push(note);

            await accounts.writePosts(grid.id, posts);

            await feed.push({
                gridId: grid.id, gridName: grid.name,
                actorId: me.id, actorName: me.name || me.username, actorRole: me.role,
                kind: replyTo ? 'reply' : 'note',
                slot, postId: post.id,
                image: (post.images[0] || {}).url || null,
                text: feed.excerpt(said)
            });

            return res.status(200).json({ slot, note });
        }

        // Changing and removing a note are the author's own business, so they
        // are not on the editors' list above. Nobody rewrites somebody else's
        // words; an admin may take a note down, being the one who answers for
        // what the portal holds.
        if (action === 'edit-note' || action === 'delete-note') {
            const slot = slotOf(body.slot);
            const post = posts[slot];
            if (!post || !Array.isArray(post.notes)) return res.status(404).json({ error: 'no-such-post' });

            const note = post.notes.find(n => n.id === body.noteId);
            if (!note) return res.status(404).json({ error: 'no-such-note' });

            const mine = note.userId === me.id;

            if (action === 'edit-note') {
                if (!mine) return res.status(403).json({ error: 'not-yours' });

                const said = text(body.text, MAX_NOTE);
                if (!said) return res.status(400).json({ error: 'empty-note' });

                note.text = said;
                note.editedAt = now;

                await accounts.writePosts(grid.id, posts);
                return res.status(200).json({ slot, note });
            }

            if (!mine && me.role !== 'admin') return res.status(403).json({ error: 'not-yours' });

            // A note that is answered takes its answers with it, so no reply is
            // left hanging under something that is no longer there.
            post.notes = post.notes.filter(n => n.id !== note.id && n.replyTo !== note.id);

            await accounts.writePosts(grid.id, posts);
            return res.status(200).json({ slot, notes: post.notes });
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

        // --- a heart on one picture ------------------------------------------
        // Not on the editors' list: everybody on a grid likes the same way, and
        // a client saying which of three pictures they like is half the reason
        // the portal exists.
        if (action === 'like') {
            const slot = slotOf(body.slot);
            const post = posts[slot];
            if (!post) return res.status(404).json({ error: 'no-such-post' });

            const index = Number(body.index);
            const image = Number.isInteger(index) ? post.images[index] : null;
            if (!image) return res.status(400).json({ error: 'bad-image' });

            post.likes = { ...likesOf(post) };
            const on = Array.isArray(post.likes[image.url]) ? post.likes[image.url] : [];
            const already = on.some(like => like.userId === me.id);

            // The name is written down beside the id so that the viewer can say
            // who liked a picture without asking for the account list, which is
            // a thing only an admin is allowed to read.
            post.likes[image.url] = already
                ? on.filter(like => like.userId !== me.id)
                : on.concat({ userId: me.id, name: me.name || me.username, at: now });

            await accounts.writePosts(grid.id, posts);

            // Taking a heart back is not news.
            if (!already) {
                await feed.push({
                    gridId: grid.id, gridName: grid.name,
                    actorId: me.id, actorName: me.name || me.username, actorRole: me.role,
                    kind: 'like', slot, postId: post.id, image: image.url
                });
            }

            return res.status(200).json({ slot, likes: post.likes });
        }

        return res.status(400).json({ error: 'bad-action' });
    } catch (err) {
        const known = ['bad-slot', 'no-images', 'bad-image', 'bad-name', 'too-many-highlights'];
        const status = known.includes(err.message) ? 400 : 500;
        return res.status(status).json({ error: err.message });
    }
};
