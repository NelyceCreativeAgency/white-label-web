// The two kinds of conversation a project has.
//
// One is the project's own thread: everybody put on the grid reads it and
// writes in it. The other is a private one between two of those people, and
// nobody else, the admin included, ever reads it.
//
// They are kept apart at the lowest level there is, which is the key each one
// is stored under. A project thread and a private one can never be confused
// for each other because there is no document that holds both.
const store = require('./_store');
const accounts = require('./_accounts');

const MAX_TEXT = 2000;
const MAX_MESSAGES = 400;   // the oldest fall off the end

// How long a conversation keeps what was said in it, the project's and a
// private one alike. This is a place to work out loud about pictures, and a
// month is longer than anything said here is still about.
//
// It is also the answer to a question nobody asked out loud: a portal that kept
// every word forever would be holding years of other people's talk on somebody
// else's disk, for no reason anybody could give if asked.
const KEEP_DAYS = 30;

const past = (at) => {
    const when = new Date(at).getTime();
    return Number.isFinite(when) && Date.now() - when > KEEP_DAYS * 24 * 60 * 60 * 1000;
};

exports.KEEP_DAYS = KEEP_DAYS;

exports.MAX_TEXT = MAX_TEXT;

// A private thread is named by both people, in a fixed order, so that whoever
// opens it first is looking at the same list as the other one.
//
// Two names each. Conversations were one JSON document per thread before this,
// and a key in Redis cannot be a document one day and a list the next, so the
// list gets a name of its own and the old document is still read from. Nothing
// is migrated and nothing is thrown away: whatever was said back then simply
// comes first, and everything since is on the list.
exports.privateKey = (a, b) => `portal:dms:${[a, b].sort().join('__')}`;
exports.projectKey = (gridId) => `portal:talk:${gridId}`;

exports.oldKey = (key) => key.replace(/^portal:dms:/, 'portal:dm:').replace(/^portal:talk:/, 'portal:chat:');

// What the reader has and has not caught up with is kept per conversation, and
// this is the name it is kept under.
exports.privateMark = (a, b) => `dm:${[a, b].sort().join('__')}`;
exports.projectMark = (gridId) => `grid:${gridId}`;

// What was said before this key was a list, if anything was. Found once and
// folded into the list, so that a thread is one thing from then on.
const before = async (key) => {
    const doc = await store.readJson(exports.oldKey(key));
    const older = doc && Array.isArray(doc.messages) ? doc.messages : [];
    return older;
};

// Anything past its month goes on the way past. A thread is in order, so what
// is too old is a run at the front of it, and dropping that run is a count
// rather than a rewrite: nothing is read back, compared or written out again.
//
// Swept when it is read rather than on a timer. A conversation nobody opens is
// a conversation nobody is being shown anything out of, and the day somebody
// does open it is the day it matters that it is current.
exports.read = async (key) => {
    const older = await before(key);
    const list = await store.listRead(key);

    const keptOlder = older.filter(one => !past(one.at));
    if (keptOlder.length !== older.length) {
        if (keptOlder.length) await store.writeJson(exports.oldKey(key), { messages: keptOlder });
        else await store.deleteKey(exports.oldKey(key));
    }

    const from = list.findIndex(one => !past(one.at));

    if (from < 0 && list.length) { await store.deleteKey(key); return keptOlder; }
    if (from > 0) await store.listTrim(key, from);

    return keptOlder.concat(from < 0 ? [] : list.slice(from));
};

// One command, and nothing read back first. Two people writing in the same
// second each get their own message on the end, which is the whole point of
// doing it this way.
exports.append = async (key, message) => {
    await store.listAdd(key, message, MAX_MESSAGES);
};

// --- a glance rather than a reading -----------------------------------------
// The line beside somebody's name and the number next to it: what was said last
// and how much of it has not been read. Neither needs the conversation, and
// reading the whole of one to work them out was most of what this portal asked
// its store for. Five people on a project meant five conversations read from
// end to end, four times a minute, to draw five lines of text.
//
// The end of a list is where both answers are. Anybody with more than this many
// unread has more than a number's worth, and is told so rather than counted.
const GLANCE = 60;

exports.glance = async (key, me, since) => {
    let tail = await store.listTail(key, GLANCE);

    // A conversation that has not been written in since it was a document is
    // still a conversation, and this is the only time it is read for.
    if (!tail.length) tail = (await before(key)).slice(-GLANCE);

    const unread = exports.unreadIn(tail, me, since);

    return {
        last: exports.tail(tail),
        unread,
        // Every one of them unread means there may be more behind them.
        more: unread >= GLANCE
    };
};

// Only for taking something out of the middle, which is rare enough to afford
// writing the list again. Anything left from before the list existed is folded
// into it at the same time, so a thread is rewritten into one shape the first
// time somebody deletes from it.
exports.write = async (key, messages) => {
    await store.listWrite(key, messages.slice(-MAX_MESSAGES));
    await store.deleteKey(exports.oldKey(key));
};

// What is quoted above an answer. The words are copied rather than pointed at,
// so an answer still says what it was answering after the original has been
// taken back or fallen off the end of its month.
const QUOTE = 120;

exports.quote = (messages, id) => {
    const said = messages.find(one => one.id === id);
    if (!said) return null;

    const text = String(said.text || '').replace(/\s+/g, ' ').trim();

    return {
        id: said.id,
        name: said.name,
        text: text.length > QUOTE ? `${text.slice(0, QUOTE - 1)}…` : text
    };
};

exports.newMessage = (me, said, answering) => ({
    id: accounts.newId('msg'),
    userId: me.id,
    name: me.name || me.username,
    role: me.role,
    text: String(said).trim().slice(0, MAX_TEXT),
    at: new Date().toISOString(),
    replyTo: answering || null
});

// Anything newer than the last time this account opened that conversation, and
// never its own: you have read what you wrote.
exports.unreadIn = (messages, me, since) => messages.reduce((count, message) => {
    if (message.userId === me.id) return count;
    if (since && message.at <= since) return count;
    return count + 1;
}, 0);

// The last thing said, for the line under a name in the list.
exports.tail = (messages) => {
    const last = messages[messages.length - 1];
    if (!last) return null;
    return { at: last.at, text: last.text, userId: last.userId, name: last.name };
};

// Who this account may talk to in private: everybody it shares any grid with,
// and the admins.
//
// Not per grid. A private conversation is between two people and has never had
// a project in it: the key it lives under is the two of them and nothing else.
// Reaching it through a project meant somebody on four of them had to remember
// which one they had been standing in when they last wrote to a person, which
// is a question about this portal's plumbing rather than about anything they
// were doing.
exports.peopleFor = (doc, me) => {
    const shared = new Set();

    doc.grids.forEach(grid => {
        if (!accounts.canView(me, grid)) return;
        (Array.isArray(grid.memberIds) ? grid.memberIds : []).forEach(id => shared.add(id));
    });

    return doc.users.filter(user => {
        if (user.id === me.id) return false;
        if (shared.has(user.id)) return true;
        // The admins, so that anybody working here can reach whoever runs it
        // without having to be put on a grid alongside them.
        return user.role === 'admin';
    });
};

exports.mayWriteTo = (doc, me, id) => exports.peopleFor(doc, me).find(user => user.id === id) || null;
