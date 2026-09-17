// A project: the team's own room, and who is in it.
//
// GET                              -> every project this account may open
// GET    ?project=                 -> one project and the requests in it
// POST   { name, icon, memberIds } -> starts one
// POST   { kind: 'ask', project, ... } -> asks somebody in it for something
// PATCH  { id, ... }               -> renames it, repictures it, changes who is on it
// DELETE ?id=                      -> takes it away
// DELETE ?kind=ask&project=&id=    -> takes a request away
//
// The room is kept with the accounts, because it is small and wanted on every
// request that asks what somebody may open. What is asked inside it is kept per
// project, under a key of its own, because that is the part that grows.
//
// A client never sees one. The portal a client signs into is their own account
// and the grids they have paid for; how the work between us is arranged is
// ours, and a room they cannot open is simpler than a room they can open and
// must then be careful in.
const accounts = require('./_accounts');
const blob = require('./_blob');
const asks = require('./_asks');
const feed = require('./_feed');

const MAX_PROJECTS = 100;
const MAX_NAME = 60;

const readBody = (req) =>
    typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

const text = (value, max) => String(value == null ? '' : value).trim().slice(0, max);

// Who may be put on a project: the people who work here. A client is not one,
// whoever asks, and an id that names nobody names nobody.
const membersFrom = (doc, wanted, owner) => {
    const asked = Array.isArray(wanted) ? wanted : [];
    const kept = doc.users
        .filter(user => asked.includes(user.id) && accounts.mayHaveProjects(user))
        .map(user => user.id);

    // Whoever started it is on it. A room you made and cannot enter is a bug
    // wearing the clothes of a permission.
    return Array.from(new Set([owner, ...kept]));
};

const projectOut = (project, doc, me) => ({
    id: project.id,
    name: project.name,
    icon: project.icon || null,
    memberIds: project.memberIds || [],
    members: (project.memberIds || [])
        .map(id => accounts.findUser(doc, id))
        .filter(Boolean)
        .map(user => accounts.publicUser(user)),
    by: project.by || null,
    createdAt: project.createdAt || null,
    // Said by the server rather than worked out again by every page that draws
    // a button: the two are the same question and one answer is enough.
    mine: accounts.canRunProject(me, project)
});

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');

    try {
        const doc = await accounts.readAccounts();
        const me = await accounts.currentUser(req, doc);
        if (!me) return res.status(401).json({ error: 'not-signed-in' });

        if (!accounts.mayHaveProjects(me)) return res.status(403).json({ error: 'not-allowed' });

        // One room, and what is waiting in it. The list of requests is filtered
        // as it is read rather than as it is written: a request addressed to
        // one person never leaves the server for anybody else.
        if (req.method === 'GET' && text(req.query && req.query.project, 40)) {
            const project = accounts.findProject(doc, text(req.query.project, 40));
            if (!accounts.canViewProject(me, project)) {
                return res.status(404).json({ error: 'no-such-project' });
            }

            const kept = await asks.read(project.id);
            return res.status(200).json({
                project: projectOut(project, doc, me),
                asks: kept.asks
                    .filter(one => asks.mayRead(one, me))
                    .map(one => asks.out(one, doc, me))
            });
        }

        // Everything anybody has asked of me, from every room at once. Five
        // projects is five places to look and a morning spent looking; this is
        // the one place that answers "what is waiting for me".
        if (req.method === 'GET' && (req.query || {}).mine) {
            const rooms = accounts.projectsFor(doc, me);
            const each = await Promise.all(rooms.map(one => asks.read(one.id)));

            const waiting = [];
            rooms.forEach((room, at) => {
                each[at].asks
                    .filter(one => asks.mayRead(one, me))
                    .forEach(one => waiting.push({
                        ...asks.out(one, doc, me),
                        projectId: room.id,
                        projectName: room.name
                    }));
            });

            // Newest first across all of them, which is the only order that
            // means anything once they have left their rooms behind.
            waiting.sort((a, b) => String(b.at).localeCompare(String(a.at)));
            return res.status(200).json({ asks: waiting });
        }

        if (req.method === 'GET') {
            const rooms = accounts.projectsFor(doc, me);
            const each = await Promise.all(rooms.map(one => asks.read(one.id)));

            return res.status(200).json({
                projects: rooms.map((one, at) => ({
                    ...projectOut(one, doc, me),
                    // How many requests in this room are waiting on this
                    // reader, so the sidebar can say so without being opened.
                    lit: each[at].asks.filter(ask =>
                        asks.mayRead(ask, me) && asks.faceFor(ask, me.id) === 'lit').length
                })),
                // Everybody who could be put on one, so the panel can offer
                // them without a second request.
                people: doc.users
                    .filter(user => accounts.mayHaveProjects(user))
                    .map(user => accounts.publicUser(user))
            });
        }

        if (req.method === 'POST' && readBody(req).kind === 'ask') {
            const body = readBody(req);
            const project = accounts.findProject(doc, text(body.project, 40));
            if (!accounts.canViewProject(me, project)) {
                return res.status(404).json({ error: 'no-such-project' });
            }

            const kept = await asks.read(project.id);
            const made = asks.add(kept, body, me, project, blob);
            await asks.write(project.id, kept);

            // Whoever it is for. A request to the room is for everybody on it
            // except the person who wrote it, and a request to one person is
            // for that person: the bell is how they find out at all.
            const told = made.toId
                ? [made.toId]
                : (project.memberIds || []).filter(id => id !== me.id);

            await Promise.all(told.map(id => feed.push({
                kind: 'ask',
                actorId: me.id,
                toId: id,
                projectId: project.id,
                text: feed.excerpt(made.title)
            })));

            return res.status(200).json({ ask: asks.out(made, doc, me) });
        }

        if (req.method === 'POST') {
            if (doc.projects.length >= MAX_PROJECTS) throw new Error('too-many-projects');

            const body = readBody(req);
            const name = text(body.name, MAX_NAME);
            if (!name) throw new Error('bad-name');
            if (body.icon && !blob.isOurImage(body.icon)) throw new Error('bad-image');

            const project = {
                id: accounts.newId('prj'),
                name,
                icon: body.icon || null,
                memberIds: membersFrom(doc, body.memberIds, me.id),
                by: me.id,
                createdAt: new Date().toISOString()
            };

            doc.projects.push(project);
            await accounts.writeAccounts(doc);
            return res.status(200).json({ project: projectOut(project, doc, me) });
        }

        if (req.method === 'PATCH' && readBody(req).kind === 'ask') {
            const body = readBody(req);
            const project = accounts.findProject(doc, text(body.project, 40));
            if (!accounts.canViewProject(me, project)) {
                return res.status(404).json({ error: 'no-such-project' });
            }

            const kept = await asks.read(project.id);
            const ask = kept.asks.find(one => one.id === text(body.id, 40));
            if (!ask || !asks.mayRead(ask, me)) return res.status(404).json({ error: 'no-such-ask' });

            const told = [];
            const tell = (id) => { if (id && id !== me.id) told.push(id); };

            if (body.action === 'seen') {
                asks.looked(ask, me);
            } else if (body.action === 'reply') {
                asks.reply(ask, body, me);
                // Whoever asked hears about every answer. On a request between
                // two people the other one hears too, whichever of them wrote.
                tell(ask.by);
                tell(ask.toId);
            } else if (body.action === 'got') {
                asks.got(ask, me);
                tell(ask.by);
            } else if (body.action === 'close' || body.action === 'open') {
                if (!asks.mine(ask, me)) return res.status(403).json({ error: 'not-allowed' });
                const dropped = asks.shut(ask, body.action === 'close');
                // Best effort: a picture left behind costs storage, a failed
                // save costs the thing somebody asked for.
                if (dropped.length) {
                    try { await blob.client(req).del(dropped); } catch { /* litter */ }
                }
            } else {
                return res.status(400).json({ error: 'bad-action' });
            }

            await asks.write(project.id, kept);

            await Promise.all(Array.from(new Set(told)).map(id => feed.push({
                kind: body.action === 'got' ? 'ask-got' : 'ask-back',
                actorId: me.id,
                toId: id,
                projectId: project.id,
                text: feed.excerpt(ask.title)
            })));

            return res.status(200).json({ ask: asks.out(ask, doc, me) });
        }

        if (req.method === 'PATCH') {
            const body = readBody(req);
            const project = accounts.findProject(doc, text(body.id, 40));
            if (!project) return res.status(404).json({ error: 'no-such-project' });
            if (!accounts.canRunProject(me, project)) return res.status(403).json({ error: 'not-allowed' });

            if (body.name !== undefined) {
                const name = text(body.name, MAX_NAME);
                if (!name) throw new Error('bad-name');
                project.name = name;
            }

            if (body.icon !== undefined) {
                if (body.icon && !blob.isOurImage(body.icon)) throw new Error('bad-image');
                project.icon = body.icon || null;
            }

            // Whoever started it stays on it, whatever the list says.
            if (body.memberIds !== undefined) {
                project.memberIds = membersFrom(doc, body.memberIds, project.by || me.id);
            }

            await accounts.writeAccounts(doc);
            return res.status(200).json({ project: projectOut(project, doc, me) });
        }

        if (req.method === 'DELETE' && (req.query || {}).kind === 'ask') {
            const project = accounts.findProject(doc, text(req.query.project, 40));
            if (!accounts.canViewProject(me, project)) {
                return res.status(404).json({ error: 'no-such-project' });
            }

            const kept = await asks.read(project.id);
            const gone = kept.asks.find(one => one.id === text(req.query.id, 40));
            if (!gone) return res.status(404).json({ error: 'no-such-ask' });

            // Whoever asked may unask. Not the person it was asked of: a
            // request that its recipient can make disappear is not a request.
            if (!asks.mine(gone, me) && me.role !== 'admin') {
                return res.status(403).json({ error: 'not-allowed' });
            }

            kept.asks = kept.asks.filter(one => one.id !== gone.id);
            await asks.write(project.id, kept);
            return res.status(200).json({ removed: gone.id });
        }

        if (req.method === 'DELETE') {
            const project = accounts.findProject(doc, text(req.query && req.query.id, 40));
            if (!project) return res.status(404).json({ error: 'no-such-project' });
            if (!accounts.canRunProject(me, project)) return res.status(403).json({ error: 'not-allowed' });

            doc.projects = doc.projects.filter(one => one.id !== project.id);
            await accounts.writeAccounts(doc);
            // The room goes and everything asked inside it goes with it. There
            // is nowhere left for it to be read from.
            await asks.forget(project.id);
            return res.status(200).json({ removed: project.id });
        }

        res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
        return res.status(405).json({ error: 'Method not allowed.' });
    } catch (err) {
        const known = ['bad-name', 'bad-image', 'bad-link', 'bad-action', 'ask-closed',
                       'no-such-project', 'no-such-ask', 'not-a-member', 'not-allowed',
                       'too-many-projects', 'too-many-asks', 'too-many-replies'];
        const status = err.message === 'not-allowed' ? 403
            : known.includes(err.message) ? 400 : 500;
        return res.status(status).json({ error: err.message });
    }
};
