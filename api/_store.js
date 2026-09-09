// Tiny wrapper over the Upstash Redis REST API.
//
// Upstash speaks plain HTTP, so this needs no npm package and the site stays a
// zero-dependency static build. Connect the store from the Vercel dashboard
// (Storage -> Upstash Redis) and the credentials arrive as env vars on their
// own; the two naming schemes below are the current and the legacy Vercel KV
// ones, and only one of them will be set.
const URL   = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const KEY = 'portal:prices';

const command = async (...args) => {
    if (!URL || !TOKEN) throw new Error('No price store is connected to this deployment.');

    const res = await fetch(URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
        cache: 'no-store'
    });
    if (!res.ok) throw new Error(`Price store returned ${res.status}.`);

    const body = await res.json();
    if (body.error) throw new Error(body.error);
    return body.result;
};

// A store that has never been written to reads as null, which is not an error:
// it simply means no price has been overridden yet and the code defaults stand.
const EMPTY = () => ({ site: { services: {} }, portal: { services: {} }, updatedAt: null });

exports.readPrices = async () => {
    const raw = await command('GET', KEY);
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

exports.writePrices = async (data) => { await command('SET', KEY, JSON.stringify(data)); };

exports.isConfigured = () => Boolean(URL && TOKEN);

// --- login throttling -------------------------------------------------------
// These three deliberately swallow store errors. A store that is missing or
// unreachable should surface when prices are read or written, with a message
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
