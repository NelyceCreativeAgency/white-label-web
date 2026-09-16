// Talking, in two clearly separate places.
//
// GET  ?grid=<id>              -> the project thread, and who you can write to
// GET  ?grid=<id>&with=<user>  -> the private thread between you and that one
// POST { grid, with?, text }   -> say something
// POST { grid, with?, action } -> 'seen' marks a conversation read, 'delete'
//                                 takes back one of your own messages
//
// A private thread is readable by exactly the two people in it. An admin runs
// the portal and can open every grid, but not somebody else's private thread:
// there is no request here that returns one they are not in.
const accounts = require('./_accounts');
const chat = require('./_chat');
const feed = require('./_feed');
const presence = require('./_presence');

const readBody = (req) =>
    typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

const marks = (user) => (user.chatSeen && typeof user.chatSeen === 'object') ? user.chatSeen : {};

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

        // Who the other side is, when there is one. Anyone not on this grid is
        // not somebody this account can open a private thread with.
        const otherId = (req.query && req.query.with) || body.with || null;
        const other = otherId
            ? chat.peopleOn(doc, grid, me).find(user => user.id === otherId)
            : null;
        if (otherId && !other) return res.status(403).json({ error: 'not-on-project' });

        const key = other ? chat.privateKey(me.id, other.id) : chat.projectKey(grid.id);
        const mark = other ? chat.privateMark(me.id, other.id) : chat.projectMark(grid.id);

        await presence.touch(me.id);

        if (req.method === 'GET') {
            const messages = await chat.read(key);
            const seen = marks(me);

            // A named thread is asked for on its own. The list that goes beside
            // it is only worth building when no thread was named.
            if (other) {
                const here = await presence.of([other.id]);
                return res.status(200).json({
                    kind: 'private',
                    withUser: {
                        id: other.id,
                        name: other.name || other.username,
                        role: other.role,
                        ...here[other.id]
                    },
                    messages
                });
            }

            const others = chat.peopleOn(doc, grid, me);
            const here = await presence.of(others.map(user => user.id));

            const people = [];
            for (const user of others) {
                const theirs = await chat.read(chat.privateKey(me.id, user.id));
                people.push({
                    id: user.id,
                    name: user.name || user.username,
                    role: user.role,
                    ...here[user.id],
                    unread: chat.unreadIn(theirs, me, seen[chat.privateMark(me.id, user.id)]),
                    last: chat.tail(theirs)
                });
            }

            return res.status(200).json({
                kind: 'project',
                grid: { id: grid.id, name: grid.name },
                messages,
                unread: chat.unreadIn(messages, me, seen[mark]),
                last: chat.tail(messages),
                people,
                // Everybody else on the project who is at their screen. You are
                // not counted: you can see that you are here.
                onlineCount: others.filter(user => here[user.id].online).length
            });
        }

        if (req.method !== 'POST') {
            res.setHeader('Allow', 'GET, POST');
            return res.status(405).json({ error: 'Method not allowed.' });
        }

        if (body.action === 'seen') {
            const user = accounts.findUser(doc, me.id);
            user.chatSeen = { ...marks(user), [mark]: new Date().toISOString() };
            await accounts.writeAccounts(doc);
            return res.status(200).json({ seen: mark });
        }

        if (body.action === 'delete') {
            const messages = await chat.read(key);
            const message = messages.find(one => one.id === body.id);
            if (!message) return res.status(404).json({ error: 'no-such-message' });

            // Your own words, and nobody else's. A private thread has no admin
            // in it to overrule that, and the project thread is a conversation
            // rather than something the portal answers for.
            if (message.userId !== me.id) return res.status(403).json({ error: 'not-yours' });

            const left = messages.filter(one => one.id !== message.id);
            await chat.write(key, left);
            return res.status(200).json({ messages: left });
        }

        const said = String(body.text == null ? '' : body.text).trim();
        if (!said) return res.status(400).json({ error: 'empty-message' });

        const message = chat.newMessage(me, said);
        const messages = await chat.append(key, message);

        // The bell. A private message is addressed, so only the person it was
        // written to is ever told about it.
        await feed.push({
            gridId: grid.id, gridName: grid.name,
            actorId: me.id, actorName: me.name || me.username, actorRole: me.role,
            kind: other ? 'dm' : 'chat',
            toId: other ? other.id : null,
            text: feed.excerpt(said)
        });

        return res.status(200).json({ message, messages });
    } catch (err) {
        const known = ['empty-message', 'not-yours', 'not-on-project'];
        const status = known.includes(err.message) ? 400 : 500;
        return res.status(status).json({ error: err.message });
    }
};
