// The work a client has been given, and the links to it.
//
// GET    ?clientId=            -> the files of one client (admin), or your own
// POST   { clientId, title, url }  -> hands over a file, admin only
// POST   { action: 'ask', id }     -> asks for an expired link back, client only
// PATCH  { clientId, id, ... }     -> renames one, or hands the link over again
// DELETE ?clientId=&id=            -> takes the line away altogether
//
// How long a link lives, and what is sent to whom, is decided in _files.js.
// What is decided here is who may ask.
const accounts = require('./_accounts');
const feed = require('./_feed');
const files = require('./_files');

const readBody = (req) =>
    typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

const text = (value, max) => String(value == null ? '' : value).trim().slice(0, max);

// Whose files these are. An admin says which client; anybody else has exactly
// one answer and is never asked the question.
const whose = (doc, me, said) => {
    if (me.role === 'admin') {
        const client = doc.clients.find(one => one.id === said);
        if (!client) throw new Error('no-such-client');
        return client;
    }
    if (me.role !== 'client' || !me.clientId) throw new Error('not-allowed');
    return doc.clients.find(one => one.id === me.clientId) || null;
};

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');

    try {
        const doc = await accounts.readAccounts();
        doc.clients = Array.isArray(doc.clients) ? doc.clients : [];

        const me = await accounts.currentUser(req, doc);
        if (!me) return res.status(401).json({ error: 'not-signed-in' });

        const boss = me.role === 'admin';
        // A partner does the work. Where the finished work was filed afterwards
        // is between the client and whoever invoices them.
        if (!boss && me.role !== 'client') return res.status(403).json({ error: 'not-allowed' });

        const said = text((req.query && req.query.clientId) || readBody(req).clientId, 40);
        const client = whose(doc, me, said);
        if (!client) return res.status(200).json({ files: [] });

        const mine = !boss;
        const doc2 = await files.read(client.id);

        if (req.method === 'GET') {
            return res.status(200).json({ files: files.listOut(doc2, mine) });
        }

        if (!boss && req.method === 'POST' && readBody(req).action === 'ask') {
            // The one thing a client may do here. Asking is not a change to
            // what they have: it is a message, and the file is where the
            // message waits until it is answered.
            const asked = files.ask(doc2, text(readBody(req).id, 40), me);
            await files.write(client.id, doc2);

            // Every admin, because there may be more than one of you and the
            // request is for whoever reads it first.
            await Promise.all(doc.users
                .filter(user => user.role === 'admin')
                .map(user => feed.push({
                    kind: 'file-ask',
                    actorId: me.id,
                    toId: user.id,
                    clientId: client.id,
                    text: feed.excerpt(asked.title)
                })));

            return res.status(200).json({ files: files.listOut(doc2, mine) });
        }

        if (!boss) return res.status(403).json({ error: 'not-allowed' });

        if (req.method === 'POST' || req.method === 'PATCH') {
            const body = readBody(req);
            req.method === 'POST' ? files.add(doc2, body) : files.change(doc2, body);
            await files.write(client.id, doc2);
            return res.status(200).json({ files: files.listOut(doc2, false) });
        }

        if (req.method === 'DELETE') {
            const id = text(req.query && req.query.id, 40);
            if (!doc2.files.some(one => one.id === id)) throw new Error('no-such-file');
            doc2.files = doc2.files.filter(one => one.id !== id);
            await files.write(client.id, doc2);
            return res.status(200).json({ files: files.listOut(doc2, false) });
        }

        res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
        return res.status(405).json({ error: 'Method not allowed.' });
    } catch (err) {
        const known = ['bad-name', 'bad-link', 'not-allowed', 'not-expired',
                       'no-such-client', 'no-such-file', 'too-many-files'];
        const status = err.message === 'not-allowed' ? 403
            : known.includes(err.message) ? 400 : 500;
        return res.status(status).json({ error: err.message });
    }
};
