// Passwords and session cookies for the portal.
//
// No password is ever stored or sent in the clear: accounts keep a scrypt hash
// with a per-account salt, and what the browser holds is a short signed token
// naming the account. The signature is an HMAC keyed by ADMIN_SECRET, so a
// cookie cannot be forged without that secret.
const crypto = require('crypto');

const COOKIE = 'nelyce_portal';
const TTL_MS = 14 * 24 * 60 * 60 * 1000;   // a fortnight, then sign in again

const secret = () => {
    const s = process.env.ADMIN_SECRET;
    if (!s) throw new Error('ADMIN_SECRET is not set on this deployment.');
    return s;
};

const sign = (payload) =>
    crypto.createHmac('sha256', secret()).update(payload).digest('hex');

// Comparing with === leaks the position of the first wrong character through how
// long the comparison takes. Comparing raw strings with timingSafeEqual still
// needs a length check first, and returning early on that leaks the length.
// Hashing both sides makes every comparison the same 32 bytes of work.
const sameString = (a, b) => {
    const digest = (value) => crypto.createHash('sha256').update(String(value)).digest();
    return crypto.timingSafeEqual(digest(a), digest(b));
};

exports.sameString = sameString;

// --- passwords --------------------------------------------------------------
// scrypt with the node defaults, salt and digest written into one field so a
// stored password carries everything needed to check it.
const KEY_LEN = 32;

exports.hashPassword = (plain) => {
    const salt = crypto.randomBytes(16).toString('hex');
    const key = crypto.scryptSync(String(plain), salt, KEY_LEN).toString('hex');
    return `scrypt$${salt}$${key}`;
};

exports.verifyPassword = (plain, stored) => {
    const [scheme, salt, key] = String(stored || '').split('$');
    if (scheme !== 'scrypt' || !salt || !key) return false;

    let given;
    try { given = crypto.scryptSync(String(plain || ''), salt, KEY_LEN).toString('hex'); }
    catch { return false; }

    return sameString(given, key);
};

// --- a password the admin can read back --------------------------------------
// The scrypt hash above is what a sign-in is checked against, and it cannot be
// undone. This is a second copy of the same password that can be, kept so that
// the one person who hands these passwords out can look one up instead of
// resetting it and telling the client a new one.
//
// It is sealed with AES-GCM under a key derived from ADMIN_SECRET, so the
// contents of the store on their own give nobody a password, and it leaves the
// server only through /api/accounts, which refuses anyone but an admin.
const sealKey = () => crypto.createHmac('sha256', secret()).update('password-seal').digest();

exports.sealPassword = (plain) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', sealKey(), iv);
    const body = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    return `aesgcm$${iv.toString('hex')}$${cipher.getAuthTag().toString('hex')}$${body.toString('hex')}`;
};

// Null for an account made before any of this existed, for one sealed under a
// secret that has since been changed, and for anything that has been tampered
// with. All three mean the same thing to the admin: this one has to be set
// again before it can be read.
exports.openPassword = (sealed) => {
    const [scheme, iv, tag, body] = String(sealed || '').split('$');
    if (scheme !== 'aesgcm' || !iv || !tag || !body) return null;

    try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', sealKey(), Buffer.from(iv, 'hex'));
        decipher.setAuthTag(Buffer.from(tag, 'hex'));
        return Buffer.concat([decipher.update(Buffer.from(body, 'hex')), decipher.final()]).toString('utf8');
    } catch {
        return null;
    }
};

// The one password that does not live in an account: it is what creates the
// first admin on an empty store, and what the price editor still signs in with.
exports.checkEnvPassword = (given) => {
    const expected = process.env.ADMIN_PASSWORD;
    if (!expected) throw new Error('ADMIN_PASSWORD is not set on this deployment.');
    return sameString(given || '', expected);
};

// --- session cookie ---------------------------------------------------------
exports.issueCookie = (userId) => {
    const expires = Date.now() + TTL_MS;
    const payload = `${userId}.${expires}`;
    const token = `${payload}.${sign(payload)}`;
    return `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${TTL_MS / 1000}`;
};

exports.clearCookie = () =>
    `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;

// Returns the account id the cookie names, or null. Whether that account still
// exists, and what it is allowed to do, is the accounts module's business.
exports.sessionUserId = (req) => {
    const header = req.headers.cookie || '';
    const match = header.split(';')
        .map(c => c.trim())
        .find(c => c.startsWith(`${COOKIE}=`));
    if (!match) return null;

    const token = match.slice(COOKIE.length + 1);
    const cut = token.lastIndexOf('.');
    if (cut < 0) return null;

    const payload = token.slice(0, cut);
    const signature = token.slice(cut + 1);
    const [userId, expires] = payload.split('.');
    if (!userId || !expires) return null;
    if (Number(expires) < Date.now()) return null;

    // A missing ADMIN_SECRET makes sign() throw. That is a deployment fault
    // worth surfacing when something is written, but here it only ever means
    // the visitor is not signed in.
    try {
        return sameString(signature, sign(payload)) ? userId : null;
    } catch {
        return null;
    }
};
