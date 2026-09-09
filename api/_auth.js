// Password check and session cookie for the pricing admin.
//
// The password never reaches the browser: it lives in the ADMIN_PASSWORD env
// var, is compared here, and what goes back is a short-lived signed token. The
// signature is an HMAC keyed by ADMIN_SECRET, so a cookie cannot be forged
// without that secret, and it carries nothing but its own expiry.
const crypto = require('crypto');

const COOKIE = 'nelyce_admin';
const TTL_MS = 8 * 60 * 60 * 1000;   // one working day

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

exports.checkPassword = (given) => {
    const expected = process.env.ADMIN_PASSWORD;
    if (!expected) throw new Error('ADMIN_PASSWORD is not set on this deployment.');
    return sameString(given || '', expected);
};

exports.issueCookie = () => {
    const expires = Date.now() + TTL_MS;
    const token = `${expires}.${sign(String(expires))}`;
    return `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${TTL_MS / 1000}`;
};

exports.clearCookie = () =>
    `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;

exports.hasSession = (req) => {
    const header = req.headers.cookie || '';
    const match = header.split(';')
        .map(c => c.trim())
        .find(c => c.startsWith(`${COOKIE}=`));
    if (!match) return false;

    const [expires, signature] = match.slice(COOKIE.length + 1).split('.');
    if (!expires || !signature) return false;
    if (Number(expires) < Date.now()) return false;

    // A missing ADMIN_SECRET makes sign() throw. That is a deployment fault
    // worth surfacing when prices are written, but here it only ever means the
    // visitor is not signed in.
    try {
        return sameString(signature, sign(expires));
    } catch {
        return false;
    }
};
