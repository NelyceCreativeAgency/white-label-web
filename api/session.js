// POST   { username, password, role } -> signs in and sets the session cookie
// GET                                 -> { user } so a page knows who is here
// PATCH  { avatar: <url> | null }     -> the one thing you may change yourself
// DELETE                              -> signs out
//
// Everything about the account you are signed in as lives here, which is also
// why the portal's heartbeat is a GET to this address: it says who is here,
// and saying so is what being here means.
//
// The role on the way in is only what the visitor picked on the first screen.
// What they are actually allowed to do comes from their account, and the reply
// says which environment to open — the choice never grants anything.
const auth = require('./_auth');
const accounts = require('./_accounts');
const blob = require('./_blob');
const presence = require('./_presence');
const store = require('./_store');

// A password field on the open internet gets guessed at. Failures are counted
// per IP, and eight wrong tries buy the address a quarter of an hour of
// silence.
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

const readBody = (req) =>
    typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

// An empty store has no one to sign in as, so the first visit with the
// deployment's own ADMIN_PASSWORD becomes the admin account. From then on that
// password only ever serves as the admin's way back in.
const bootstrap = async (doc, username) => {
    const user = {
        id: accounts.newId('usr'),
        username: String(username || 'admin').trim() || 'admin',
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

    try {
        if (req.method === 'GET') {
            const user = await accounts.currentUser(req);
            // Loading the portal at all is arriving at it.
            if (user) await presence.touch(user.id);
            return res.status(200).json({ user: user ? accounts.publicUser(user) : null });
        }

        // The picture on your own account, and nothing else about it. A name,
        // a username and a role are how everybody else knows who you are, and
        // the admin decides those in api/accounts.js. A face is yours.
        if (req.method === 'PATCH') {
            const doc = await accounts.readAccounts();
            const me = await accounts.currentUser(req, doc);
            if (!me) return res.status(401).json({ error: 'not-signed-in' });

            await presence.touch(me.id);

            const body = readBody(req);
            if (!('avatar' in body)) return res.status(400).json({ error: 'bad-action' });
            if (body.avatar && !blob.isOurImage(body.avatar)) {
                return res.status(400).json({ error: 'bad-image' });
            }

            const was = me.avatar || null;
            me.avatar = body.avatar ? String(body.avatar) : null;
            await accounts.writeAccounts(doc);

            // The one it replaced is nobody's picture now. If the store cannot
            // be reached the account still has its new face: a stranded file
            // costs storage, a failed save costs what was asked for.
            if (was && was !== me.avatar) {
                try { await blob.client(req).del([was]); } catch { /* litter */ }
            }

            return res.status(200).json({ user: accounts.publicUser(me) });
        }

        if (req.method === 'DELETE') {
            res.setHeader('Set-Cookie', auth.clearCookie());
            return res.status(200).json({ user: null });
        }

        if (req.method !== 'POST') {
            res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
            return res.status(405).json({ error: 'Method not allowed.' });
        }

        const ip = clientIp(req);
        if (await store.countFailures(ip) >= MAX_FAILS) {
            return res.status(429).json({ error: 'too-many-attempts' });
        }

        const body = readBody(req);
        const doc = await accounts.readAccounts();

        let user = accounts.findByUsername(doc, body.username);

        // Either the account's own password, or — for an admin, and for the
        // very first account — the password this deployment was set up with.
        let ok = false;
        if (user) {
            ok = auth.verifyPassword(body.password, user.password);
            if (!ok && user.role === 'admin') {
                try { ok = auth.checkEnvPassword(body.password); } catch { ok = false; }
            }
        } else if (!doc.users.length) {
            let envOk = false;
            try { envOk = auth.checkEnvPassword(body.password); } catch { envOk = false; }
            if (envOk) {
                user = await bootstrap(doc, body.username);
                ok = true;
            }
        }

        if (!ok || !user) {
            await store.recordFailure(ip, LOCKOUT_S);
            // Slow every wrong answer down a little, so an automated guesser
            // cannot race through the allowance before the counter catches up.
            await new Promise(r => setTimeout(r, 600));
            return res.status(401).json({ error: 'wrong-credentials' });
        }

        await store.clearFailures(ip);

        user.lastLoginAt = new Date().toISOString();
        await accounts.writeAccounts(doc);

        res.setHeader('Set-Cookie', auth.issueCookie(user.id));
        return res.status(200).json({
            user: accounts.publicUser(user),
            // false when someone picked the wrong door on the first screen. The
            // page says so and takes them to the right one anyway. An admin is
            // never wrong about it: both doors are theirs.
            picked: user.role === 'admin' || body.role === user.role
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};
