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

// --- whose move it is -------------------------------------------------------
// A request has three faces and they are not faces of the request: they are
// faces of the person looking at it. The same request, at the same moment, is
// waiting on Simos and answered for me. So nothing about a colour is stored;
// what is stored is what happened and when, and who has looked since.
//
//   lit     something happened that was not yours and you have not looked
//   quiet   you are up to date, and somebody else has the move
//   closed  whoever asked has said it is done
const at = (iso) => String(iso || '');

// The last thing anybody but this reader did to it — including the asking.
const movedBy = (ask, meId) => {
    const times = [];
    if (ask.by !== meId) times.push(at(ask.at));
    (ask.replies || []).forEach(one => { if (one.by !== meId) times.push(at(one.at)); });
    (ask.gotIt || []).forEach(one => { if (one.id !== meId) times.push(at(one.at)); });
    return times.sort().pop() || '';
};

exports.faceFor = (ask, meId) => {
    if (ask.closedAt) return 'closed';
    const moved = movedBy(ask, meId);
    const looked = at((ask.reads || {})[meId]);
    return moved && moved > looked ? 'lit' : 'quiet';
};

exports.out = (ask, doc, me) => ({
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
    at: ask.at,
    closedAt: ask.closedAt || null,
    replies: (ask.replies || []).map(one => ({
        id: one.id,
        by: one.by,
        byName: (() => {
            const user = accounts.findUser(doc, one.by);
            return user ? (user.name || user.username) : '';
        })(),
        text: one.text,
        at: one.at
    })),
    gotIt: (ask.gotIt || []).map(one => ({
        id: one.id,
        name: (() => {
            const user = accounts.findUser(doc, one.id);
            return user ? (user.name || user.username) : '';
        })(),
        at: one.at
    })),
    face: exports.faceFor(ask, me ? me.id : null),
    mine: Boolean(me) && ask.by === me.id
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
        at: new Date().toISOString(),
        replies: [],
        gotIt: [],
        reads: {},
        closedAt: null
    };

    // Newest first, because a list of requests is read from the top and the top
    // is what has just arrived.
    doc.asks.unshift(ask);
    return ask;
};

// Changing one after it has gone out. Only whoever asked, and only while it is
// still open — a finished request is a record, and a record that can be rewritten
// is not one.
//
// Who it was sent to is not up for changing. It decided who was told and who may
// read it, and moving it afterwards would take a request out from under somebody
// who has already been asked. Deleting it and asking again is the honest way.
exports.edit = (ask, body, blob) => {
    if (ask.closedAt) throw new Error('ask-closed');

    if (body.title !== undefined) {
        const title = text(body.title, MAX_TITLE);
        if (!title) throw new Error('bad-name');
        ask.title = title;
    }

    if (body.said !== undefined) ask.said = text(body.said, MAX_SAID);
    if (body.url !== undefined) ask.url = toLink(body.url);

    if (body.shots === undefined) return [];

    const was = Array.isArray(ask.shots) ? ask.shots : [];
    ask.shots = (Array.isArray(body.shots) ? body.shots : [])
        .slice(0, MAX_SHOTS)
        .filter(url => blob.isOurImage(url));

    // Whatever is no longer on it is no longer anybody's.
    return was.filter(url => !ask.shots.includes(url));
};

const MAX_REPLIES = 200;

// Answering one. Not a chat: a chat is for talking and this is for saying the
// one thing that was asked for, which is why it goes on the request itself and
// stays there with it.
exports.reply = (ask, body, me) => {
    if (ask.closedAt) throw new Error('ask-closed');
    if ((ask.replies || []).length >= MAX_REPLIES) throw new Error('too-many-replies');

    const said = text(body.text, MAX_SAID);
    if (!said) throw new Error('bad-name');

    const line = { id: accounts.newId('rep'), by: me.id, text: said, at: new Date().toISOString() };
    ask.replies = (ask.replies || []).concat(line);
    return line;
};

// Taking note of one that went to the room. Not an answer and not pretending to
// be: it says somebody has seen it and is not going to write anything, which is
// the honest end of most requests to everybody.
exports.got = (ask, me) => {
    if (ask.closedAt) throw new Error('ask-closed');
    if (ask.toId) throw new Error('not-allowed');
    if (ask.by === me.id) throw new Error('not-allowed');

    ask.gotIt = (ask.gotIt || []).filter(one => one.id !== me.id);
    ask.gotIt.push({ id: me.id, at: new Date().toISOString() });
};

// Having looked. Nothing to anybody else; it is what turns this reader's own
// copy of the request from lit back to quiet.
exports.looked = (ask, me) => {
    ask.reads = ask.reads || {};
    ask.reads[me.id] = new Date().toISOString();
};

// Done with, or not after all. Only whoever asked may say either: the person
// asked can answer, and answering is not the same as deciding it is finished.
//
// Closing takes the pictures with it. They were there to make the question
// clear and the question has been settled; keeping five images per request for
// ever, for a portal that has a few megabytes to its name, is a slow way of
// running out of room. Reopening starts from the words alone.
exports.shut = (ask, shut) => {
    if (!shut) {
        ask.closedAt = null;
        return [];
    }

    ask.closedAt = ask.closedAt || new Date().toISOString();
    const dropped = Array.isArray(ask.shots) ? ask.shots : [];
    ask.shots = [];
    return dropped;
};
