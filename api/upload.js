// POST { grid, type, data }                    -> { url }
// POST { kind: 'me', type, data }              -> { url }, a picture of yourself
// POST { kind: 'client', client, type, data }  -> { url }, the square a client is known by
//
// One picture at a time. The browser has already shrunk it before it gets here
// (see js/portal-app.js): what arrives is a screen-sized JPEG, base64 in a JSON
// body, which is why this needs no multipart parsing and no npm package.
//
// Only someone who may edit the grid may add a picture to it, and the url that
// comes back is the only place a post is ever allowed to point at.
const accounts = require('./_accounts');
const blob = require('./_blob');

const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// Vercel gives a function about four and a half megabytes of request body, and
// base64 costs a third on top of the bytes it carries. Four is the most that
// can arrive without the platform cutting the request off first.
const MAX_BYTES = 4 * 1024 * 1024;

const readBody = (req) =>
    typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Method not allowed.' });
    }

    try {
        const doc = await accounts.readAccounts();
        const me = await accounts.currentUser(req, doc);
        if (!me) return res.status(401).json({ error: 'not-signed-in' });

        const body = readBody(req);

        // Three things a picture can belong to, and each one decides for itself
        // who may add to it. The folder it lands in is decided here too, so a
        // request can never talk its way into somebody else's.
        const kind = body.kind === 'me' ? 'me' : body.kind === 'client' ? 'client' : 'grid';
        let holds;

        if (kind === 'me') {
            // A picture of yourself hangs off no grid: everybody has one
            // account and may put a face on it, client and partner alike.
            holds = `people/${me.id}`;
        } else if (kind === 'client') {
            // The square a client is known by, which only the admin sets.
            if (me.role !== 'admin') return res.status(403).json({ error: 'not-allowed' });
            const client = doc.clients.find(one => one.id === body.client);
            if (!client) return res.status(404).json({ error: 'no-such-client' });
            holds = `clients/${client.id}`;
        } else {
            const grid = accounts.findGrid(doc, body.grid);
            if (!grid || !accounts.canView(me, grid)) return res.status(404).json({ error: 'no-such-grid' });
            if (!accounts.canEdit(me, grid)) return res.status(403).json({ error: 'not-allowed' });
            holds = `grids/${grid.id}`;
        }

        const type = String(body.type || '');
        const extension = TYPES[type];
        if (!extension) return res.status(400).json({ error: 'bad-type' });

        // Anything that is not base64 decodes to something shorter than it
        // claims to be, so the length check below catches a malformed body too.
        const data = String(body.data || '').split(',').pop();
        const bytes = Buffer.from(data, 'base64');
        if (!bytes.length) return res.status(400).json({ error: 'empty-image' });
        if (bytes.length > MAX_BYTES) return res.status(413).json({ error: 'too-large' });

        const { url } = await blob.client(req).put(`${holds}/${Date.now()}.${extension}`, bytes, type);
        return res.status(200).json({ url });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};
