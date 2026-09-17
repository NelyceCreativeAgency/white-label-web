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

// The list, and the document it used to be. A key cannot change shape, so the
// list is named afresh and what was written before it is read from the old name
// and put behind everything newer. Nothing is migrated and nothing is lost.
const KEY = 'portal:events';
const WAS = 'portal:feed';

// Enough for the bell to have something to say after a quiet fortnight, and
// short enough that the document stays small.
const MAX_EVENTS = 150;

// A note is quoted in the bell, not reproduced there.
const EXCERPT = 90;

exports.read = async () => {
    const events = await store.listRead(KEY);

    const doc = await store.readJson(WAS);
    const older = doc && Array.isArray(doc.events) ? doc.events : [];

    // Newest first, both here and on the list, so what came before goes after.
    return events.concat(older).slice(0, MAX_EVENTS);
};

// Onto the front of the list, in one command. Two things happening in the same
// second used to lose one of them, because this read the whole list and wrote
// it back; now neither of them reads anything.
exports.push = async (event) => {
    try {
        await store.listAddFirst(
            KEY,
            { id: accounts.newId('evt'), at: new Date().toISOString(), ...event },
            MAX_EVENTS
        );
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
        // What a request for a file is about is a client, not a grid, and what
        // a request inside a project is about is the project.
        clientId: event.clientId || null,
        projectId: event.projectId || null,
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
