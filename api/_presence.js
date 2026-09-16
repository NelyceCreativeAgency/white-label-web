// When each account was last at its screen.
//
// One key per account, holding the moment its browser last asked this server
// anything. Every request that arrives with a session writes it, so working on
// a grid counts as being there just as much as having the bell poll in the
// background does.
//
// Whether that counts as online is decided when it is read, not when it is
// written: the same stamp answers both "is anybody there" and "when were they
// last", and a single key answers it.
//
// It is kept out of the accounts document deliberately. That one is read and
// written whole, and a heartbeat from everybody would rewrite all of it for a
// fact that is stale by the time it lands.
const store = require('./_store');

const KEY = (userId) => `portal:online:${userId}`;

// Being online means having the portal open somewhere, not having it in front
// of you, so the page goes on beating from behind another tab. A browser will
// not let a hidden tab keep to its own pace, though: it throttles those timers
// to about one a minute. This window is wide enough to forgive two missed
// beats and no wider, so somebody who closes the tab is gone inside of three
// minutes rather than lingering as a green dot all afternoon.
const HERE_MS = 150 * 1000;

// How long the stamp itself is worth keeping, so that "last seen" can still
// say something useful about somebody who has been gone a while.
const KEEP = 30 * 24 * 60 * 60;

exports.touch = async (userId) => {
    try { await store.command('SET', KEY(userId), new Date().toISOString(), 'EX', String(KEEP)); }
    catch { /* a store that is down is not worth failing a page load over */ }
};

// For each id, when it was last here and whether that is recent enough to call
// being here now. A store that cannot answer says nobody has ever been seen,
// which shows as a page of grey dots rather than as an error.
exports.of = async (ids) => {
    const out = {};
    ids.forEach(id => { out[id] = { online: false, seenAt: null }; });
    if (!ids.length) return out;

    let values = [];
    try { values = await store.command('MGET', ...ids.map(KEY)) || []; }
    catch { return out; }

    ids.forEach((id, i) => {
        const at = values[i];
        if (!at) return;
        const stamp = new Date(at).getTime();
        if (!Number.isFinite(stamp)) return;
        out[id] = { online: Date.now() - stamp < HERE_MS, seenAt: at };
    });

    return out;
};
