// A project: the team's own room, and who is in it.
//
// GET                          -> every project this account may open
// POST   { name, icon, memberIds } -> starts one
// PATCH  { id, ... }           -> renames it, repictures it, changes who is on it
// DELETE ?id=                  -> takes it away
//
// This is the room and not what is said in it. What gets asked and answered
// inside a project is kept per project, under its own key, and is the next
// thing along.
//
// A client never sees one. The portal a client signs into is their own account
// and the grids they have paid for; how the work between us is arranged is
// ours, and a room they cannot open is simpler than a room they can open and
// must then be careful in.
const accounts = require('./_accounts');
const blob = require('./_blob');

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

        if (req.method === 'GET') {
            return res.status(200).json({
                projects: accounts.projectsFor(doc, me).map(one => projectOut(one, doc, me)),
                // Everybody who could be put on one, so the panel can offer
                // them without a second request.
                people: doc.users
                    .filter(user => accounts.mayHaveProjects(user))
                    .map(user => accounts.publicUser(user))
            });
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

        if (req.method === 'DELETE') {
            const project = accounts.findProject(doc, text(req.query && req.query.id, 40));
            if (!project) return res.status(404).json({ error: 'no-such-project' });
            if (!accounts.canRunProject(me, project)) return res.status(403).json({ error: 'not-allowed' });

            doc.projects = doc.projects.filter(one => one.id !== project.id);
            await accounts.writeAccounts(doc);
            return res.status(200).json({ removed: project.id });
        }

        res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
        return res.status(405).json({ error: 'Method not allowed.' });
    } catch (err) {
        const known = ['bad-name', 'bad-image', 'no-such-project', 'not-allowed', 'too-many-projects'];
        const status = err.message === 'not-allowed' ? 403
            : known.includes(err.message) ? 400 : 500;
        return res.status(status).json({ error: err.message });
    }
};
