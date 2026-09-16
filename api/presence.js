// The heartbeat, and nothing else.
//
// POST -> 204, having written down that this account is still there
//
// The bell and the messages both stamp presence on their way past, but both of
// them stop being asked for when the tab goes behind another one, and a tab
// behind another one is still a tab somebody has open. This is the one request
// the page keeps making whether it is being looked at or not, so it is kept as
// small as a request can be.
const accounts = require('./_accounts');
const presence = require('./_presence');

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Method not allowed.' });
    }

    try {
        const me = await accounts.currentUser(req);
        if (!me) return res.status(401).json({ error: 'not-signed-in' });

        await presence.touch(me.id);
        return res.status(204).end();
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};
