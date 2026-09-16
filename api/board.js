// The two things a project keeps besides its pictures and its talk: the links
// everybody needs to hand, and the ideas nobody has decided on yet.
//
// GET  ?grid=<id>       -> { links, notes }
// POST { grid, action } -> add-link | delete-link | add-note | edit-note | delete-note
//
// Both belong to the grid, so everybody who may open the grid reads them and
// everybody on it writes them. What you wrote is yours to change; an admin may
// take anything down, being the one who answers for what the portal holds.
const store = require('./_store');
const accounts = require('./_accounts');
const feed = require('./_feed');
const presence = require('./_presence');

const KEY = (gridId) => `portal:board:${gridId}`;

const MAX_LINKS = 200;
const MAX_NOTES = 200;
const MAX_URL = 2000;
const MAX_TITLE = 120;
const MAX_NOTE = 1200;
const MAX_TAGS = 5;
const MAX_TAG = 24;

// What has just been thrown away, in case it was thrown away by mistake. The
// whole record is kept, so undoing a deletion puts back the thing that was
// deleted rather than a copy of it signed by whoever pressed undo.
const MAX_BIN = 20;

// Five highlighter tones, and the note keeps the name rather than the colour:
// what amber looks like is the stylesheet's business, and it can be restyled
// later without rewriting what everybody has already written.
const COLOURS = ['amber', 'rose', 'mint', 'sky', 'lilac'];

const text = (value, max) => String(value == null ? '' : value).trim().slice(0, max);

const readBody = (req) =>
    typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

const readBoard = async (gridId) => {
    const doc = await store.readJson(KEY(gridId));
    return {
        links: doc && Array.isArray(doc.links) ? doc.links : [],
        notes: doc && Array.isArray(doc.notes) ? doc.notes : [],
        bin: doc && Array.isArray(doc.bin) ? doc.bin : []
    };
};

// Only what it was, where it was and who took it out. Nothing here is ever
// taken from the request, so undo cannot be used to invent a link that some-
// body else appears to have added.
const bin = (board, kind, item, index, by) => {
    board.bin.unshift({ kind, item, index, by, at: new Date().toISOString() });
    if (board.bin.length > MAX_BIN) board.bin.length = MAX_BIN;
};

const writeBoard = async (gridId, board) => {
    await store.writeJson(KEY(gridId), { ...board, updatedAt: new Date().toISOString() });
};

// Only somewhere a browser can actually go. Anything else, javascript: above
// all, would be a link one account could leave for another to click.
const cleanUrl = (raw) => {
    const said = text(raw, MAX_URL);
    if (!said) throw new Error('bad-link');

    // Somebody who types nelyce.com means https, and saying so is friendlier
    // than refusing it.
    const guess = /^[a-z][a-z0-9+.-]*:/i.test(said) ? said : `https://${said}`;

    let parsed;
    try { parsed = new URL(guess); }
    catch { throw new Error('bad-link'); }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('bad-link');
    return parsed.toString();
};

// A link with no title of its own is called by where it goes, which is more
// use in a list than the whole address.
const nameOf = (url, given) => {
    const said = text(given, MAX_TITLE);
    if (said) return said;
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch { return url; }
};

// Tags are whatever the person writing the note decided they were. Nothing is
// offered and nothing is required; they are only tidied so that the same word
// typed twice is one tag.
const cleanTags = (raw) => {
    const said = Array.isArray(raw) ? raw : String(raw || '').split(',');
    const out = [];

    said.forEach(one => {
        const tag = text(one, MAX_TAG).replace(/^#+/, '').trim();
        if (!tag) return;
        if (out.some(kept => kept.toLowerCase() === tag.toLowerCase())) return;
        if (out.length < MAX_TAGS) out.push(tag);
    });

    return out;
};

const colourOf = (raw) => (COLOURS.includes(raw) ? raw : COLOURS[0]);

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');

    try {
        const doc = await accounts.readAccounts();
        const me = await accounts.currentUser(req, doc);
        if (!me) return res.status(401).json({ error: 'not-signed-in' });

        const body = req.method === 'POST' ? readBody(req) : {};
        const gridId = (req.query && req.query.grid) || body.grid;
        const grid = accounts.findGrid(doc, gridId);
        if (!grid || !accounts.canView(me, grid)) return res.status(404).json({ error: 'no-such-grid' });

        await presence.touch(me.id);

        const board = await readBoard(grid.id);

        if (req.method === 'GET') {
            // The bin is the server's own bookkeeping, not something the page
            // has any use for.
            return res.status(200).json({ colours: COLOURS, links: board.links, notes: board.notes });
        }

        if (req.method !== 'POST') {
            res.setHeader('Allow', 'GET, POST');
            return res.status(405).json({ error: 'Method not allowed.' });
        }

        const now = new Date().toISOString();
        const mine = (thing) => thing.userId === me.id || me.role === 'admin';
        const signature = {
            userId: me.id,
            name: me.name || me.username,
            at: now
        };

        if (body.action === 'add-link') {
            if (board.links.length >= MAX_LINKS) return res.status(400).json({ error: 'board-full' });

            const url = cleanUrl(body.url);
            const link = {
                id: accounts.newId('lnk'),
                url,
                title: nameOf(url, body.title),
                note: text(body.note, MAX_TITLE),
                ...signature
            };

            // Newest first: a link that has just been found is the one somebody
            // is about to want.
            board.links.unshift(link);
            await writeBoard(grid.id, board);

            await feed.push({
                gridId: grid.id, gridName: grid.name,
                actorId: me.id, actorName: me.name || me.username, actorRole: me.role,
                kind: 'link', text: feed.excerpt(link.title)
            });

            return res.status(200).json({ links: board.links });
        }

        // Where a link sits in the list is a decision somebody made about which
        // ones matter, so it is kept rather than sorted, and anybody on the
        // project may make it: it is one list they all read.
        if (body.action === 'move-link') {
            const from = board.links.findIndex(one => one.id === body.id);
            if (from < 0) return res.status(404).json({ error: 'no-such-link' });

            const want = Number(body.to);
            if (!Number.isInteger(want)) return res.status(400).json({ error: 'bad-action' });

            const [link] = board.links.splice(from, 1);
            board.links.splice(Math.max(0, Math.min(board.links.length, want)), 0, link);

            await writeBoard(grid.id, board);
            return res.status(200).json({ links: board.links });
        }

        if (body.action === 'delete-link') {
            const link = board.links.find(one => one.id === body.id);
            if (!link) return res.status(404).json({ error: 'no-such-link' });
            if (!mine(link)) return res.status(403).json({ error: 'not-yours' });

            bin(board, 'link', link, board.links.indexOf(link), me.id);
            board.links = board.links.filter(one => one.id !== link.id);
            await writeBoard(grid.id, board);
            return res.status(200).json({ links: board.links });
        }

        if (body.action === 'add-note') {
            if (board.notes.length >= MAX_NOTES) return res.status(400).json({ error: 'board-full' });

            const said = text(body.text, MAX_NOTE);
            if (!said) return res.status(400).json({ error: 'empty-note' });

            const note = {
                id: accounts.newId('ide'),
                text: said,
                colour: colourOf(body.colour),
                tags: cleanTags(body.tags),
                ...signature
            };

            board.notes.unshift(note);
            await writeBoard(grid.id, board);

            await feed.push({
                gridId: grid.id, gridName: grid.name,
                actorId: me.id, actorName: me.name || me.username, actorRole: me.role,
                kind: 'idea', text: feed.excerpt(said)
            });

            return res.status(200).json({ notes: board.notes });
        }

        if (body.action === 'edit-note') {
            const note = board.notes.find(one => one.id === body.id);
            if (!note) return res.status(404).json({ error: 'no-such-note' });

            // Changing what somebody wrote is nobody else's business, an admin
            // included: taking it down is the most anyone else may do.
            if (note.userId !== me.id) return res.status(403).json({ error: 'not-yours' });

            const said = text(body.text, MAX_NOTE);
            if (!said) return res.status(400).json({ error: 'empty-note' });

            note.text = said;
            note.colour = colourOf(body.colour);
            note.tags = cleanTags(body.tags);
            note.editedAt = now;

            await writeBoard(grid.id, board);
            return res.status(200).json({ notes: board.notes });
        }

        if (body.action === 'delete-note') {
            const note = board.notes.find(one => one.id === body.id);
            if (!note) return res.status(404).json({ error: 'no-such-note' });
            if (!mine(note)) return res.status(403).json({ error: 'not-yours' });

            bin(board, 'note', note, board.notes.indexOf(note), me.id);
            board.notes = board.notes.filter(one => one.id !== note.id);
            await writeBoard(grid.id, board);
            return res.status(200).json({ notes: board.notes });
        }

        // Putting back what was just taken out, exactly as it was and where it
        // was. Only by whoever took it out, or by an admin: undo is for your
        // own slip of the hand, not for overruling somebody else's decision.
        if (body.action === 'undo-delete') {
            const gone = board.bin.find(one => one.item && one.item.id === body.id);
            if (!gone) return res.status(404).json({ error: 'nothing-to-undo' });
            if (gone.by !== me.id && me.role !== 'admin') return res.status(403).json({ error: 'not-yours' });

            const into = gone.kind === 'link' ? board.links : board.notes;
            if (into.some(one => one.id === gone.item.id)) return res.status(400).json({ error: 'nothing-to-undo' });

            into.splice(Math.max(0, Math.min(into.length, gone.index)), 0, gone.item);
            board.bin = board.bin.filter(one => one !== gone);

            await writeBoard(grid.id, board);
            return res.status(200).json({ links: board.links, notes: board.notes });
        }

        return res.status(400).json({ error: 'bad-action' });
    } catch (err) {
        const known = ['bad-link', 'empty-note', 'board-full', 'not-yours',
                       'no-such-link', 'no-such-note', 'bad-action', 'nothing-to-undo'];
        const status = known.includes(err.message) ? 400 : 500;
        return res.status(status).json({ error: err.message });
    }
};
