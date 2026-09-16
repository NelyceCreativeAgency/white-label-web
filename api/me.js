// Your own account, as far as you are allowed to change it.
//
// POST { avatar: <url> | null } -> { user }
//
// Which is: the picture on it, and nothing else. A name, a username and a role
// are what the admin decides in api/accounts.js, because they are how everybody
// else knows who you are. A face is yours.
const accounts = require('./_accounts');
const blob = require('./_blob');
const presence = require('./_presence');

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

        await presence.touch(me.id);

        const body = readBody(req);
        if (!('avatar' in body)) return res.status(400).json({ error: 'bad-action' });

        const was = me.avatar || null;

        if (body.avatar) {
            if (!blob.isOurImage(body.avatar)) return res.status(400).json({ error: 'bad-image' });
            me.avatar = String(body.avatar);
        } else {
            me.avatar = null;
        }

        await accounts.writeAccounts(doc);

        // The one it replaced is nobody's picture now. If the store cannot be
        // reached the account still has its new face: a stranded file costs
        // storage, while a failed save would cost the thing that was asked for.
        if (was && was !== me.avatar) {
            try { await blob.client(req).del([was]); } catch { /* litter, not a failure */ }
        }

        return res.status(200).json({ user: accounts.publicUser(me) });
    } catch (err) {
        const known = ['bad-image', 'bad-action'];
        const status = known.includes(err.message) ? 400 : 500;
        return res.status(status).json({ error: err.message });
    }
};
