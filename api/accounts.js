// The admin's own endpoint: who has an account, what grids exist, and who is
// on which. Everything here is refused to anyone who is not an admin, because
// adding and removing people is the one thing that stays in one pair of hands.
//
// GET                                  -> { users, grids }
// POST   { kind: 'user' | 'grid', ... } -> creates one
// PATCH  { kind, id, ... }              -> changes one
// DELETE ?kind=&id=                     -> removes one
const accounts = require('./_accounts');
const blob = require('./_blob');
const auth = require('./_auth');
const presence = require('./_presence');

const USERNAME = /^[a-zA-Z0-9._-]{3,32}$/;
const MIN_PASSWORD = 8;
const MAX_NAME = 60;
const MAX_USERS = 200;
const MAX_GRIDS = 200;

const text = (value, max) => String(value == null ? '' : value).trim().slice(0, max);

const readBody = (req) =>
    typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

const gridOut = (grid) => ({
    id: grid.id,
    name: grid.name,
    handle: grid.handle || '',
    avatar: grid.avatar || null,
    // The square beside the name in the sidebar: the admin's own if they set
    // one, and otherwise the grid's profile picture.
    icon: accounts.faceOf(grid),
    // What the admin actually set, for the panel that sets it.
    ownIcon: grid.icon || null,
    highlights: Array.isArray(grid.highlights) ? grid.highlights : [],
    slots: Number(grid.slots) || 0,
    memberIds: Array.isArray(grid.memberIds) ? grid.memberIds : [],
    createdAt: grid.createdAt || null
});

// Ids that name nobody are dropped rather than kept: a grid should never carry
// a member who has been deleted, or the same person twice.
const cleanMembers = (doc, ids) => {
    const wanted = Array.isArray(ids) ? ids : [];
    return doc.users
        .filter(u => wanted.includes(u.id) && u.role !== 'admin')
        .map(u => u.id);
};

const createUser = (doc, body) => {
    if (doc.users.length >= MAX_USERS) throw new Error('too-many-users');

    const username = text(body.username, 32);
    if (!USERNAME.test(username)) throw new Error('bad-username');
    if (accounts.findByUsername(doc, username)) throw new Error('username-taken');

    const role = accounts.ROLES.includes(body.role) ? body.role : 'client';
    const password = String(body.password || '');
    if (password.length < MIN_PASSWORD) throw new Error('short-password');

    const user = {
        id: accounts.newId('usr'),
        username,
        name: text(body.name, MAX_NAME) || username,
        role,
        password: auth.hashPassword(password),
        secret: auth.sealPassword(password),
        createdAt: new Date().toISOString(),
        lastLoginAt: null
    };
    doc.users.push(user);
    return user;
};

const patchUser = (doc, me, body) => {
    const user = accounts.findUser(doc, body.id);
    if (!user) throw new Error('no-such-user');

    if (body.username !== undefined) {
        const username = text(body.username, 32);
        if (!USERNAME.test(username)) throw new Error('bad-username');
        const clash = accounts.findByUsername(doc, username);
        if (clash && clash.id !== user.id) throw new Error('username-taken');
        user.username = username;
    }

    if (body.name !== undefined) user.name = text(body.name, MAX_NAME) || user.username;

    if (body.role !== undefined && accounts.ROLES.includes(body.role) && body.role !== user.role) {
        // Signing out of a site nobody can administer any more is a mistake
        // that cannot be undone from the outside, so the last admin stays one.
        const admins = doc.users.filter(u => u.role === 'admin');
        if (user.role === 'admin' && admins.length < 2) throw new Error('last-admin');
        user.role = body.role;

        // A demoted admin was on no grids; a promoted member should not keep
        // memberships that now mean nothing.
        if (user.role === 'admin') {
            doc.grids.forEach(grid => {
                grid.memberIds = (grid.memberIds || []).filter(id => id !== user.id);
            });
        }
    }

    if (body.password !== undefined && body.password !== '') {
        if (String(body.password).length < MIN_PASSWORD) throw new Error('short-password');
        user.password = auth.hashPassword(String(body.password));
        user.secret = auth.sealPassword(String(body.password));

        // Every cookie handed out against the old password stops working here.
        // Somebody who had got in is out, which is what changing a password is
        // supposed to mean.
        user.pwv = accounts.passwordVersion(user) + 1;
    }

    return user;
};

const createGrid = (doc, body) => {
    if (doc.grids.length >= MAX_GRIDS) throw new Error('too-many-grids');

    const name = text(body.name, MAX_NAME);
    if (!name) throw new Error('bad-name');

    const grid = {
        id: accounts.newId('grd'),
        name,
        handle: text(body.handle, 40).replace(/^@/, ''),
        memberIds: cleanMembers(doc, body.memberIds),
        createdAt: new Date().toISOString()
    };
    doc.grids.push(grid);
    return grid;
};

const patchGrid = (doc, body) => {
    const grid = accounts.findGrid(doc, body.id);
    if (!grid) throw new Error('no-such-grid');

    if (body.name !== undefined) {
        const name = text(body.name, MAX_NAME);
        if (!name) throw new Error('bad-name');
        grid.name = name;
    }
    if (body.handle !== undefined) grid.handle = text(body.handle, 40).replace(/^@/, '');

    if (body.icon !== undefined) {
        if (body.icon && !blob.isOurImage(body.icon)) throw new Error('bad-image');
        grid.icon = body.icon || null;
    }
    if (body.memberIds !== undefined) grid.memberIds = cleanMembers(doc, body.memberIds);

    return grid;
};

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');

    try {
        const doc = await accounts.readAccounts();
        const me = await accounts.currentUser(req, doc);
        if (!me) return res.status(401).json({ error: 'not-signed-in' });
        if (me.role !== 'admin') return res.status(403).json({ error: 'not-allowed' });

        if (req.method === 'GET') {
            // The only place a password is ever sent back, to the only role
            // that is let through the check above. An account made before the
            // sealed copy existed reads as null, and the panel says so.
            const here = await presence.of(doc.users.map(user => user.id));

            return res.status(200).json({
                users: doc.users.map(user => ({
                    ...accounts.publicUser(user),
                    password: auth.openPassword(user.secret),
                    ...here[user.id]
                })),
                grids: doc.grids.map(gridOut)
            });
        }

        if (req.method === 'POST' || req.method === 'PATCH') {
            const body = readBody(req);
            const isUser = body.kind === 'user';

            const made = req.method === 'POST'
                ? (isUser ? createUser(doc, body) : createGrid(doc, body))
                : (isUser ? patchUser(doc, me, body) : patchGrid(doc, body));

            await accounts.writeAccounts(doc);
            return res.status(200).json(isUser ? { user: accounts.publicUser(made) } : { grid: gridOut(made) });
        }

        if (req.method === 'DELETE') {
            const { kind, id } = req.query || {};

            if (kind === 'user') {
                const user = accounts.findUser(doc, id);
                if (!user) return res.status(404).json({ error: 'no-such-user' });
                if (user.id === me.id) return res.status(400).json({ error: 'not-yourself' });

                doc.users = doc.users.filter(u => u.id !== user.id);
                doc.grids.forEach(grid => {
                    grid.memberIds = (grid.memberIds || []).filter(m => m !== user.id);
                });
                await accounts.writeAccounts(doc);
                return res.status(200).json({ removed: user.id });
            }

            if (kind === 'grid') {
                const grid = accounts.findGrid(doc, id);
                if (!grid) return res.status(404).json({ error: 'no-such-grid' });

                // The pictures go too. If the image store cannot be reached the
                // grid still disappears: a stranded file costs storage, while a
                // half-deleted grid would keep showing up in the sidebar.
                const posts = await accounts.readPosts(grid.id);
                const urls = posts.filter(Boolean)
                    .flatMap(post => (post.images || []).map(img => img.url))
                    .concat(grid.avatar ? [grid.avatar] : [])
                    .concat((grid.highlights || []).map(h => h.url));
                try { await blob.client(req).del(urls); } catch { /* litter, not a failure */ }

                await accounts.dropPosts(grid.id);
                doc.grids = doc.grids.filter(g => g.id !== grid.id);
                await accounts.writeAccounts(doc);
                return res.status(200).json({ removed: grid.id });
            }

            return res.status(400).json({ error: 'bad-kind' });
        }

        res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
        return res.status(405).json({ error: 'Method not allowed.' });
    } catch (err) {
        const known = ['bad-username', 'username-taken', 'short-password', 'no-such-user',
                       'no-such-grid', 'bad-name', 'last-admin', 'too-many-users',
                       'too-many-grids', 'not-yourself', 'bad-kind', 'bad-image'];
        const status = known.includes(err.message) ? 400 : 500;
        return res.status(status).json({ error: err.message });
    }
};
