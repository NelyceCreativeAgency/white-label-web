// Vercel Blob over its plain HTTP API.
//
// The @vercel/blob package is a convenience wrapper around these same three
// requests, and pulling it in would give the site its first npm dependency and
// a build step to go with it. What it does is: PUT the bytes with the store's
// token, and POST a list of urls to delete them again.
//
// Connect the store from the Vercel dashboard (Storage -> Blob) and the token
// arrives as BLOB_READ_WRITE_TOKEN on its own.
const API = 'https://vercel.com/api/blob';
const API_VERSION = '12';

// A read-write token reads vercel_blob_rw_<storeId>_<random>, and the API wants
// the store named in a header of its own as well as in the token.
const credentials = () => {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) throw new Error('No image store is connected to this deployment.');

    const storeId = token.split('_')[3];
    if (!storeId) throw new Error('BLOB_READ_WRITE_TOKEN is not a store token.');

    return { token, storeId };
};

exports.isConfigured = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

const headers = () => {
    const { token, storeId } = credentials();
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

// Uploads bytes and hands back the public url they now live at. The random
// suffix is what keeps two people uploading cover.jpg on the same day from
// overwriting each other.
exports.put = async (pathname, body, contentType) => {
    const res = await fetch(`${API}/?pathname=${encodeURIComponent(pathname)}`, {
        method: 'PUT',
        headers: {
            ...headers(),
            'x-vercel-blob-access': 'public',
            'x-content-type': contentType,
            'x-add-random-suffix': '1',
            // The url is unique per upload and its bytes never change, so it
            // can be cached for as long as the browser cares to keep it.
            'x-cache-control-max-age': '31536000'
        },
        body
    });
    if (!res.ok) await fail(res);

    const data = await res.json();
    return { url: data.url, pathname: data.pathname };
};

// Deleting is best-effort by design: a post is gone from the grid the moment
// its document is written, and a picture left behind in the store is litter,
// not a bug the visitor should be told about.
exports.del = async (urls) => {
    const list = (Array.isArray(urls) ? urls : [urls]).filter(Boolean);
    if (!list.length) return;

    const res = await fetch(`${API}/delete`, {
        method: 'POST',
        headers: { ...headers(), 'content-type': 'application/json' },
        body: JSON.stringify({ urls: list })
    });
    if (!res.ok) await fail(res);
};
