// GET -> the stored price overrides, for the portal and the admin page
// PUT -> replaces them; requires the admin session cookie
//
// Only numbers are stored here. Which services exist, what they are called and
// which parameters they carry all stay in js/portal-data.js, so this endpoint
// can never reshape the catalogue — at worst it moves a figure.
const auth = require('./_auth');
const store = require('./_store');

const ID = /^[A-Za-z0-9_-]{1,40}$/;

const MAX_SERVICES = 200;
const MAX_PARAMS   = 40;
const MAX_OPTIONS  = 20;
const MAX_PRICE    = 1000000;

// Anything that is not a sane price is dropped rather than corrected, so a
// malformed field falls back to the figure in the code instead of silently
// becoming zero.
const cleanNumber = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > MAX_PRICE) return null;
    return Math.round(n * 100) / 100;
};

const cleanParam = (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const out = {};

    ['price', 'pricePerUnit'].forEach(field => {
        const n = cleanNumber(raw[field]);
        if (n !== null) out[field] = n;
    });

    if (Array.isArray(raw.options)) {
        const options = raw.options.slice(0, MAX_OPTIONS).map(cleanNumber);
        // An options array is positional: keeping it with a hole in it would
        // shift every price after the hole onto the wrong choice.
        if (options.length && options.every(n => n !== null)) out.options = options;
    }

    return Object.keys(out).length ? out : null;
};

const cleanService = (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const out = {};

    ['basePrice', 'floorPrice'].forEach(field => {
        const n = cleanNumber(raw[field]);
        if (n !== null) out[field] = n;
    });

    if (raw.params && typeof raw.params === 'object') {
        const params = {};
        Object.keys(raw.params).slice(0, MAX_PARAMS).forEach(key => {
            if (!ID.test(key)) return;
            const param = cleanParam(raw.params[key]);
            if (param) params[key] = param;
        });
        if (Object.keys(params).length) out.params = params;
    }

    return Object.keys(out).length ? out : null;
};

// Two price lists live here, and they must never bleed into each other: SITE is
// the white-label site's partner pricing (index.html), PORTAL is what end
// clients see in the quote builder (portal.html). Same shape, separate keys.
const SECTIONS = ['site', 'portal'];

const cleanSection = (raw) => {
    const source = (raw && typeof raw === 'object' && raw.services) || {};
    const services = {};

    Object.keys(source).slice(0, MAX_SERVICES).forEach(id => {
        if (!ID.test(id)) return;
        const service = cleanService(source[id]);
        if (service) services[id] = service;
    });

    return { services };
};

const cleanPayload = (raw) => {
    const out = { updatedAt: new Date().toISOString() };
    SECTIONS.forEach(name => { out[name] = cleanSection(raw && raw[name]); });
    return out;
};

module.exports = async (req, res) => {
    // Prices change rarely but must never be served stale: a visitor landing
    // seconds after a save should see the new figure, not a cached old one.
    res.setHeader('Cache-Control', 'no-store, max-age=0');

    try {
        if (req.method === 'GET') {
            return res.status(200).json(await store.readPrices());
        }

        if (req.method === 'PUT') {
            if (!auth.hasSession(req)) {
                return res.status(401).json({ error: 'not-signed-in' });
            }
            const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
            const data = cleanPayload(body);
            await store.writePrices(data);
            return res.status(200).json(data);
        }

        res.setHeader('Allow', 'GET, PUT');
        return res.status(405).json({ error: 'Method not allowed.' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};
