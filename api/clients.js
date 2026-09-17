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
// POST   { kind, ... }  -> a client, a subscription, a charge, or a renewal
// PATCH  { kind, id }   -> changes one
// DELETE ?kind=&id=     -> removes one
const accounts = require('./_accounts');
const store = require('./_store');
const blob = require('./_blob');

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

const moneyKey = (clientId) => `portal:money:${clientId}`;

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
    return {
        subs: Array.isArray(doc.subs) ? doc.subs : [],
        entries: Array.isArray(doc.entries) ? doc.entries : [],
        updatedAt: doc.updatedAt || null
    };
};

const writeMoney = async (clientId, doc) => {
    doc.updatedAt = new Date().toISOString();
    await store.writeJson(moneyKey(clientId), doc);
    return doc;
};

// --- what goes out ----------------------------------------------------------
// One rule, kept everywhere so that it can be remembered: a field called note
// is yours and never leaves for the client. Everything else on a charge is the
// charge itself, and they are entitled to read what they are being asked to pay.
const clientOut = (client, mine) => ({
    id: client.id,
    name: client.name,
    company: client.company || '',
    email: client.email || '',
    phone: client.phone || '',
    icon: client.icon || null,
    createdAt: client.createdAt || null,
    ...(mine ? {} : { note: client.note || '' })
});

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
        // Paid up to here, and booked up to here. The second is where the next
        // turn starts, so renewing twice in a row does not bill September twice.
        paidUntil: ends('paid'),
        coveredUntil: ends(null),
        due: ours.filter(entry => entry.status === 'due').length,
        ...(mine ? {} : { note: sub.note || '' })
    };
};

const sumOf = (entries, status) => entries
    .filter(entry => entry.status === status)
    .reduce((total, entry) => total + entry.cents, 0);

const moneyOut = (money, mine) => ({
    subs: money.subs.map(sub => subOut(sub, money.entries, mine)),
    // Newest first: a ledger is read from the top, and the top is now.
    entries: money.entries.slice()
        .sort((a, b) => String(b.on).localeCompare(String(a.on)) || String(b.at).localeCompare(String(a.at)))
        .map(entry => entryOut(entry, mine)),
    owed: sumOf(money.entries, 'due'),
    paid: sumOf(money.entries, 'paid')
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
        icon: null,
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

    if (body.icon !== undefined) {
        if (body.icon && !blob.isOurImage(body.icon)) throw new Error('bad-image');
        client.icon = body.icon || null;
    }

    attach(doc, client, 'users', body.userIds, (user) => user.role === 'client');
    attach(doc, client, 'grids', body.gridIds, () => true);

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
    if (body.payUrl !== undefined) sub.payUrl = toLink(body.payUrl);
    if (body.note !== undefined) sub.note = text(body.note, MAX_NOTE);
    if (body.startedAt !== undefined) sub.startedAt = toDay(body.startedAt, sub.startedAt);
    // Stopping a subscription leaves every charge it has already made alone.
    // What was invoiced was invoiced, whatever happens to the arrangement.
    if (body.ended !== undefined) sub.endedAt = body.ended ? (sub.endedAt || today()) : null;

    return sub;
};

const madeBy = (me) => ({ at: new Date().toISOString(), by: me.id });

const createEntry = (money, body, me) => {
    if (money.entries.length >= MAX_ENTRIES) throw new Error('too-many-entries');

    const title = text(body.title, MAX_NAME);
    if (!title) throw new Error('bad-name');

    const subId = text(body.subId, 40) || null;
    if (subId && !money.subs.some(sub => sub.id === subId)) throw new Error('no-such-sub');

    const on = toDay(body.on, today());
    const to = toDay(body.to, '');
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
        paidAt: body.status === 'paid' ? today() : null,
        ...madeBy(me)
    };
    money.entries.push(entry);
    return entry;
};

// The next turn of a subscription, worked out here rather than in the browser so
// that a renewal is one button and lands on the day after the last one ended.
const renew = (money, body, me) => {
    const sub = money.subs.find(one => one.id === body.subId);
    if (!sub) throw new Error('no-such-sub');

    const covered = subOut(sub, money.entries, false).coveredUntil;
    const on = toDay(body.on, covered ? shift(covered, 1) : (sub.startedAt || today()));
    const to = shift(addMonths(on, CYCLES[sub.cycle] || 1), -1);

    return createEntry(money, {
        subId: sub.id,
        title: sub.title,
        amount: sub.cents / 100,
        on,
        to,
        status: 'due',
        payUrl: sub.payUrl
    }, me);
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
    if (entry.to && entry.to < entry.on) throw new Error('bad-date');

    if (body.status !== undefined) {
        const paid = body.status === 'paid';
        entry.status = paid ? 'paid' : 'due';
        entry.paidAt = paid ? (entry.paidAt || toDay(body.paidAt, today())) : null;
    }

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
                    client: clientOut(client, true),
                    money: moneyOut(money, true)
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
                        ...clientOut(client, false),
                        owed: sumOf(monies[at].entries, 'due'),
                        subs: monies[at].subs.filter(sub => !sub.endedAt).length
                    }))
                });
            }

            const client = doc.clients.find(one => one.id === wanted);
            if (!client) return res.status(404).json({ error: 'no-such-client' });

            const money = await readMoney(client.id);
            return res.status(200).json({
                client: clientOut(client, false),
                money: moneyOut(money, false),
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

        if (!boss) return res.status(403).json({ error: 'not-allowed' });

        if (req.method === 'POST' || req.method === 'PATCH') {
            const body = readBody(req);

            if (body.kind === 'client') {
                const made = req.method === 'POST' ? createClient(doc, body) : patchClient(doc, body);
                await accounts.writeAccounts(doc);
                return res.status(200).json({ client: clientOut(made, false) });
            }

            const clientId = text(body.clientId, 40);
            if (!doc.clients.some(one => one.id === clientId)) throw new Error('no-such-client');

            const money = await readMoney(clientId);

            if (body.kind === 'sub') {
                req.method === 'POST' ? createSub(money, body) : patchSub(money, body);
            } else if (body.kind === 'entry') {
                req.method === 'POST' ? createEntry(money, body, me) : patchEntry(money, body);
            } else if (body.kind === 'renew' && req.method === 'POST') {
                renew(money, body, me);
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
                // Their square goes too. A file nobody can reach any more is
                // storage being paid for, and if the store cannot be reached
                // the client still disappears: litter is not a failure.
                if (client.icon) {
                    try { await blob.client(req).del([client.icon]); } catch { /* litter */ }
                }
                doc.users.forEach(user => { if (user.clientId === client.id) user.clientId = null; });
                doc.grids.forEach(grid => { if (grid.clientId === client.id) grid.clientId = null; });
                doc.clients = doc.clients.filter(one => one.id !== client.id);

                await accounts.writeAccounts(doc);
                return res.status(200).json({ removed: client.id });
            }

            if (kind !== 'sub' && kind !== 'entry') return res.status(400).json({ error: 'bad-kind' });
            if (!doc.clients.some(one => one.id === clientId)) {
                return res.status(404).json({ error: 'no-such-client' });
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
                       'no-such-client', 'no-such-sub', 'no-such-entry',
                       'too-many-clients', 'too-many-subs', 'too-many-entries'];
        const status = known.includes(err.message) ? 400 : 500;
        return res.status(status).json({ error: err.message });
    }
};
