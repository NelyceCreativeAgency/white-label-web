// Whether a client has ever paid for social media work.
//
// A grid is the social media work: the plan for a month of posts. Somebody who
// has never bought that has nothing to read on one, so they are not shown any,
// and the portal is their account and nothing else.
//
// Once is enough, and it lasts. A client who paid for a year of posts two years
// ago still owns what was made for them, and taking it away the day a
// subscription lapses would be taking away their own work to make a point about
// an invoice. So this asks whether it ever happened, not whether it is running.
//
// What counts as social media work is a mark on the subscription, put there by
// the admin. A subscription from before that mark existed counts: at the time
// it was written there was nothing else a subscription could have been about,
// and a rule that silently shuts a door on somebody who had it open yesterday
// is a bug however it is argued.
const store = require('./_store');

exports.isSocial = (sub) => sub.social !== false;

exports.everPaid = async (clientId) => {
    if (!clientId) return false;

    const doc = await store.readJson(store.moneyKey(clientId));
    if (!doc) return false;

    const subs = Array.isArray(doc.subs) ? doc.subs : [];
    const entries = Array.isArray(doc.entries) ? doc.entries : [];

    const social = new Set(subs.filter(exports.isSocial).map(sub => sub.id));
    if (!social.size) return false;

    // Paid, and against one of those subscriptions. A charge on its own, for a
    // logo or a one-off, is not a subscription to anything.
    return entries.some(entry => entry.status === 'paid' && social.has(entry.subId));
};
