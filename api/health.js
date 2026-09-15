// GET -> what this deployment is actually connected to, and whether it works.
//
// Not a status page: it performs the round trip rather than reporting on one.
// It writes a few bytes to the image store, reads them back over the public
// url the grid would use, and deletes them again. If a picture will not upload,
// this says which of the three steps is the one that fails.
//
// Admin only, because it names the deployment's own plumbing.
const accounts = require('./_accounts');
const store = require('./_store');
const blob = require('./_blob');

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');

    const out = { checkedAt: new Date().toISOString(), database: {}, images: {} };

    // The database has to answer before anything else can be known, including
    // who is asking.
    let me = null;
    try {
        me = await accounts.currentUser(req);
        out.database.connected = true;
    } catch (err) {
        out.database.connected = false;
        out.database.error = err.message;
        return res.status(500).json(out);
    }

    if (!me) return res.status(401).json({ error: 'not-signed-in' });
    if (me.role !== 'admin') return res.status(403).json({ error: 'not-allowed' });

    try {
        out.database.answered = await store.command('PING');
        const doc = await accounts.readAccounts();
        out.database.accounts = doc.users.length;
        out.database.grids = doc.grids.length;
    } catch (err) {
        out.database.error = err.message;
    }

    const images = blob.client(req);
    out.images.credentials = images.how();
    out.images.tokenPresent = Boolean(out.images.credentials);

    // How much room the pictures are taking, and which grid is taking it. The
    // free allowance is a gigabyte, which a few hundred shrunk photographs do
    // not come close to, but the question is worth being able to answer.
    const GIGABYTE = 1024 * 1024 * 1024;
    const readable = (bytes) => bytes >= 1024 * 1024
        ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
        : `${Math.round(bytes / 1024)} KB`;

    if (out.images.tokenPresent) {
        try {
            const stored = await images.list('grids/');
            const doc = await accounts.readAccounts();

            const perGrid = {};
            stored.files.forEach(file => {
                const id = file.pathname.split('/')[1] || 'unknown';
                perGrid[id] = perGrid[id] || { files: 0, bytes: 0 };
                perGrid[id].files++;
                perGrid[id].bytes += file.size;
            });

            out.storage = {
                files: stored.files.length,
                size: readable(stored.bytes),
                ofFreeGigabyte: `${(stored.bytes / GIGABYTE * 100).toFixed(2)}%`,
                averagePicture: stored.files.length ? readable(stored.bytes / stored.files.length) : '0 KB',
                grids: Object.entries(perGrid).map(([id, use]) => {
                    const grid = accounts.findGrid(doc, id);
                    return { name: grid ? grid.name : id, files: use.files, size: readable(use.bytes) };
                }).sort((a, b) => b.files - a.files)
            };
        } catch (err) {
            out.storage = { error: err.message };
        }
    }

    if (out.images.tokenPresent) {
        let url = null;
        try {
            const put = await images.put(`health/${Date.now()}.txt`, Buffer.from('ok'), 'text/plain');
            url = put.url;
            out.images.uploaded = true;

            // The grid shows pictures with a plain img tag, so a store that
            // uploads but does not serve publicly would still leave every cell
            // empty. Worth knowing separately.
            const back = await fetch(url, { cache: 'no-store' });
            out.images.publiclyReadable = back.ok;
        } catch (err) {
            out.images.uploaded = out.images.uploaded || false;
            out.images.error = err.message;
        }

        if (url) {
            try { await images.del([url]); out.images.cleanedUp = true; }
            catch (err) { out.images.cleanedUp = false; out.images.cleanupError = err.message; }
        }
    }

    out.ok = Boolean(out.database.connected && out.images.tokenPresent
        && out.images.uploaded && out.images.publiclyReadable);

    return res.status(200).json(out);
};
