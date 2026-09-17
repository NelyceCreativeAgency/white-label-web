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

const EMPTY = () => ({ users: [], grids: [], clients: [], updatedAt: null });

exports.readAccounts = async () => {
    const doc = await store.readJson(ACCOUNTS_KEY);
    if (!doc) return EMPTY();
    return {
        users: Array.isArray(doc.users) ? doc.users : [],
        grids: Array.isArray(doc.grids) ? doc.grids : [],
        // Added after the portal had been in use for a while, so a document
        // written before clients existed reads as a portal with none.
        clients: Array.isArray(doc.clients) ? doc.clients : [],
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

// The little square a project is known by. The admin can set one of its own,
// and where they have not, the profile picture of the grid itself is the
// picture of that project as far as anybody working on it is concerned: it is
// the one they chose and the one they have been looking at all week.
exports.faceOf = (grid) => grid.icon || grid.avatar || null;

// What may leave the server. The password hash never does.
exports.publicUser = (user) => ({
    id: user.id,
    username: user.username,
    name: user.name || user.username,
    role: user.role,
    avatar: user.avatar || null,
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

// Which password an account is on. It goes up by one every time the password
// is changed, and a cookie is only good for the count it was handed out under.
exports.passwordVersion = (user) => Number(user && user.pwv) || 0;

// The signed-in account, or null.
//
// A cookie naming an account that has since been removed reads as signed out,
// so deleting somebody takes effect at once rather than when their fortnight
// runs out. A cookie handed out against a password that has since been changed
// reads the same way, so changing a password shuts every door it opened.
exports.currentUser = async (req, doc) => {
    const claim = auth.sessionClaim(req);
    if (!claim) return null;

    const accounts = doc || await exports.readAccounts();
    const user = exports.findUser(accounts, claim.id);
    if (!user) return null;

    return claim.version === exports.passwordVersion(user) ? user : null;
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

    // Position is meaningful: an empty square between two pictures is a place
    // being held for something, not an accident, so nothing is shuffled up.
    const out = emptyPosts();
    posts.slice(0, SLOTS).forEach((post, i) => { out[i] = post || null; });
    return out;
};

exports.writePosts = async (gridId, posts) => {
    const kept = emptyPosts();
    posts.slice(0, SLOTS).forEach((post, i) => { kept[i] = post || null; });

    await store.writeJson(postsKey(gridId), {
        posts: kept,
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
