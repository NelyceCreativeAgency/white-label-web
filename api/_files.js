// The files a client has been given, and how long the links to them live.
//
// A link to a cloud drive is not a file: it is a door to one, and a door left
// open for years is a door nobody is watching. So a link is a client's for
// twelve months from the day it was put here, and after that they see the name
// of the work and a button asking for it again, rather than an address that may
// or may not still open.
//
// Nothing is thrown away when a link expires. It stays here for the admin to
// read and hand out again, because the point of the expiry is that the client
// stops holding the address, not that you stop having it.
//
// One document per client, under a key of its own. What is kept here is not
// money and has a life of its own, so it does not belong in the ledger.
const store = require('./_store');
const accounts = require('./_accounts');

const key = (clientId) => `portal:files:${clientId}`;

const MAX_FILES = 200;
const MAX_NAME  = 80;
const MAX_LINK  = 600;

// How long a link is the client's. One number, in one place.
const MONTHS_LIVE = 12;

const text = (value, max) => String(value == null ? '' : value).trim().slice(0, max);

const today = () => new Date().toISOString().slice(0, 10);

// Counted in UTC, like every other date in the portal: a link handed out on the
// last day of February should die on the last day of the February after it, in
// Athens and in London alike.
const addMonths = (iso, months) => {
    const from = new Date(`${iso}T00:00:00Z`);
    const wanted = from.getUTCDate();
    const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + months, 1));
    const last = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
    start.setUTCDate(Math.min(wanted, last));
    return start.toISOString().slice(0, 10);
};

// Only https, and for the same reason an invoice link is: a drive link can
// carry its own key in the address, so it is a password as much as a place.
const toLink = (value) => {
    const said = text(value, MAX_LINK);
    if (!said) throw new Error('bad-link');
    if (!/^https:\/\/[^\s]+$/i.test(said)) throw new Error('bad-link');
    return said;
};

const EMPTY = () => ({ files: [], updatedAt: null });

const read = async (clientId) => {
    const doc = await store.readJson(key(clientId));
    if (!doc) return EMPTY();
    return { files: Array.isArray(doc.files) ? doc.files : [], updatedAt: doc.updatedAt || null };
};

const write = async (clientId, doc) => {
    doc.updatedAt = new Date().toISOString();
    await store.writeJson(key(clientId), doc);
    return doc;
};

exports.read = read;
exports.write = write;
exports.MONTHS_LIVE = MONTHS_LIVE;
exports.forget = async (clientId) => { await store.deleteKey(key(clientId)); };

exports.expiresOn = (file) => addMonths(file.givenAt, MONTHS_LIVE);

const expired = (file) => addMonths(file.givenAt, MONTHS_LIVE) < today();

// What one row looks like to whoever is reading it. The client is told the name
// of the work, when it was handed over, and whether the link is still theirs —
// and the address itself only while it is. An expired address is not sent to
// the browser at all rather than merely left undrawn, because a link that is
// in the page is a link somebody can find.
exports.fileOut = (file, mine) => ({
    id: file.id,
    title: file.title,
    givenAt: file.givenAt,
    expiresOn: addMonths(file.givenAt, MONTHS_LIVE),
    expired: expired(file),
    askedAt: file.askedAt || null,
    ...(expired(file) && mine ? {} : { url: file.url }),
    ...(mine ? {} : { askedBy: file.askedBy || null })
});

exports.listOut = (doc, mine) =>
    doc.files.slice()
        // Newest first, the way the ledger is read.
        .sort((a, b) => String(b.givenAt).localeCompare(String(a.givenAt))
                     || String(b.at).localeCompare(String(a.at)))
        .map(file => exports.fileOut(file, mine));

exports.add = (doc, body) => {
    if (doc.files.length >= MAX_FILES) throw new Error('too-many-files');

    const title = text(body.title, MAX_NAME);
    if (!title) throw new Error('bad-name');

    const file = {
        id: accounts.newId('fil'),
        title,
        url: toLink(body.url),
        // The twelve months run from the day you put it here, which is the day
        // the client could first have used it.
        givenAt: today(),
        askedAt: null,
        askedBy: null,
        at: new Date().toISOString()
    };
    doc.files.push(file);
    return file;
};

exports.change = (doc, body) => {
    const file = doc.files.find(one => one.id === body.id);
    if (!file) throw new Error('no-such-file');

    if (body.title !== undefined) {
        const title = text(body.title, MAX_NAME);
        if (!title) throw new Error('bad-name');
        file.title = title;
    }

    // Handing over an address again is handing it over: the twelve months start
    // from today, and whatever was being asked for has been answered.
    if (body.url !== undefined) {
        file.url = toLink(body.url);
        file.givenAt = today();
        file.askedAt = null;
        file.askedBy = null;
    }

    return file;
};

// A client asking for a link back. Nothing about the file changes except that
// it now says somebody is waiting, which is what the admin's bell is about to
// tell them anyway and what this page will keep saying if the bell is missed.
exports.ask = (doc, id, me) => {
    const file = doc.files.find(one => one.id === id);
    if (!file) throw new Error('no-such-file');
    if (!expired(file)) throw new Error('not-expired');

    file.askedAt = new Date().toISOString();
    file.askedBy = me.id;
    return file;
};
