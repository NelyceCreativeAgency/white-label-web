// What happened lately, so that everybody on a grid finds out about it.
//
// One document holds the last few dozen things anyone did, newest first, and
// every account reads the same one. Who is allowed to see which of them is
// decided when it is read, not when it is written: an event names the grid it
// belongs to, and api/feed.js hands back only the grids the reader may open.
//
// A per-grid document would mean one read per grid to fill the bell, and a
// per-account one would mean writing the same event as many times as there are
// people on the grid. One list, read once, filtered on the way out.
const store = require('./_store');
const accounts = require('./_accounts');

const KEY = 'portal:feed';

// Enough for the bell to have something to say after a quiet fortnight, and
// short enough that the document stays small.
const MAX_EVENTS = 150;

// A note is quoted in the bell, not reproduced there.
const EXCERPT = 90;

exports.read = async () => {
    const doc = await store.readJson(KEY);
    return doc && Array.isArray(doc.events) ? doc.events : [];
};

// Two things happening in the same second can lose one of them, because this
// reads the list and writes it back. With a handful of people on a grid that
// is a missed line in a bell, and it is not worth a lock.
exports.push = async (event) => {
    try {
        const events = await exports.read();
        events.unshift({ id: accounts.newId('evt'), at: new Date().toISOString(), ...event });
        if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
        await store.writeJson(KEY, { events });
    } catch {
        // An event that cannot be written is a line missing from a bell. The
        // thing it was about has already happened and been saved.
    }
};

exports.excerpt = (said) => {
    const clean = String(said || '').replace(/\s+/g, ' ').trim();
    return clean.length > EXCERPT ? `${clean.slice(0, EXCERPT - 1)}…` : clean;
};

// Everything the bell needs about one event, with the names looked up now
// rather than trusted from when it was written: somebody renamed since is
// shown under the name they go by today.
exports.dress = (event, doc) => {
    const grid = accounts.findGrid(doc, event.gridId);
    const actor = accounts.findUser(doc, event.actorId);

    return {
        id: event.id,
        at: event.at,
        kind: event.kind,
        gridId: event.gridId,
        gridName: grid ? grid.name : event.gridName || '',
        actorName: actor ? (actor.name || actor.username) : event.actorName || '',
        actorRole: actor ? actor.role : event.actorRole || 'client',
        actorId: event.actorId || null,
        slot: typeof event.slot === 'number' ? event.slot : null,
        postId: event.postId || null,
        image: event.image || null,
        text: event.text || ''
    };
};
