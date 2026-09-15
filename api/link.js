// POST { grid, url } -> the bytes of the picture at that address
//
// A link is not a picture. A Google Drive address opens a page with a viewer
// on it, a Dropbox address opens a preview, and hotlinking either would leave
// the grid pointing at something that can be moved or unshared tomorrow. So
// the picture is fetched here, once, handed to the browser to be shrunk the
// same way a chosen file is, and uploaded into the image store as its own.
//
// The browser cannot do this itself: another site's picture drawn onto a canvas
// taints it, and the shrunk copy can never be read back out. Coming through
// here it arrives from this site's own address, and nothing is tainted.
const dns = require('dns').promises;
const net = require('net');
const accounts = require('./_accounts');

const MAX_BYTES = 4 * 1024 * 1024;   // what a function may send back
const MAX_HOPS = 4;
const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];

const readBody = (req) =>
    typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

// The sharing links people actually copy, turned into addresses that answer
// with a picture, best first.
//
// Google keeps a resized copy of everything in Drive and will serve it at any
// width asked for, which is the whole of what this needs: the browser is going
// to shrink whatever arrives to PREVIEW_WIDTH anyway, so pulling the original
// twelve-megapixel file across only to throw most of it away is wasted time on
// both ends. The full download stays last in the list, for the rare file that
// has no preview.
const PREVIEW_WIDTH = 1600;

const candidates = (url) => {
    const drive = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?[^#]*id=)([-\w]{10,})/)
        || url.match(/lh\d\.googleusercontent\.com\/d\/([-\w]{10,})/);

    if (drive) {
        const id = drive[1];
        return [
            `https://drive.google.com/thumbnail?id=${id}&sz=w${PREVIEW_WIDTH}`,
            `https://lh3.googleusercontent.com/d/${id}=w${PREVIEW_WIDTH}`,
            `https://drive.google.com/uc?export=download&id=${id}`
        ];
    }

    if (/dropbox\.com\//.test(url)) {
        const bare = url.replace(/[?&]dl=\d/, '');
        return [bare + (bare.includes('?') ? '&raw=1' : '?raw=1')];
    }

    return [url];
};

// An address on this deployment's own network is not a picture anybody asked
// for. Names are resolved before the request goes out, because a public name
// is free to point at a private address.
const reachable = async (parsed) => {
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    if (/\.(local|internal|localhost)$/i.test(parsed.hostname)) return false;

    let addresses;
    try {
        addresses = net.isIP(parsed.hostname)
            ? [{ address: parsed.hostname }]
            : await dns.lookup(parsed.hostname, { all: true });
    } catch { return false; }

    return addresses.length > 0 && addresses.every(({ address }) => {
        if (net.isIPv6(address)) return !/^(::1|fc|fd|fe80)/i.test(address);
        const [a, b] = address.split('.').map(Number);
        if (a === 10 || a === 127 || a === 0) return false;
        if (a === 192 && b === 168) return false;
        if (a === 169 && b === 254) return false;       // link-local, and the metadata service
        if (a === 172 && b >= 16 && b <= 31) return false;
        return true;
    });
};

// Redirects are followed by hand so that every hop is checked, not just the
// address that was typed.
const follow = async (start) => {
    let url = start;

    for (let hop = 0; hop < MAX_HOPS; hop++) {
        const parsed = new URL(url);
        if (!await reachable(parsed)) throw new Error('bad-address');

        const res = await fetch(url, {
            redirect: 'manual',
            headers: { accept: 'image/*', 'user-agent': 'Mozilla/5.0 (compatible; NelycePortal/1.0)' }
        });

        if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
            url = new URL(res.headers.get('location'), url).toString();
            continue;
        }
        return res;
    }

    throw new Error('too-many-redirects');
};

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Method not allowed.' });
    }

    try {
        const doc = await accounts.readAccounts();
        const me = await accounts.currentUser(req, doc);
        if (!me) return res.status(401).json({ error: 'not-signed-in' });

        const grid = accounts.findGrid(doc, readBody(req).grid);
        if (!grid || !accounts.canView(me, grid)) return res.status(404).json({ error: 'no-such-grid' });
        if (!accounts.canEdit(me, grid)) return res.status(403).json({ error: 'not-allowed' });

        const given = String(readBody(req).url || '').trim();
        let tries;
        try {
            tries = candidates(given);
            tries.forEach(one => new URL(one));       // throws on anything that is not an address
        } catch { return res.status(400).json({ error: 'bad-link' }); }

        // Each address in turn, until one of them is a picture. A preview that
        // is missing answers with a page or a refusal rather than an error, so
        // the only way to know is to ask.
        let refusal = 'not-an-image';

        for (const one of tries) {
            const answer = await follow(one);

            if (!answer.ok) { refusal = 'link-refused'; continue; }

            const type = String(answer.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
            if (!TYPES.includes(type)) { refusal = 'not-an-image'; continue; }

            const declared = Number(answer.headers.get('content-length'));
            if (Number.isFinite(declared) && declared > MAX_BYTES) { refusal = 'link-too-large'; continue; }

            const bytes = Buffer.from(await answer.arrayBuffer());
            if (!bytes.length) { refusal = 'not-an-image'; continue; }
            if (bytes.length > MAX_BYTES) { refusal = 'link-too-large'; continue; }

            res.setHeader('Content-Type', type);
            return res.status(200).send(bytes);
        }

        return res.status(refusal === 'link-too-large' ? 413 : 400).json({ error: refusal });
    } catch (err) {
        const known = ['bad-address', 'too-many-redirects'];
        const status = known.includes(err.message) ? 400 : 500;
        return res.status(status).json({ error: known.includes(err.message) ? err.message : 'link-unreachable' });
    }
};
