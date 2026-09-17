// The price editor's way in (admin.html), which asks for a password and
// nothing else.
//
// POST   { password }  -> signs in as the admin and sets the session cookie
// GET                  -> { authenticated } so the admin page knows what to show
// DELETE               -> signs out
//
// The portal's own sign-in, which asks for a username as well, is in
// session.js. Both hand out the same cookie, so signing in here signs you in
// there too, and that is on purpose: it is the same person.
const auth = require('./_auth');
const accounts = require('./_accounts');
const store = require('./_store');

const MAX_FAILS = 8;
const LOCKOUT_S = 15 * 60;

const clientIp = (req) =>
    req.headers['x-real-ip'] ||
    (req.headers['x-vercel-forwarded-for'] || '').split(',')[0].trim() ||
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    'unknown';

// ADMIN_PASSWORD is what this deployment was set up with, and it names the
// admin account rather than an account of its own. On a store that has never
// had one, it creates it.
const adminAccount = async () => {
    const doc = await accounts.readAccounts();
    const existing = doc.users.find(u => u.role === 'admin');
    if (existing) return existing;

    const user = {
        id: accounts.newId('usr'),
        username: 'admin',
        name: 'Nelyce',
        role: 'admin',
        password: auth.hashPassword(process.env.ADMIN_PASSWORD),
        createdAt: new Date().toISOString(),
        lastLoginAt: null
    };
    doc.users.push(user);
    await accounts.writeAccounts(doc);
    return user;
};

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');

    if (req.method === 'GET') {
        try {
            const me = await accounts.currentUser(req);
            return res.status(200).json({ authenticated: Boolean(me && me.role === 'admin') });
        } catch {
            return res.status(200).json({ authenticated: false });
        }
    }

    if (req.method === 'DELETE') {
        res.setHeader('Set-Cookie', auth.clearCookie());
        return res.status(200).json({ authenticated: false });
    }

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'GET, POST, DELETE');
        return res.status(405).json({ error: 'Method not allowed.' });
    }

    try {
        const ip = clientIp(req);
        if (await store.countFailures(ip) >= MAX_FAILS) {
            return res.status(429).json({ error: 'too-many-attempts' });
        }

        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

        if (!auth.checkEnvPassword(body.password)) {
            await store.recordFailure(ip, LOCKOUT_S);
            // Slow every wrong answer down a little, so an automated guesser
            // cannot race through the allowance before the counter catches up.
            await new Promise(r => setTimeout(r, 600));
            return res.status(401).json({ error: 'wrong-password' });
        }

        await store.clearFailures(ip);
        const user = await adminAccount();
        res.setHeader('Set-Cookie', auth.issueCookie(user.id, accounts.passwordVersion(user)));
        return res.status(200).json({ authenticated: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};
