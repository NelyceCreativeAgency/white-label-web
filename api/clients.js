// A client, what they have been charged, and what is still running.
//
// The portal does not make invoices and must never look as though it does. An
// invoice comes out of the accounting software and lands in a cloud folder;
// what is kept here is a line saying it exists, what it was for, whether it has
// been paid, and where to download it. If this and the PDF ever disagree, the
// PDF is right.
//
// Who a client is lives with the accounts, because a name and a picture are
// wanted wherever a client is named. The money lives under a key of its own,
// one per client, because portal:accounts is read on every request and
// rewritten whole and a column of charges has no business in there.
//
// GET                   -> every client in short (admin), or your own in full
// GET    ?id=           -> one client in full, admin only
// POST   { kind, ... }  -> a client, a subscription, a charge, or a file
// PATCH  { kind, id }   -> changes one
// DELETE ?kind=&id=     -> removes one
//
// POST { kind: 'file', action: 'ask', id } is the one thing on this page that
// is not the admin's: a client asking for a link that has run out.
const accounts = require('./_accounts');
const store = require('./_store');
const blob = require('./_blob');
// What a client has been handed. It lives in a document of its own for the
// same reason the money does: it is asked for in one place and has nothing to
// do with the rest of what is kept about an account.
const files = require('./_files');
// What makes a subscription social media work, and therefore what decides
// whether this client has any business seeing a grid.
const social = require('./_social');
const feed = require('./_feed');

const MAX_CLIENTS = 300;
const MAX_SUBS    = 24;
const MAX_ENTRIES = 600;
const MAX_NAME    = 80;
const MAX_LINE    = 140;
const MAX_NOTE    = 2000;
// A million euro. Not a figure anybody types twice by accident.
const MAX_CENTS   = 100000000;

// How many months one turn of a subscription covers.
const CYCLES = { month: 1, quarter: 3, year: 12 };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const moneyKey = store.moneyKey;

const text = (value, max) => String(value == null ? '' : value).trim().slice(0, max);

const readBody = (req) =>
    typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

// Money is kept in whole cents. A hundred and fifty euro is 15000 and never
// 150.0, because a column of floats added up twice can give two answers.
const toCents = (value) => {
    const typed = String(value == null ? '' : value).trim();
    // A euro sign, a space or a Greek comma are all ways of writing the same
    // figure and are simply dropped. A minus is not: somebody who typed one
    // meant something by it, and quietly billing them the opposite is worse
    // than saying the box was not understood.
    if (typed.startsWith('-')) throw new Error('bad-amount');

    const said = typed.replace(',', '.').replace(/[^\d.]/g, '');
    const n = Number(said);
    if (!said || !Number.isFinite(n) || n < 0) throw new Error('bad-amount');
    const out = Math.round(n * 100);
    if (out > MAX_CENTS) throw new Error('bad-amount');
    return out;
};

// Somewhere a file can be fetched from. Only https: a MEGA link carries its own
// decryption key in the fragment, so it is a password as much as an address and
// has no business travelling in the clear.
const toLink = (value) => {
    const said = text(value, 600);
    if (!said) return '';
    if (!/^https:\/\/[^\s]+$/i.test(said)) throw new Error('bad-link');
    return said;
};

const toDay = (value, fallback = '') => {
    const said = text(value, 10);
    if (!said) return fallback;
    if (!DAY.test(said) || Number.isNaN(Date.parse(`${said}T00:00:00Z`))) throw new Error('bad-date');
    return said;
};

const today = () => new Date().toISOString().slice(0, 10);

// Dates are counted in UTC throughout. A period that runs to the end of
// September should say the thirtieth in Athens and in London alike, and the
// only way to be sure of that is never to involve a local clock.
const addMonths = (iso, months) => {
    const from = new Date(`${iso}T00:00:00Z`);
    const wanted = from.getUTCDate();
    const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + months, 1));
    const last = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
    start.setUTCDate(Math.min(wanted, last));
    return start.toISOString().slice(0, 10);
};

const shift = (iso, days) => {
    const at = new Date(`${iso}T00:00:00Z`);
    at.setUTCDate(at.getUTCDate() + days);
    return at.toISOString().slice(0, 10);
};

// --- what is kept -----------------------------------------------------------
const EMPTY_MONEY = () => ({ subs: [], entries: [], updatedAt: null });

const readMoney = async (clientId) => {
    const doc = await store.readJson(moneyKey(clientId));
    if (!doc) return EMPTY_MONEY();

    const money = {
        subs: Array.isArray(doc.subs) ? doc.subs : [],
        entries: Array.isArray(doc.entries) ? doc.entries : [],
        updatedAt: doc.updatedAt || null
    };

    // Rows written before a turn took its start from the day it was paid still
    // carry a start of their own. A row that disagrees with the rule is worse
    // than one that is merely old, so it is brought into line the first time
    // the document is read and written back once. After that nothing changes
    // and nothing is written.
    const mended = money.entries.filter(entry => {
        const was = `${entry.on}|${entry.to}`;
        settle(money, entry);
        return `${entry.on}|${entry.to}` !== was;
    });

    if (mended.length) await writeMoney(clientId, money);
    return money;
};

const writeMoney = async (clientId, doc) => {
    doc.updatedAt = new Date().toISOString();
    await store.writeJson(moneyKey(clientId), doc);
    return doc;
};

// --- what goes out ----------------------------------------------------------
// The account a client signs in with, and whose photograph is therefore the
// client's. Where two accounts belong to one client it is the first of them,
// because a card shows one face and somebody has to be it.
const faceUser = (doc, client) =>
    doc.users.find(user => user.clientId === client.id && user.role === 'client') || null;

// One rule, kept everywhere so that it can be remembered: a field called note
// is yours and never leaves for the client. Everything else on a charge is the
// charge itself, and they are entitled to read what they are being asked to pay.
//
// A client has no picture of its own. It wears its account's, read from where
// that lives, so that changing it from either side changes it in both and there
// is no second copy to fall out of step.
const clientOut = (client, mine, doc) => {
    const face = faceUser(doc, client);

    return {
        id: client.id,
        name: client.name,
        company: client.company || '',
        email: client.email || '',
        phone: client.phone || '',
        createdAt: client.createdAt || null,
        avatar: (face && face.avatar) || null,
        // Whose colour the standing-in letter takes, so the same person is the
        // same colour on this card as at the bottom of their own sidebar.
        faceOf: (face && face.id) || client.id,
        account: face ? { id: face.id, name: face.name } : null,
        ...(mine ? {} : { note: client.note || '' })
    };
};

const entryOut = (entry, mine) => ({
    id: entry.id,
    subId: entry.subId || null,
    title: entry.title,
    cents: entry.cents,
    on: entry.on,
    to: entry.to || null,
    status: entry.status,
    invoiceNo: entry.invoiceNo || '',
    invoiceUrl: entry.invoiceUrl || '',
    payUrl: entry.payUrl || '',
    paidAt: entry.paidAt || null,
    at: entry.at,
    ...(mine ? {} : { note: entry.note || '', by: entry.by || null })
});

// A subscription is the agreement. What it has actually covered is read off the
// charges that point at it, so the date it runs to and the months that have been
// paid can never disagree: they are the same fact asked twice.
const subOut = (sub, entries, mine) => {
    const ours = entries.filter(entry => entry.subId === sub.id);
    const ends = (want) => ours
        .filter(entry => entry.to && (!want || entry.status === want))
        .map(entry => entry.to)
        .sort()
        .pop() || null;

    return {
        id: sub.id,
        title: sub.title,
        cents: sub.cents,
        cycle: sub.cycle,
        payUrl: sub.payUrl || '',
        startedAt: sub.startedAt || null,
        endedAt: sub.endedAt || null,
        // How far its charges have carried it, which is not stored anywhere:
        // it is read off them, so it cannot say a month is covered that nobody
        // has paid for.
        paidUntil: ends('paid'),
        due: ours.filter(entry => entry.status === 'due').length,
        // Whether this one is social media work is a lever of yours, not
        // something the client is told about their own subscription.
        ...(mine ? {} : { note: sub.note || '', social: social.isSocial(sub) })
    };
};

const sumOf = (entries, status) => entries
    .filter(entry => entry.status === status)
    .reduce((total, entry) => total + entry.cents, 0);

const moneyOut = (money, mine) => ({
    subs: money.subs.map(sub => subOut(sub, money.entries, mine)),
    // Newest first: a ledger is read from the top, and the top is now.
    entries: money.entries.slice()
        .sort((a, b) => String(b.paidAt || b.on).localeCompare(String(a.paidAt || a.on))
                     || String(b.at).localeCompare(String(a.at)))
        .map(entry => entryOut(entry, mine)),
    owed: sumOf(money.entries, 'due'),
    // What they have paid you altogether is a figure for you. They can see
    // every invoice they have had, which is what they are entitled to; a
    // running total of years of them is a different thing to put in front of
    // somebody, and it is not sent rather than merely not drawn.
    ...(mine ? {} : { paid: sumOf(money.entries, 'paid') })
});

// --- making and changing ----------------------------------------------------
const createClient = (doc, body) => {
    if (doc.clients.length >= MAX_CLIENTS) throw new Error('too-many-clients');

    const name = text(body.name, MAX_NAME);
    if (!name) throw new Error('bad-name');

    const client = {
        id: accounts.newId('cli'),
        name,
        company: text(body.company, MAX_NAME),
        email: text(body.email, MAX_LINE),
        phone: text(body.phone, 40),
        note: '',
        createdAt: new Date().toISOString()
    };
    doc.clients.push(client);
    return client;
};

// Which accounts and which grids are this client's. Kept on the account and on
// the grid rather than as a list here, so there is one place to look and no
// chance of the two lists disagreeing about who belongs to whom.
const attach = (doc, client, field, wanted, canBelong) => {
    if (!Array.isArray(wanted)) return;
    const ours = new Set(wanted);

    doc[field].forEach(thing => {
        if (ours.has(thing.id) && canBelong(thing)) thing.clientId = client.id;
        else if (thing.clientId === client.id) thing.clientId = null;
    });
};

const patchClient = (doc, body) => {
    const client = doc.clients.find(one => one.id === body.id);
    if (!client) throw new Error('no-such-client');

    if (body.name !== undefined) {
        const name = text(body.name, MAX_NAME);
        if (!name) throw new Error('bad-name');
        client.name = name;
    }
    if (body.company !== undefined) client.company = text(body.company, MAX_NAME);
    if (body.email !== undefined) client.email = text(body.email, MAX_LINE);
    if (body.phone !== undefined) client.phone = text(body.phone, 40);
    if (body.note !== undefined) client.note = text(body.note, MAX_NOTE);

    attach(doc, client, 'users', body.userIds, (user) => user.role === 'client');
    attach(doc, client, 'grids', body.gridIds, () => true);

    if (body.avatar !== undefined) {
        const face = faceUser(doc, client);
        if (!face) throw new Error('no-account');
        if (body.avatar && !blob.isOurImage(body.avatar)) throw new Error('bad-image');
        face.avatar = body.avatar || null;
    }

    return client;
};

const createSub = (money, body) => {
    if (money.subs.length >= MAX_SUBS) throw new Error('too-many-subs');

    const title = text(body.title, MAX_NAME);
    if (!title) throw new Error('bad-name');

    const sub = {
        id: accounts.newId('sub'),
        title,
        cents: toCents(body.amount),
        cycle: CYCLES[body.cycle] ? body.cycle : 'month',
        // Most of what is sold here is social media work, so that is what a
        // new subscription is unless it is said otherwise.
        social: body.social === undefined ? true : Boolean(body.social),
        payUrl: toLink(body.payUrl),
        note: text(body.note, MAX_NOTE),
        startedAt: toDay(body.startedAt, today()),
        endedAt: null
    };
    money.subs.push(sub);
    return sub;
};

const patchSub = (money, body) => {
    const sub = money.subs.find(one => one.id === body.id);
    if (!sub) throw new Error('no-such-sub');

    if (body.title !== undefined) {
        const title = text(body.title, MAX_NAME);
        if (!title) throw new Error('bad-name');
        sub.title = title;
    }
    if (body.amount !== undefined) sub.cents = toCents(body.amount);
    if (body.cycle !== undefined && CYCLES[body.cycle]) sub.cycle = body.cycle;
    if (body.social !== undefined) sub.social = Boolean(body.social);
    if (body.payUrl !== undefined) sub.payUrl = toLink(body.payUrl);
    if (body.note !== undefined) sub.note = text(body.note, MAX_NOTE);
    if (body.startedAt !== undefined) sub.startedAt = toDay(body.startedAt, sub.startedAt);
    // Stopping a subscription leaves every charge it has already made alone.
    // What was invoiced was invoiced, whatever happens to the arrangement.
    if (body.ended !== undefined) sub.endedAt = body.ended ? (sub.endedAt || today()) : null;

    return sub;
};

// Where a turn of a subscription begins and ends. Neither is anybody's to type:
// it begins on the day it was paid for, because until then nothing is covered,
// and it runs one cycle of that subscription from there. Three facts that could
// disagree become one that cannot.
//
// A turn nobody has paid yet keeps whatever start it was given, because there
// is no payment for it to take one from and what it says is a plan. Its end
// still follows its start.
//
// A charge that belongs to no subscription covers no period at all.
const settle = (money, entry) => {
    if (!entry.subId) { entry.to = null; return; }

    if (entry.status === 'paid' && entry.paidAt) entry.on = entry.paidAt;

    const sub = money.subs.find(one => one.id === entry.subId);
    entry.to = shift(addMonths(entry.on, CYCLES[sub && sub.cycle] || 1), -1);
};

const madeBy = (me) => ({ at: new Date().toISOString(), by: me.id });

const createEntry = (money, body, me) => {
    if (money.entries.length >= MAX_ENTRIES) throw new Error('too-many-entries');

    const title = text(body.title, MAX_NAME);
    if (!title) throw new Error('bad-name');

    const subId = text(body.subId, 40) || null;
    if (subId && !money.subs.some(sub => sub.id === subId)) throw new Error('no-such-sub');

    const on = toDay(body.on, today());
    let to = toDay(body.to, '');

    // A charge put down against a subscription is a turn of it, so where nobody
    // has said how long it runs, it runs as long as that subscription's turns
    // do. This is what makes a line typed into the ledger light the months up.
    if (!to && subId) {
        const sub = money.subs.find(one => one.id === subId);
        to = shift(addMonths(on, CYCLES[sub.cycle] || 1), -1);
    }

    if (to && to < on) throw new Error('bad-date');

    const entry = {
        id: accounts.newId('chg'),
        subId,
        title,
        cents: toCents(body.amount),
        on,
        to: to || null,
        status: body.status === 'paid' ? 'paid' : 'due',
        invoiceNo: text(body.invoiceNo, 40),
        invoiceUrl: toLink(body.invoiceUrl),
        payUrl: toLink(body.payUrl),
        note: text(body.note, MAX_NOTE),
        // The day the money arrived, which is not today just because today is
        // when it was typed in. Unsaid, it is the day the charge is dated,
        // which is nearer the truth than the day somebody sat down to record it.
        paidAt: body.status === 'paid' ? toDay(body.paidAt, on) : null,
        ...madeBy(me)
    };

    settle(money, entry);
    if (entry.to && entry.to < entry.on) throw new Error('bad-date');

    money.entries.push(entry);
    return entry;
};

const patchEntry = (money, body) => {
    const entry = money.entries.find(one => one.id === body.id);
    if (!entry) throw new Error('no-such-entry');

    if (body.title !== undefined) {
        const title = text(body.title, MAX_NAME);
        if (!title) throw new Error('bad-name');
        entry.title = title;
    }
    if (body.amount !== undefined) entry.cents = toCents(body.amount);
    if (body.on !== undefined) entry.on = toDay(body.on, entry.on);
    if (body.to !== undefined) entry.to = toDay(body.to, '') || null;

    // Which subscription this is a turn of, if any. A charge that belongs to
    // none of them covers no period either: an invoice for a logo is dated, it
    // does not run until a date. This comes after the period above so that
    // detaching a charge clears it whatever else was sent alongside.
    if (body.subId !== undefined) {
        const wanted = text(body.subId, 40) || null;
        if (wanted && !money.subs.some(sub => sub.id === wanted)) throw new Error('no-such-sub');
        entry.subId = wanted;
        if (!wanted) entry.to = null;
    }

    if (body.status !== undefined) {
        const paid = body.status === 'paid';
        entry.status = paid ? 'paid' : 'due';
        if (!paid) entry.paidAt = null;
        else if (!entry.paidAt) entry.paidAt = entry.on;
    }

    // Set on its own, because nobody pays on the day they are invoiced and the
    // two dates have no business being the same field.
    if (body.paidAt !== undefined && entry.status === 'paid') {
        entry.paidAt = toDay(body.paidAt, entry.on);
    }

    settle(money, entry);
    if (entry.to && entry.to < entry.on) throw new Error('bad-date');

    if (body.invoiceNo !== undefined) entry.invoiceNo = text(body.invoiceNo, 40);
    if (body.invoiceUrl !== undefined) entry.invoiceUrl = toLink(body.invoiceUrl);
    if (body.payUrl !== undefined) entry.payUrl = toLink(body.payUrl);
    if (body.note !== undefined) entry.note = text(body.note, MAX_NOTE);

    return entry;
};

// --- the request ------------------------------------------------------------
const mineOnly = (doc, me) => {
    if (!me.clientId) return null;
    return doc.clients.find(one => one.id === me.clientId) || null;
};

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');

    try {
        const doc = await accounts.readAccounts();
        doc.clients = Array.isArray(doc.clients) ? doc.clients : [];

        const me = await accounts.currentUser(req, doc);
        if (!me) return res.status(401).json({ error: 'not-signed-in' });

        const boss = me.role === 'admin';

        // A client reads their own page and nothing else. A partner is here to
        // do the work, and what the work was charged for is not part of it.
        if (!boss && me.role !== 'client') return res.status(403).json({ error: 'not-allowed' });

        if (req.method === 'GET') {
            if (!boss) {
                const client = mineOnly(doc, me);
                if (!client) return res.status(200).json({ client: null });
                const money = await readMoney(client.id);
                return res.status(200).json({
                    client: clientOut(client, true, doc),
                    money: moneyOut(money, true),
                    files: files.listOut(await files.read(client.id), true)
                });
            }

            const wanted = text(req.query && req.query.id, 40);

            if (!wanted) {
                // The list, and with it what each client still owes. One read
                // per client, on a screen that is opened rather than polled, so
                // the sidebar can say which of them is waiting to pay.
                const monies = await Promise.all(doc.clients.map(one => readMoney(one.id)));
                return res.status(200).json({
                    clients: doc.clients.map((client, at) => ({
                        ...clientOut(client, false, doc),
                        owed: sumOf(monies[at].entries, 'due'),
                        subs: monies[at].subs.filter(sub => !sub.endedAt).length
                    }))
                });
            }

            const client = doc.clients.find(one => one.id === wanted);
            if (!client) return res.status(404).json({ error: 'no-such-client' });

            const money = await readMoney(client.id);
            return res.status(200).json({
                client: clientOut(client, false, doc),
                money: moneyOut(money, false),
                files: files.listOut(await files.read(client.id), false),
                // Whether their accounts can open a grid at all, said on the
                // page where the reason for it lives. Read off the same charges
                // the rest of this page is read off, so it cannot disagree with
                // what the sidebar does.
                seesGrids: await social.everPaid(client.id),
                // Everybody who could be put on this client, and every grid that
                // could belong to it, so the panel can offer them.
                people: doc.users
                    .filter(user => user.role === 'client')
                    .map(user => ({ ...accounts.publicUser(user), clientId: user.clientId || null })),
                grids: doc.grids
                    .map(grid => ({ id: grid.id, name: grid.name, icon: accounts.faceOf(grid),
                                    clientId: grid.clientId || null }))
            });
        }

        // Asking for an expired link back is not a change to what a client has.
        // It is a message, and the row it is about is where the message waits
        // until it is answered, so it is kept with the file rather than sent.
        if (!boss && req.method === 'POST') {
            const body = readBody(req);
            if (body.kind !== 'file' || body.action !== 'ask') {
                return res.status(403).json({ error: 'not-allowed' });
            }

            const client = mineOnly(doc, me);
            if (!client) return res.status(403).json({ error: 'not-allowed' });

            const kept = await files.read(client.id);
            const asked = files.ask(kept, text(body.id, 40), me);
            await files.write(client.id, kept);

            // Every admin, because there may be more than one of you and the
            // request is for whoever reads it first.
            await Promise.all(doc.users
                .filter(user => user.role === 'admin')
                .map(user => feed.push({
                    kind: 'file-ask',
                    actorId: me.id,
                    toId: user.id,
                    clientId: client.id,
                    text: feed.excerpt(asked.title)
                })));

            return res.status(200).json({ files: files.listOut(kept, true) });
        }

        if (!boss) return res.status(403).json({ error: 'not-allowed' });

        if (req.method === 'POST' || req.method === 'PATCH') {
            const body = readBody(req);

            if (body.kind === 'client') {
                const made = req.method === 'POST' ? createClient(doc, body) : patchClient(doc, body);
                await accounts.writeAccounts(doc);
                return res.status(200).json({ client: clientOut(made, false, doc) });
            }

            const clientId = text(body.clientId, 40);
            if (!doc.clients.some(one => one.id === clientId)) throw new Error('no-such-client');

            // Files are a document of their own, so they are answered before
            // the ledger is read: there is no reason to fetch a year of charges
            // in order to write down an address.
            if (body.kind === 'file') {
                const kept = await files.read(clientId);
                req.method === 'POST' ? files.add(kept, body) : files.change(kept, body);
                await files.write(clientId, kept);
                return res.status(200).json({ files: files.listOut(kept, false) });
            }

            const money = await readMoney(clientId);

            if (body.kind === 'sub') {
                req.method === 'POST' ? createSub(money, body) : patchSub(money, body);
            } else if (body.kind === 'entry') {
                req.method === 'POST' ? createEntry(money, body, me) : patchEntry(money, body);
            } else {
                throw new Error('bad-kind');
            }

            await writeMoney(clientId, money);
            return res.status(200).json({ money: moneyOut(money, false) });
        }

        if (req.method === 'DELETE') {
            const { kind, id, clientId } = req.query || {};

            if (kind === 'client') {
                const client = doc.clients.find(one => one.id === id);
                if (!client) return res.status(404).json({ error: 'no-such-client' });

                // The ledger goes with them. Nothing else does: the grids and
                // the accounts stay exactly where they are and simply stop
                // belonging to anybody, because deleting a client should never
                // be a way of deleting a year of work by accident.
                await store.deleteKey(moneyKey(client.id));
                await files.forget(client.id);
                doc.users.forEach(user => { if (user.clientId === client.id) user.clientId = null; });
                doc.grids.forEach(grid => { if (grid.clientId === client.id) grid.clientId = null; });
                doc.clients = doc.clients.filter(one => one.id !== client.id);

                await accounts.writeAccounts(doc);
                return res.status(200).json({ removed: client.id });
            }

            if (kind !== 'sub' && kind !== 'entry' && kind !== 'file') {
                return res.status(400).json({ error: 'bad-kind' });
            }
            if (!doc.clients.some(one => one.id === clientId)) {
                return res.status(404).json({ error: 'no-such-client' });
            }

            if (kind === 'file') {
                const kept = await files.read(clientId);
                if (!kept.files.some(one => one.id === id)) throw new Error('no-such-file');
                kept.files = kept.files.filter(one => one.id !== id);
                await files.write(clientId, kept);
                return res.status(200).json({ files: files.listOut(kept, false) });
            }

            const money = await readMoney(clientId);

            if (kind === 'sub') {
                if (!money.subs.some(one => one.id === id)) throw new Error('no-such-sub');
                money.subs = money.subs.filter(one => one.id !== id);
                // The charges it made stay, and stop pointing anywhere. They
                // were real invoices and the history has to keep adding up.
                money.entries.forEach(entry => { if (entry.subId === id) entry.subId = null; });
            } else {
                if (!money.entries.some(one => one.id === id)) throw new Error('no-such-entry');
                money.entries = money.entries.filter(one => one.id !== id);
            }

            await writeMoney(clientId, money);
            return res.status(200).json({ money: moneyOut(money, false) });
        }

        res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
        return res.status(405).json({ error: 'Method not allowed.' });
    } catch (err) {
        const known = ['bad-name', 'bad-amount', 'bad-link', 'bad-date', 'bad-kind', 'bad-image',
                       'no-such-client', 'no-such-sub', 'no-such-entry', 'no-such-file',
                       'no-account', 'not-expired',
                       'too-many-clients', 'too-many-subs', 'too-many-entries', 'too-many-files'];
        const status = known.includes(err.message) ? 400 : 500;
        return res.status(status).json({ error: err.message });
    }
};
