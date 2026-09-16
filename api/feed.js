// The bell.
//
// GET                  -> { events, unread } for whoever is signed in
// POST { action: 'seen' } -> marks everything up to now as read
//
// An account is told about a grid it may open, and never about its own doing:
// a bell that lights up because you left a comment yourself is noise.
const accounts = require('./_accounts');
const feed = require('./_feed');
const presence = require('./_presence');

// The bell is a list of what happened lately, not an archive.
const SHOWN = 40;

const readBody = (req) =>
    typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');

    try {
        const doc = await accounts.readAccounts();
        const me = await accounts.currentUser(req, doc);
        if (!me) return res.status(401).json({ error: 'not-signed-in' });

        // Whoever is asking is at their screen. The bell is asked for once a
        // minute by every tab that is in front, which makes it the heartbeat
        // for somebody who is reading rather than typing.
        await presence.touch(me.id);

        if (req.method === 'GET') {
            const events = (await feed.read())
                .filter(event => {
                    if (event.actorId === me.id) return false;
                    // A private message is addressed. Everything else goes to
                    // whoever may open the grid it happened on.
                    if (event.toId) return event.toId === me.id;
                    const grid = accounts.findGrid(doc, event.gridId);
                    return Boolean(grid) && accounts.canView(me, grid);
                })
                .slice(0, SHOWN)
                .map(event => feed.dress(event, doc));

            // Anything newer than the last time the bell was opened. A brand
            // new account has seen nothing, and would otherwise open to forty
            // unread lines about work it was not there for.
            const since = me.seenAt || me.createdAt || null;
            const unread = since
                ? events.filter(event => event.at > since).length
                : events.length;

            return res.status(200).json({ events, unread });
        }

        if (req.method === 'POST') {
            if (readBody(req).action !== 'seen') return res.status(400).json({ error: 'bad-action' });

            const user = accounts.findUser(doc, me.id);
            user.seenAt = new Date().toISOString();
            await accounts.writeAccounts(doc);

            return res.status(200).json({ seenAt: user.seenAt });
        }

        res.setHeader('Allow', 'GET, POST');
        return res.status(405).json({ error: 'Method not allowed.' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};
