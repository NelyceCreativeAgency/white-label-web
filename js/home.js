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

/* The partnership paragraph: words sharpen as it is scrolled through.
 *
 * Each word gets a --t between 0 and 1 that CSS turns into opacity and blur. A
 * wave a few words wide runs along the paragraph, tied to how far it has
 * travelled through the viewport, so the effect follows scroll position rather
 * than a timer — scrubbing back up unreveals exactly what scrolling down
 * revealed. A highlighted promise lights as the last of its own words clears.
 *
 * The words are drawn into .pm-render from a separate .pm-src. The language
 * switcher rewrites the direct text of every [data-en] element and re-appends
 * its child elements afterwards, which would leave the word spans stranded
 * after the freshly inserted sentence. Keeping the source untouched means a
 * language swap only needs a redraw, which is what the .lang-btn listener at
 * the bottom does — it runs after the switcher's own, both being click
 * handlers attached in DOM order. */
document.addEventListener('DOMContentLoaded', () => {
    const copy = document.getElementById('pm-copy');
    const source = copy && copy.querySelector('.pm-src');
    const out = copy && copy.querySelector('.pm-render');
    if (!copy || !source || !out) return;

    // How many words the wave is spread over. Lower is a harder edge.
    const SPREAD = 7;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)');

    let words = [];

    // A space belongs between two segments unless the next one opens with
    // punctuation that has to sit tight against the word before it.
    const joinsTight = (text) => /^[,.;:!?…)\]»]/.test(text);

    const build = () => {
        out.textContent = '';
        words = [];

        Array.from(source.children).forEach((segment, index) => {
            const text = segment.textContent.trim();
            if (!text) return;

            if (index > 0 && !joinsTight(text)) {
                out.appendChild(document.createTextNode(' '));
            }

            const isPromise = segment.tagName === 'MARK';
            const host = isPromise ? document.createElement('mark') : out;
            if (isPromise) host.className = 'pm-mark';

            text.split(/\s+/).forEach((word, i) => {
                if (i > 0) host.appendChild(document.createTextNode(' '));
                const span = document.createElement('span');
                span.className = 'pm-w';
                span.textContent = word;
                host.appendChild(span);
                words.push(span);
            });

            if (isPromise) out.appendChild(host);
        });

        copy.classList.add('is-split');
    };

    const setWord = (span, t) => {
        span.dataset.t = t.toFixed(3);
        span.style.setProperty('--t', t.toFixed(3));
        // A cleared word drops the blur filter rather than running it at zero.
        span.classList.toggle('is-clear', t >= 1);
    };

    // Where the wave is asked to be, from scroll position alone.
    const target = () => {
        const rect = copy.getBoundingClientRect();
        const vh = window.innerHeight;

        // 0 as the paragraph enters from the bottom, 1 by the time its middle
        // has reached the middle of the screen — measured on the centre rather
        // than the bottom edge, which is what used to leave the last words
        // still clearing well after the section had settled in view. Finishing
        // marginally past centre leaves the trail room to catch up exactly
        // there. The span scales with the paragraph, so a longer one is not
        // read through any faster.
        const from = vh * 0.9;
        const to = vh * 0.6 - rect.height / 2;
        const progress = Math.min(1, Math.max(0, (from - rect.top) / (from - to)));
        return progress * (words.length + SPREAD);
    };

    // Where it actually is. The wave chases the scroll instead of being pinned
    // to it, so it trails slightly and keeps catching up for a moment after
    // scrolling stops — the weight these reveals have on the sites this is
    // modelled on. TRAIL is the time constant: higher lags further behind.
    const TRAIL = 0.26;
    let head = 0;
    let last = 0;

    const paint = (now) => {
        const wanted = target();

        if (!last) {
            head = wanted;
        } else {
            // Framerate-independent easing, so a 120Hz screen trails the same
            // distance as a 60Hz one rather than catching up twice as fast.
            const dt = Math.min(0.05, (now - last) / 1000);
            head += (wanted - head) * (1 - Math.exp(-dt / TRAIL));
        }
        last = now;

        words.forEach((span, i) => {
            const t = Math.min(1, Math.max(0, (head - i) / SPREAD));
            const was = parseFloat(span.dataset.t || '0');
            // Repainting an unchanged word costs a style recalc for nothing.
            if (Math.abs(t - was) < 0.004) return;
            setWord(span, t);
        });

        // The promises wait for the whole paragraph rather than lighting as the
        // wave passes over each of them: the sentence is read first, then what
        // matters in it is picked out.
    };

    const settle = () => {
        words.forEach(span => setWord(span, 1));
    };

    // Drop the trail across a redraw or a spell out of view, so the paragraph
    // is never caught mid-chase from a stale position.
    const snap = () => { last = 0; };

    let visible = false;
    let ticking = false;

    const frame = (now) => {
        if (!visible) {
            ticking = false;
            snap();
            return;
        }
        paint(now);
        requestAnimationFrame(frame);
    };

    const rebuild = () => {
        build();
        snap();
        if (still.matches) settle();
        else paint(performance.now());
    };

    rebuild();

    if (!still.matches) {
        // The loop only runs while the paragraph is anywhere near the viewport.
        new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                visible = entry.isIntersecting;
                if (visible && !ticking) {
                    ticking = true;
                    requestAnimationFrame(frame);
                }
            });
        }, { rootMargin: '150px 0px' }).observe(copy);
    }

    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.addEventListener('click', rebuild);
    });
});
