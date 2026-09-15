// Vercel Blob over its plain HTTP API.
//
// The @vercel/blob package is a convenience wrapper around these same three
// requests, and pulling it in would give the site its first npm dependency and
// a build step to go with it. What it does is: PUT the bytes with the store's
// credentials, and POST a list of urls to delete them again.
//
// There are two ways to hold those credentials, and a store connected from the
// dashboard may hand out either:
//
//   OIDC       BLOB_STORE_ID names the store, and every request into a function
//              carries a short-lived token that Vercel rotates on its own. This
//              is what a store connected today uses, and what Vercel prefers.
//   read-write BLOB_READ_WRITE_TOKEN is one long-lived token that names the
//              store inside itself. Needed outside Vercel, and still handed out
//              when the connection is made with that box ticked.
//
// The long-lived token wins when both are present, because a token that was
// deliberately created is a deliberate choice.
const API = 'https://vercel.com/api/blob';
const API_VERSION = '12';

const MISSING = 'No image store is connected to this deployment.';

// The token the platform issues for this invocation. It arrives as a request
// header, and as an environment variable for code that has no request in hand.
const oidcToken = (req) =>
    (req && req.headers && req.headers['x-vercel-oidc-token']) ||
    process.env.VERCEL_OIDC_TOKEN ||
    null;

// A read-write token reads vercel_blob_rw_<storeId>_<random>, and the API wants
// the store named in a header of its own as well as in the token.
const credentials = (req) => {
    const readWrite = process.env.BLOB_READ_WRITE_TOKEN;
    if (readWrite) {
        const storeId = readWrite.split('_')[3];
        if (!storeId) throw new Error('BLOB_READ_WRITE_TOKEN is not a store token.');
        return { token: readWrite, storeId, kind: 'read-write token' };
    }

    const token = oidcToken(req);
    const store = process.env.BLOB_STORE_ID;
    if (token && store) {
        return { token, storeId: store.replace(/^store_/, ''), kind: 'OIDC' };
    }

    throw new Error(MISSING);
};

// Everything below is bound to one request, so that the OIDC token travelling
// with it is the one used.
exports.client = (req) => {
    const headers = () => {
        const { token, storeId } = credentials(req);
        return {
            authorization: `Bearer ${token}`,
            'x-api-version': API_VERSION,
            'x-vercel-blob-store-id': storeId
        };
    };

    const fail = async (res) => {
        let message = `Image store returned ${res.status}.`;
        try {
            const body = await res.json();
            if (body && body.error && body.error.message) message = body.error.message;
        } catch { /* the status is all there is */ }
        throw new Error(message);
    };

    return {
        // Which of the two ways this deployment is holding its credentials, or
        // null when it holds none. Only the health check asks.
        how() {
            try { return credentials(req).kind; }
            catch { return null; }
        },

        // Uploads bytes and hands back the public url they now live at. The
        // random suffix is what keeps two people uploading cover.jpg on the
        // same day from overwriting each other.
        async put(pathname, body, contentType) {
            const res = await fetch(`${API}/?pathname=${encodeURIComponent(pathname)}`, {
                method: 'PUT',
                headers: {
                    ...headers(),
                    'x-vercel-blob-access': 'public',
                    'x-content-type': contentType,
                    'x-add-random-suffix': '1',
                    // The url is unique per upload and its bytes never change,
                    // so it can be cached for as long as the browser likes.
                    'x-cache-control-max-age': '31536000'
                },
                body
            });
            if (!res.ok) await fail(res);

            const data = await res.json();
            return { url: data.url, pathname: data.pathname };
        },

        // Deleting is best-effort by design: a post is gone from the grid the
        // moment its document is written, and a picture left behind in the
        // store is litter, not a bug the visitor should be told about.
        async del(urls) {
            const list = (Array.isArray(urls) ? urls : [urls]).filter(Boolean);
            if (!list.length) return;

            const res = await fetch(`${API}/delete`, {
                method: 'POST',
                headers: { ...headers(), 'content-type': 'application/json' },
                body: JSON.stringify({ urls: list })
            });
            if (!res.ok) await fail(res);
        }
    };
};
