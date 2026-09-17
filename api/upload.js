// POST { grid, type, data }                    -> { url }
// POST { kind: 'me', type, data }              -> { url }, a picture of yourself
// POST { kind: 'client', client, type, data }  -> { url }, a client's face, which
//                                                 is the face of their account
// POST { kind: 'link', grid, url }             -> the bytes of the picture at
//                                                 that address, for the browser
//                                                 to shrink and send back
//
// One picture at a time. The browser has already shrunk it before it gets here
// (see js/portal-app.js): what arrives is a screen-sized JPEG, base64 in a JSON
// body, which is why this needs no multipart parsing and no npm package.
//
// Only someone who may edit the grid may add a picture to it, and the url that
// comes back is the only place a post is ever allowed to point at.
//
// A link is the same errand by the other door. A Google Drive address opens a
// page with a viewer on it, a Dropbox address opens a preview, and hotlinking
// either would leave the grid pointing at something that can be moved or
// unshared tomorrow. So the picture is fetched here, once, handed to the
// browser to be shrunk the same way a chosen file is, and sent back up to be
// uploaded as this site's own. The browser cannot do this itself: another
// site's picture drawn onto a canvas taints it, and the shrunk copy can never
// be read back out.
const dns = require('dns').promises;
const net = require('net');
const accounts = require('./_accounts');
const blob = require('./_blob');

const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// What may come back from somebody else's address. Wider than the three this
// site stores, because the browser is about to turn whatever arrives into one
// of those anyway.
const FETCHED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];

const MAX_HOPS = 4;

// Vercel gives a function about four and a half megabytes of request body, and
// base64 costs a third on top of the bytes it carries. Four is the most that
// can arrive without the platform cutting the request off first.
const MAX_BYTES = 4 * 1024 * 1024;

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

        const body = readBody(req);

        // A picture that is somewhere else yet. Checked against the same grid,
        // by the same two questions, because it is the same picture going to
        // the same place; all that differs is who fetches it.
        if (body.kind === 'link') {
            const grid = accounts.findGrid(doc, body.grid);
            if (!grid || !accounts.canView(me, grid)) return res.status(404).json({ error: 'no-such-grid' });
            if (!accounts.canEdit(me, grid)) return res.status(403).json({ error: 'not-allowed' });

            let tries;
            try {
                tries = candidates(String(body.url || '').trim());
                tries.forEach(one => new URL(one));   // throws on anything that is not an address
            } catch { return res.status(400).json({ error: 'bad-link' }); }

            // Each address in turn, until one of them is a picture. A preview
            // that is missing answers with a page or a refusal rather than an
            // error, so the only way to know is to ask.
            let refusal = 'not-an-image';

            try {
                for (const one of tries) {
                    const answer = await follow(one);

                    if (!answer.ok) { refusal = 'link-refused'; continue; }

                    const said = String(answer.headers.get('content-type') || '')
                        .split(';')[0].trim().toLowerCase();
                    if (!FETCHED.includes(said)) { refusal = 'not-an-image'; continue; }

                    const declared = Number(answer.headers.get('content-length'));
                    if (Number.isFinite(declared) && declared > MAX_BYTES) { refusal = 'link-too-large'; continue; }

                    const bytes = Buffer.from(await answer.arrayBuffer());
                    if (!bytes.length) { refusal = 'not-an-image'; continue; }
                    if (bytes.length > MAX_BYTES) { refusal = 'link-too-large'; continue; }

                    res.setHeader('Content-Type', said);
                    return res.status(200).send(bytes);
                }
            } catch {
                // An address that will not resolve, points somewhere private,
                // or keeps redirecting. None of them is this site's fault and
                // none of them is a picture.
                return res.status(400).json({ error: 'link-unreachable' });
            }

            return res.status(refusal === 'link-too-large' ? 413 : 400).json({ error: refusal });
        }

        // Three things a picture can belong to, and each one decides for itself
        // who may add to it. The folder it lands in is decided here too, so a
        // request can never talk its way into somebody else's.
        const kind = ['me', 'client', 'project'].includes(body.kind) ? body.kind : 'grid';
        let holds;

        if (kind === 'me') {
            // A picture of yourself hangs off no grid: everybody has one
            // account and may put a face on it, client and partner alike.
            holds = `people/${me.id}`;
        } else if (kind === 'project') {
            // A project's picture is chosen before the project exists, so there
            // is no project yet to ask permission of. What is asked instead is
            // whether this account is one that may have projects at all, and
            // the picture is filed under whoever chose it.
            if (!accounts.mayHaveProjects(me)) return res.status(403).json({ error: 'not-allowed' });
            holds = `projects/${me.id}`;
        } else if (kind === 'client') {
            // A client has no picture of its own: this is the photograph on the
            // account they sign in with, which the admin may set from their
            // card and they may set from their own settings. It goes where
            // that account's pictures go, because that is whose it is.
            if (me.role !== 'admin') return res.status(403).json({ error: 'not-allowed' });
            const client = doc.clients.find(one => one.id === body.client);
            if (!client) return res.status(404).json({ error: 'no-such-client' });

            const face = doc.users.find(user => user.clientId === client.id && user.role === 'client');
            if (!face) return res.status(400).json({ error: 'no-account' });
            holds = `people/${face.id}`;
        } else {
            const grid = accounts.findGrid(doc, body.grid);
            if (!grid || !accounts.canView(me, grid)) return res.status(404).json({ error: 'no-such-grid' });
            if (!accounts.canEdit(me, grid)) return res.status(403).json({ error: 'not-allowed' });
            holds = `grids/${grid.id}`;
        }

        const type = String(body.type || '');
        const extension = TYPES[type];
        if (!extension) return res.status(400).json({ error: 'bad-type' });

        // Anything that is not base64 decodes to something shorter than it
        // claims to be, so the length check below catches a malformed body too.
        const data = String(body.data || '').split(',').pop();
        const bytes = Buffer.from(data, 'base64');
        if (!bytes.length) return res.status(400).json({ error: 'empty-image' });
        if (bytes.length > MAX_BYTES) return res.status(413).json({ error: 'too-large' });

        const { url } = await blob.client(req).put(`${holds}/${Date.now()}.${extension}`, bytes, type);
        return res.status(200).json({ url });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};
