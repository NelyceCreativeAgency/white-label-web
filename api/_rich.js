// What a note is allowed to look like.
//
// A brainstorming note is written by one account and read by everybody else on
// the project, so what comes out of the box it was typed in is markup that one
// person chose and another person's browser will run. Everything here exists to
// make sure the second half of that sentence is not true.
//
// The rule is a list of what may stay rather than a list of what must go. A tag
// that is not named below is written out as the text it looked like, an
// attribute that is not named is dropped, and a value that is not one of the
// handful spelled out is dropped with it. There is no way to reach a script, a
// url, an event handler or a stylesheet from in here, because none of those are
// on the list.
const TAGS = new Set([
    'b', 'strong', 'i', 'em', 'u', 's', 'strike',
    'br', 'div', 'p', 'ul', 'ol', 'li', 'font'
]);

// Tags that stand alone. Anything else opened has to be closed, and this file
// closes whatever the browser left open.
const ALONE = new Set(['br']);

// The seven sizes the old font tag understands, which is what every browser
// still writes when it is asked to make text bigger without a stylesheet.
const SIZES = new Set(['1', '2', '3', '4', '5', '6', '7']);

// Spelled out rather than matched: a colour is one of these or it is nothing.
const COLOURS = new Set([
    '#ffffff', '#b8babe', '#e8894a', '#e0648a',
    '#5bb98c', '#5b9fe0', '#a07ae0', '#d9a441'
]);

const FACES = new Set(['Geologica', 'Georgia', 'Courier New']);

// An ampersand that already begins an entity is left alone, so text that was
// escaped once does not come back escaped twice.
const ENTITY = /&(?!(?:[a-zA-Z][a-zA-Z0-9]{1,8}|#\d{1,7}|#[xX][0-9a-fA-F]{1,6});)/g;

const escape = (raw) => String(raw)
    .replace(ENTITY, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

// The value of one attribute, quoted or not. Only ever asked for by name, and
// only for the three names below.
const attribute = (inside, name) => {
    const found = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(inside);
    if (!found) return null;
    return (found[2] !== undefined ? found[2] : found[3] !== undefined ? found[3] : found[4] || '').trim();
};

const fontAttributes = (inside) => {
    const out = [];

    const size = attribute(inside, 'size');
    if (size && SIZES.has(size)) out.push(` size="${size}"`);

    const colour = attribute(inside, 'color');
    if (colour && COLOURS.has(colour.toLowerCase())) out.push(` color="${colour.toLowerCase()}"`);

    // A browser writes the face back with whatever fallbacks were asked for, so
    // the first name is the one that is checked and the one that is kept.
    const face = attribute(inside, 'face');
    const first = face ? face.split(',')[0].trim().replace(/^["']|["']$/g, '') : '';
    if (first && FACES.has(first)) out.push(` face="${first}"`);

    return out.join('');
};

const TAG = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

exports.clean = (raw, limit) => {
    const said = String(raw == null ? '' : raw).slice(0, limit);

    const out = [];
    const open = [];
    let at = 0;
    let found;

    TAG.lastIndex = 0;

    while ((found = TAG.exec(said)) !== null) {
        out.push(escape(said.slice(at, found.index)));
        at = found.index + found[0].length;

        const name = found[1].toLowerCase();
        const closing = found[0][1] === '/';

        // Not on the list: it goes out as the text somebody typed, which is
        // also the right answer for a note that says "a < b".
        if (!TAGS.has(name)) { out.push(escape(found[0])); continue; }

        if (ALONE.has(name)) { if (!closing) out.push(`<${name}>`); continue; }

        if (closing) {
            // A closing tag for something that was never opened closes nothing.
            const which = open.lastIndexOf(name);
            if (which < 0) continue;

            // And one that closes something inside it closes that too, so the
            // markup that comes out is always balanced.
            while (open.length > which) out.push(`</${open.pop()}>`);
            continue;
        }

        open.push(name);
        out.push(`<${name}${name === 'font' ? fontAttributes(found[2]) : ''}>`);
    }

    out.push(escape(said.slice(at)));
    while (open.length) out.push(`</${open.pop()}>`);

    return out.join('').trim();
};

// What a note says, with none of how it says it: for the line in the bell and
// for anywhere else a note has to be one plain sentence.
exports.plain = (raw) => String(raw == null ? '' : raw)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|ul|ol)>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
