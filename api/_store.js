// Tiny wrapper over the Upstash Redis REST API.
//
// Upstash speaks plain HTTP, so this needs no npm package and the site stays a
// zero-dependency static build. Connect the store from the Vercel dashboard
// (Storage -> Upstash Redis) and the credentials arrive as env vars on their
// own; the two naming schemes below are the current and the legacy Vercel KV
// ones, and only one of them will be set.
const URL   = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const PRICE_KEY = 'portal:prices';

const command = async (...args) => {
    if (!URL || !TOKEN) throw new Error('No store is connected to this deployment.');

    const res = await fetch(URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
        cache: 'no-store'
    });
    if (!res.ok) throw new Error(`Store returned ${res.status}.`);

    const body = await res.json();
    if (body.error) throw new Error(body.error);
    return body.result;
};

exports.command = command;

// Every document in this store is JSON under its own key. A key that has never
// been written reads as null, which is not an error: it means the thing does
// not exist yet, and the caller decides what an empty one looks like.
exports.readJson = async (key) => {
    const raw = await command('GET', key);
    if (!raw) return null;
    try { return JSON.parse(raw); }
    catch { return null; }
};

exports.writeJson = async (key, value) => { await command('SET', key, JSON.stringify(value)); };

exports.deleteKey = async (key) => { await command('DEL', key); };


// --- lists ------------------------------------------------------------------
// A conversation and a bell are things that get one more item on the end, over
// and over. Kept as one JSON document, adding an item meant reading all of them
// back, adding one, and writing all of them out again: slow, and worse than
// slow, because two people adding at the same moment each wrote a document that
// did not have the other's item in it and one of the two vanished.
//
// A list is the shape Redis already has for this. Adding is one command, it is
// atomic, and nothing else is read or rewritten.
const listOut = (raw) => (Array.isArray(raw) ? raw : []).reduce((out, one) => {
    try { out.push(JSON.parse(one)); } catch { /* not ours, and not shown */ }
    return out;
}, []);

exports.listRead = async (key) => listOut(await command('LRANGE', key, '0', '-1'));

// Onto the end, and then the oldest trimmed off the front. The trim is a second
// command rather than part of the first, which is fine: between the two the
// list is one item over its length and nobody can tell.
exports.listAdd = async (key, value, keep) => {
    await command('RPUSH', key, JSON.stringify(value));
    await command('LTRIM', key, String(-keep), '-1');
};

// Onto the front, for a list that is read newest first.
exports.listAddFirst = async (key, value, keep) => {
    await command('LPUSH', key, JSON.stringify(value));
    await command('LTRIM', key, '0', String(keep - 1));
};

// Everything from this position on, and the rest dropped. A list in order has
// its oldest at the front, so taking the front off is how the old is forgotten
// without reading, rewriting or even knowing what is in it.
exports.listTrim = async (key, from) => { await command('LTRIM', key, String(from), '-1'); };

// Writing a whole list out again, which only happens when something is taken
// out of the middle of one.
exports.listWrite = async (key, values) => {
    await command('DEL', key);
    if (values.length) await command('RPUSH', key, ...values.map(one => JSON.stringify(one)));
};


// --- prices -----------------------------------------------------------------
const EMPTY = () => ({ site: { services: {} }, portal: { services: {} }, updatedAt: null });

exports.readPrices = async () => {
    const raw = await command('GET', PRICE_KEY);
    if (!raw) return EMPTY();

    let data;
    try { data = JSON.parse(raw); }
    catch { return EMPTY(); }

    const out = EMPTY();
    out.updatedAt = data.updatedAt || null;

    // Before the white-label site was editable there was one unnamed list, and
    // it was the portal's. Anything written back then still reads correctly.
    if (data.services && !data.portal) out.portal.services = data.services;

    ['site', 'portal'].forEach(name => {
        if (data[name] && data[name].services) out[name].services = data[name].services;
    });

    return out;
};

exports.writePrices = async (data) => { await command('SET', PRICE_KEY, JSON.stringify(data)); };


// --- login throttling -------------------------------------------------------
// These three deliberately swallow store errors. A store that is missing or
// unreachable should surface when something is read or written, with a message
// that says so — not as a confusing failure on the login screen.
const failKey = (ip) => `portal:login-fails:${ip}`;

exports.countFailures = async (ip) => {
    try { return Number(await command('GET', failKey(ip))) || 0; }
    catch { return 0; }
};

exports.recordFailure = async (ip, ttlSeconds) => {
    try {
        await command('INCR', failKey(ip));
        await command('EXPIRE', failKey(ip), ttlSeconds);
    } catch { /* not worth failing the request over */ }
};

exports.clearFailures = async (ip) => {
    try { await command('DEL', failKey(ip)); }
    catch { /* not worth failing the request over */ }
};
