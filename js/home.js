/* Home page: seamless project marquees.
 *
 * The markup carries each row's cards once. For the row to loop without a
 * visible gap the track has to be twice as wide as the window and slide by
 * exactly one group, so we clone the group here rather than duplicating a
 * screenful of markup by hand. The clone is decorative — screen readers and
 * keyboard tabbing only ever see the original set.
 *
 * `is-looping` is added last: until the clone is in place the CSS animation
 * would run the single group off the edge, so it stays off. With JS disabled
 * the row simply sits still, which is a fine fallback. */
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.marquee').forEach(marquee => {
        const track = marquee.querySelector('.marquee-track');
        const group = track && track.querySelector('.marquee-group');
        if (!group) return;

        const clone = group.cloneNode(true);
        clone.setAttribute('aria-hidden', 'true');
        clone.querySelectorAll('a').forEach(link => {
            link.setAttribute('tabindex', '-1');
        });
        track.appendChild(clone);

        marquee.classList.add('is-looping');
    });
});
