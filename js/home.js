/* Home page: seamless project marquees.
 *
 * The markup carries each row's cards once. To loop without a visible gap the
 * track has to be twice as wide as the window and slide by exactly one group,
 * so the group is cloned here rather than a screenful of markup being repeated
 * by hand. Rows that are short enough to run out on a wide monitor get their
 * cards repeated inside the group first, until the group alone covers the
 * viewport. Every copy is decorative — screen readers and keyboard tabbing
 * only ever see the original set.
 *
 * `is-looping` is added last: until the copies are in place the CSS animation
 * would run a single group off the edge, so it stays off. With JS disabled the
 * rows simply sit still, which is a fine fallback. */
document.addEventListener('DOMContentLoaded', () => {
    // Cards drift at a fixed speed rather than a fixed duration, so a short row
    // and a long one read as the same motion instead of one crawling.
    const PIXELS_PER_SECOND = 45;
    // Padding for a viewport wider than the one being used avoids having to
    // rebuild (and restart) the row every time the window is resized.
    const MIN_GROUP_WIDTH = 2200;

    const hide = (el) => {
        el.setAttribute('aria-hidden', 'true');
        el.querySelectorAll('a').forEach(link => link.setAttribute('tabindex', '-1'));
        if (el.tagName === 'A') el.setAttribute('tabindex', '-1');
    };

    document.querySelectorAll('.marquee').forEach(marquee => {
        const track = marquee.querySelector('.marquee-track');
        const group = track && track.querySelector('.marquee-group');
        if (!group || !group.children.length) return;

        const originals = Array.from(group.children);
        const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
        const target = Math.max(window.innerWidth, MIN_GROUP_WIDTH);

        let guard = 8; // never loop forever if a card somehow measures zero
        while (group.getBoundingClientRect().width < target && guard--) {
            originals.forEach(card => {
                const repeat = card.cloneNode(true);
                hide(repeat);
                group.appendChild(repeat);
            });
        }

        const clone = group.cloneNode(true);
        hide(clone);
        track.appendChild(clone);

        const distance = group.getBoundingClientRect().width + gap;
        marquee.style.setProperty('--marquee-duration', (distance / PIXELS_PER_SECOND).toFixed(1) + 's');
        marquee.classList.add('is-looping');
    });
});
