// Who is at their screen right now.
//
// Being online is not a thing worth storing: it is a thing worth forgetting on
// its own. Each account gets a key that lives for a minute and a half and is
// written again every time the browser asks the server anything, so somebody
// who closes the tab goes quiet without anyone having to notice they did.
//
// It is kept out of the accounts document deliberately. That one is read and
// written whole, and a heartbeat every fifteen seconds from everybody would
// rewrite it all day for a fact that is stale by the time it lands.
const store = require('./_store');

const KEY = (userId) => `portal:online:${userId}`;

// Long enough to survive a slow poll and a tab that was hidden for a moment,
// short enough that somebody who shut the laptop is gone within two minutes.
const TTL = 100;

exports.touch = async (userId) => {
    try { await store.command('SET', KEY(userId), '1', 'EX', String(TTL)); }
    catch { /* a store that is down is not worth failing a page load over */ }
};

// The ids among these that are online, as a Set. A store that cannot answer
// says nobody is, which shows as a page with no green dots rather than an error.
exports.online = async (ids) => {
    if (!ids.length) return new Set();
    try {
        const values = await store.command('MGET', ...ids.map(KEY));
        const seen = Array.isArray(values) ? values : [];
        return new Set(ids.filter((id, i) => seen[i] !== null && seen[i] !== undefined));
    } catch {
        return new Set();
    }
};
