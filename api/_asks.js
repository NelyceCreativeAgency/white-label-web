// What one person asks another inside a project, and what came back.
//
// A request is not a message. A message is said once and scrolls away; a
// request waits, and the whole point of it is that you can tell at a glance
// whether it is still waiting. So it is kept — one document per project, the
// requests in it newest first — rather than pushed onto a conversation.
//
// Who may read one is decided by who it was sent to. A request to everybody is
// the room's; a request to one person is between the two of them and nobody
// else's business, the admin included. That is deliberate: a room where every
// private word is read by whoever runs the place is a room people stop using.
const store = require('./_store');
const accounts = require('./_accounts');

const key = (projectId) => `portal:asks:${projectId}`;

const MAX_ASKS  = 400;
const MAX_TITLE = 120;
const MAX_SAID  = 4000;
const MAX_LINK  = 600;
// Enough to show what you mean without turning a request into an album.
const MAX_SHOTS = 5;

const text = (value, max) => String(value == null ? '' : value).trim().slice(0, max);

// Only https, for the same reason every other address here is: a sharing link
// can carry its own key inside it, which makes it a password as much as a place.
const toLink = (value) => {
    const said = text(value, MAX_LINK);
    if (!said) return '';
    if (!/^https:\/\/[^\s]+$/i.test(said)) throw new Error('bad-link');
    return said;
};

const EMPTY = () => ({ asks: [], updatedAt: null });

exports.read = async (projectId) => {
    const doc = await store.readJson(key(projectId));
    if (!doc) return EMPTY();
    return { asks: Array.isArray(doc.asks) ? doc.asks : [], updatedAt: doc.updatedAt || null };
};

exports.write = async (projectId, doc) => {
    doc.updatedAt = new Date().toISOString();
    await store.writeJson(key(projectId), doc);
    return doc;
};

exports.forget = async (projectId) => { await store.deleteKey(key(projectId)); };

// A request addressed to one person is theirs and the sender's. One addressed
// to nobody in particular is addressed to the room.
exports.mayRead = (ask, user) =>
    !ask.toId || ask.toId === user.id || ask.by === user.id;

exports.mine = (ask, user) => ask.by === user.id;

exports.out = (ask, doc) => ({
    id: ask.id,
    by: ask.by,
    byName: (() => {
        const user = accounts.findUser(doc, ask.by);
        return user ? (user.name || user.username) : '';
    })(),
    toId: ask.toId || null,
    toName: (() => {
        if (!ask.toId) return '';
        const user = accounts.findUser(doc, ask.toId);
        return user ? (user.name || user.username) : '';
    })(),
    title: ask.title,
    said: ask.said || '',
    url: ask.url || '',
    shots: Array.isArray(ask.shots) ? ask.shots : [],
    at: ask.at
});

exports.add = (doc, body, me, project, blob) => {
    if (doc.asks.length >= MAX_ASKS) throw new Error('too-many-asks');

    const title = text(body.title, MAX_TITLE);
    if (!title) throw new Error('bad-name');

    // Addressed to somebody on this project, or to the room. Somebody who is
    // not on it cannot be asked anything here.
    const toId = text(body.toId, 40);
    if (toId && !(project.memberIds || []).includes(toId)) throw new Error('not-a-member');

    const shots = (Array.isArray(body.shots) ? body.shots : [])
        .slice(0, MAX_SHOTS)
        .filter(url => blob.isOurImage(url));

    const ask = {
        id: accounts.newId('ask'),
        by: me.id,
        toId: toId || null,
        title,
        said: text(body.said, MAX_SAID),
        url: toLink(body.url),
        shots,
        at: new Date().toISOString()
    };

    // Newest first, because a list of requests is read from the top and the top
    // is what has just arrived.
    doc.asks.unshift(ask);
    return ask;
};
