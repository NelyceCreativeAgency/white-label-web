// Who exists, what they may open, and where a grid's posts are kept.
//
// Accounts and grids are small and always read together, so they live in one
// JSON document. A grid's posts are the heavy part and get a key of their own,
// one document per grid, so opening the account list never drags the pictures
// along with it.
const crypto = require('crypto');
const store = require('./_store');
const auth = require('./_auth');

const ACCOUNTS_KEY = 'portal:accounts';
const postsKey = (gridId) => `portal:grid:${gridId}`;

// Three roles, and only the first of them can change who the other two are.
// The other two both work on the grids they are put on; what a client says
// about a post is marked as a client's, and that is the whole difference.
const ROLES = ['admin', 'partner', 'client'];
exports.ROLES = ROLES;

// An Instagram grid is three across. Twenty-four posts is eight rows of it,
// which is what fits on screen as a mockup of the real profile.
const SLOTS = 24;
exports.SLOTS = SLOTS;

exports.newId = (prefix) => `${prefix}_${crypto.randomBytes(8).toString('hex')}`;

const EMPTY = () => ({ users: [], grids: [], updatedAt: null });

exports.readAccounts = async () => {
    const doc = await store.readJson(ACCOUNTS_KEY);
    if (!doc) return EMPTY();
    return {
        users: Array.isArray(doc.users) ? doc.users : [],
        grids: Array.isArray(doc.grids) ? doc.grids : [],
        updatedAt: doc.updatedAt || null
    };
};

exports.writeAccounts = async (doc) => {
    doc.updatedAt = new Date().toISOString();
    await store.writeJson(ACCOUNTS_KEY, doc);
    return doc;
};

// Usernames are matched case-insensitively and stored the way they were typed,
// so that Vito and vito are the same person and neither has to remember which.
const fold = (name) => String(name || '').trim().toLowerCase();
exports.fold = fold;

exports.findByUsername = (doc, username) =>
    doc.users.find(u => fold(u.username) === fold(username)) || null;

exports.findUser = (doc, id) => doc.users.find(u => u.id === id) || null;
exports.findGrid = (doc, id) => doc.grids.find(g => g.id === id) || null;

// What may leave the server. The password hash never does.
exports.publicUser = (user) => ({
    id: user.id,
    username: user.username,
    name: user.name || user.username,
    role: user.role,
    createdAt: user.createdAt || null,
    lastLoginAt: user.lastLoginAt || null
});

// --- permissions ------------------------------------------------------------
const isMember = (user, grid) =>
    Array.isArray(grid.memberIds) && grid.memberIds.includes(user.id);

const canView = (user, grid) => user.role === 'admin' || isMember(user, grid);

// Anybody put on a grid works on it, client or partner. What the two roles
// still separate is whose voice a note is written in: a note from a client is
// the one that raises a flag on the slot until somebody answers it.
const canEdit = (user, grid) =>
    user.role === 'admin' || isMember(user, grid);

exports.isMember = isMember;
exports.canView = canView;
exports.canEdit = canEdit;

exports.gridsFor = (doc, user) =>
    doc.grids.filter(grid => canView(user, grid));

// The signed-in account, or null. A cookie naming an account that has since
// been removed reads as signed out, so deleting someone takes effect at once
// rather than when their fortnight runs out.
exports.currentUser = async (req, doc) => {
    const id = auth.sessionUserId(req);
    if (!id) return null;
    const accounts = doc || await exports.readAccounts();
    return exports.findUser(accounts, id);
};

// --- a grid's posts ---------------------------------------------------------
// Twenty-four slots, in the order they appear on the profile. A slot is either
// null or a post, so the position of a picture in the document is the position
// the visitor sees, with no sorting in between.
const emptyPosts = () => new Array(SLOTS).fill(null);
exports.emptyPosts = emptyPosts;

exports.readPosts = async (gridId) => {
    const doc = await store.readJson(postsKey(gridId));
    const posts = doc && Array.isArray(doc.posts) ? doc.posts : [];

    // The posts come first and the free slots after, always. A document
    // written while the grid still had empty squares in it may have a gap in
    // the middle, and a gap is invisible now, so it is closed on the way out.
    const out = emptyPosts();
    posts.filter(Boolean).slice(0, SLOTS).forEach((post, i) => { out[i] = post; });
    return out;
};

exports.writePosts = async (gridId, posts) => {
    // The same rule going in as coming out: posts first, free slots after. It
    // is written down rather than assumed, so no action has to remember it.
    const tidy = emptyPosts();
    posts.filter(Boolean).slice(0, SLOTS).forEach((post, i) => { tidy[i] = post; });

    await store.writeJson(postsKey(gridId), {
        posts: tidy,
        updatedAt: new Date().toISOString()
    });
};

exports.dropPosts = async (gridId) => { await store.deleteKey(postsKey(gridId)); };

// The badge the editors see on a grid: how many posts carry a client's note
// that nobody has marked as handled yet.
exports.openNoteCount = (posts) =>
    posts.reduce((count, post) => {
        if (!post || !Array.isArray(post.notes)) return count;
        return count + (post.notes.some(n => n.role === 'client' && !n.resolved) ? 1 : 0);
    }, 0);
