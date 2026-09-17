// Talking, in two clearly separate places.
//
// GET                          -> every conversation this account has, in two
//                                 lists: the projects it is on, and the people
//                                 it can write to
// GET  ?only=counts            -> the same without a word of any of them
// GET  ?grid=<id>              -> that project's thread
// GET  ?with=<user>            -> the private thread between you and that one
// POST { grid  , text }        -> say something to a project
// POST { with  , text }        -> say something to one person
// POST { ..., action }         -> 'seen' marks a conversation read, 'delete'
//                                 takes back one of your own messages
//
// A private thread is readable by exactly the two people in it and belongs to
// no project: the key it lives under is the two of them. An admin runs the
// portal and can open every grid, and still cannot read a thread they are not
// in, because there is no request here that returns one.
const accounts = require('./_accounts');
const chat = require('./_chat');
const feed = require('./_feed');
const presence = require('./_presence');
const read = require('./_read');

const readBody = (req) =>
    typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');

    try {
        const doc = await accounts.readAccounts();
        const me = await accounts.currentUser(req, doc);
        if (!me) return res.status(401).json({ error: 'not-signed-in' });

        await presence.touch(me.id);

        const query = req.query || {};
        const body = req.method === 'POST' ? readBody(req) : {};

        const withId = query.with || body.with || null;
        const gridId = query.grid || body.grid || null;

        // Which conversation this is about, if it is about one. Both of these
        // are the whole of the permission check: a thread nobody may open is a
        // thread that never gets a key.
        let other = null;
        let grid = null;

        if (withId) {
            other = chat.mayWriteTo(doc, me, withId);
            if (!other) return res.status(403).json({ error: 'not-on-project' });
        } else if (gridId) {
            grid = accounts.findGrid(doc, gridId);
            if (!grid || !accounts.canView(me, grid)) return res.status(404).json({ error: 'no-such-grid' });
        }

        const key = other ? chat.privateKey(me.id, other.id) : grid ? chat.projectKey(grid.id) : null;
        const mark = other ? chat.privateMark(me.id, other.id) : grid ? chat.projectMark(grid.id) : null;

        if (req.method === 'GET') {
            const seen = (await read.of(me)).chats;

            // --- one conversation ------------------------------------------
            if (key) {
                const messages = await chat.read(key);

                if (other) {
                    const here = await presence.of([other.id]);
                    return res.status(200).json({
                        kind: 'private',
                        withUser: {
                            id: other.id,
                            name: other.name || other.username,
                            role: other.role,
                            avatar: other.avatar || null,
                            ...here[other.id]
                        },
                        messages,
                        unread: chat.unreadIn(messages, me, seen[mark])
                    });
                }

                return res.status(200).json({
                    kind: 'project',
                    grid: { id: grid.id, name: grid.name, icon: accounts.faceOf(grid) },
                    messages,
                    unread: chat.unreadIn(messages, me, seen[mark])
                });
            }

            // --- all of them, as the list on the left ----------------------
            // The sidebar wants a number and a line, not a conversation, and
            // this is asked for often enough that the difference is the whole
            // cost of the feature.
            const teams = [];
            for (const one of accounts.gridsFor(doc, me)) {
                teams.push({
                    id: one.id,
                    name: one.name,
                    icon: accounts.faceOf(one),
                    ...await chat.glance(chat.projectKey(one.id), me, seen[chat.projectMark(one.id)])
                });
            }

            const others = chat.peopleFor(doc, me);
            const here = await presence.of(others.map(user => user.id));

            const people = [];
            for (const user of others) {
                people.push({
                    id: user.id,
                    name: user.name || user.username,
                    role: user.role,
                    avatar: user.avatar || null,
                    ...here[user.id],
                    ...await chat.glance(chat.privateKey(me.id, user.id), me, seen[chat.privateMark(me.id, user.id)])
                });
            }

            return res.status(200).json({ kind: 'all', teams, people, keepDays: chat.KEEP_DAYS });
        }

        if (req.method !== 'POST') {
            res.setHeader('Allow', 'GET, POST');
            return res.status(405).json({ error: 'Method not allowed.' });
        }

        if (!key) return res.status(400).json({ error: 'no-such-grid' });

        if (body.action === 'seen') {
            // Its own key, so catching up with a thread does not rewrite the
            // document that holds everybody's password.
            await read.markChat(me, mark);
            return res.status(200).json({ seen: mark });
        }

        if (body.action === 'delete') {
            const messages = await chat.read(key);
            const message = messages.find(one => one.id === body.id);
            if (!message) return res.status(404).json({ error: 'no-such-message' });

            // Your own words, and nobody else's. A private thread has no admin
            // in it to overrule that, and a project thread is a conversation
            // rather than something the portal answers for.
            if (message.userId !== me.id) return res.status(403).json({ error: 'not-yours' });

            const left = messages.filter(one => one.id !== message.id);
            await chat.write(key, left);
            return res.status(200).json({ messages: left });
        }

        const said = String(body.text == null ? '' : body.text).trim();
        if (!said) return res.status(400).json({ error: 'empty-message' });

        // An answer names what it is answering, and what it says about it is
        // copied from the thread rather than taken from the request: nobody
        // gets to put words in somebody else's message.
        const answering = body.replyTo
            ? chat.quote(await chat.read(key), String(body.replyTo))
            : null;

        const message = chat.newMessage(me, said, answering);
        await chat.append(key, message);
        const messages = await chat.read(key);

        // The bell. A private message is addressed, so only the person it was
        // written to is ever told about it, and it names no project because it
        // belongs to none.
        await feed.push({
            gridId: grid ? grid.id : null,
            gridName: grid ? grid.name : '',
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
