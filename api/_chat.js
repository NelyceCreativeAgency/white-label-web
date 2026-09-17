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

// What was said before this key was a list, if anything was.
const before = async (key) => {
    const doc = await store.readJson(exports.oldKey(key));
    return doc && Array.isArray(doc.messages) ? doc.messages : [];
};

exports.read = async (key) => (await before(key)).concat(await store.listRead(key));

// One command, and nothing read back first. Two people writing in the same
// second each get their own message on the end, which is the whole point of
// doing it this way.
exports.append = async (key, message) => {
    await store.listAdd(key, message, MAX_MESSAGES);
    return exports.read(key);
};

// Only for taking something out of the middle, which is rare enough to afford
// writing the list again. Anything left from before the list existed is folded
// into it at the same time, so a thread is rewritten into one shape the first
// time somebody deletes from it.
exports.write = async (key, messages) => {
    await store.listWrite(key, messages.slice(-MAX_MESSAGES));
    await store.deleteKey(exports.oldKey(key));
};

exports.newMessage = (me, said) => ({
    id: accounts.newId('msg'),
    userId: me.id,
    name: me.name || me.username,
    role: me.role,
    text: String(said).trim().slice(0, MAX_TEXT),
    at: new Date().toISOString()
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

// Who this account may talk to in private: the other people on the same grid.
// An admin is on no grid by design but may open every one of them, so an admin
// can write to anybody on the grid being looked at, and they to the admin.
exports.peopleOn = (doc, grid, me) => {
    const ids = Array.isArray(grid.memberIds) ? grid.memberIds : [];

    return doc.users.filter(user => {
        if (user.id === me.id) return false;
        if (ids.includes(user.id)) return true;
        // The admins, so that whoever is on the grid can reach the person who
        // runs it without being put on a grid with them.
        return user.role === 'admin';
    });
};
