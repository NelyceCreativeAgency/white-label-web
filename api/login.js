// POST   { password }  -> sets the session cookie
// GET                  -> { authenticated } so the admin page knows what to show
// DELETE               -> logs out
const auth = require('./_auth');
const store = require('./_store');

// A password field on the open internet gets guessed at. Failures are counted
// per IP in the same store the prices live in, and eight wrong tries buy the
// address a quarter of an hour of silence.
const MAX_FAILS = 8;
const LOCKOUT_S = 15 * 60;

// x-forwarded-for is worth exactly what the sender says it is: a client can put
// a fresh address in it on every request and walk straight past the allowance.
// x-real-ip and x-vercel-forwarded-for are written by Vercel's own proxy and
// cannot be talked over, so they come first.
const clientIp = (req) =>
    req.headers['x-real-ip'] ||
    (req.headers['x-vercel-forwarded-for'] || '').split(',')[0].trim() ||
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    'unknown';

module.exports = async (req, res) => {
    if (req.method === 'GET') {
        return res.status(200).json({ authenticated: auth.hasSession(req) });
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
        const fails = Number(await store.countFailures(ip)) || 0;
        if (fails >= MAX_FAILS) {
            return res.status(429).json({ error: 'too-many-attempts' });
        }

        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

        if (!auth.checkPassword(body.password)) {
            await store.recordFailure(ip, LOCKOUT_S);
            // Slow every wrong answer down a little, so an automated guesser
            // cannot race through the allowance before the counter catches up.
            await new Promise(r => setTimeout(r, 600));
            return res.status(401).json({ error: 'wrong-password' });
        }

        await store.clearFailures(ip);
        res.setHeader('Set-Cookie', auth.issueCookie());
        return res.status(200).json({ authenticated: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};
