// How far each account has read, kept where it belongs: with the account, and
// nowhere near the document that holds every account.
//
// This used to live on the user record inside portal:accounts, which meant that
// opening a conversation rewrote the document that holds everybody's password,
// role and grid membership. Every account did that every time it caught up with
// a thread, and a save from the admin landing in the same second as one of them
// lost whichever arrived first, silently. A read marker is the least important
// thing in the store and it was being written on the most important key there
// is.
//
// One key per account now. Two of somebody's own tabs can still collide, and
// the worst that costs is a marker that has to be set again.
const store = require('./_store');

const KEY = (userId) => `portal:read:${userId}`;

// Somebody on forty projects with a private thread on each is eighty entries.
// A few hundred is room enough and a ceiling all the same.
const MAX_MARKS = 400;

// The account record is still read for what was written there before this key
// existed. Nothing is migrated: the old value simply answers until a new one is
// written over it, which happens the first time anybody opens anything.
exports.of = async (user) => {
    let doc = null;
    try { doc = await store.readJson(KEY(user.id)); }
    catch { /* a store that cannot answer means nothing has been read */ }

    return {
        bell: (doc && doc.bell) || user.seenAt || null,
        chats: (doc && doc.chats) || (user.chatSeen && typeof user.chatSeen === 'object' ? user.chatSeen : {})
    };
};

const put = async (user, doc) => {
    try { await store.writeJson(KEY(user.id), doc); }
    catch { /* it will be marked again on the next opening */ }
};

exports.markBell = async (user) => {
    const now = new Date().toISOString();
    const was = await exports.of(user);
    await put(user, { ...was, bell: now });
    return now;
};

exports.markChat = async (user, mark) => {
    const now = new Date().toISOString();
    const was = await exports.of(user);

    const chats = { ...was.chats, [mark]: now };

    // Oldest out first, by the time they were last set.
    const names = Object.keys(chats);
    if (names.length > MAX_MARKS) {
        names.sort((a, b) => String(chats[a]).localeCompare(String(chats[b])));
        names.slice(0, names.length - MAX_MARKS).forEach(name => { delete chats[name]; });
    }

    await put(user, { ...was, chats });
    return now;
};
