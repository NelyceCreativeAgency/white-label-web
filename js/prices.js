// The one place that knows how a stored price override lands on a service.
//
// Two price lists are kept, deliberately apart:
//
//   site    the white-label partner pricing on index.html. Base prices are
//           written into the markup; the extras live in js/customize-data.js.
//   portal  the end-client quote builder on portal.html. Everything is in
//           js/portal-data.js.
//
// index.html, portal.html and admin.html all read the merge from here, which is
// what stops any two of them from disagreeing about a figure.
window.NELYCE_PRICES = (function () {

    const ENDPOINT = '/api/prices';
    const PRICE_SELECTOR = '.price-amount, .sub-price, .addon-value, .emb-value';

    const EMPTY = () => ({ site: { services: {} }, portal: { services: {} } });

    // Every page must render even when the API is unreachable — a store that is
    // down, a preview deploy without the env vars, or simply nothing saved yet.
    // In all of those the prices already in the code are the answer.
    const fetchOverrides = async () => {
        try {
            const res = await fetch(ENDPOINT, { cache: 'no-store', credentials: 'same-origin' });
            if (!res.ok) return EMPTY();
            const data = await res.json();
            const out = EMPTY();
            ['site', 'portal'].forEach(name => {
                if (data && data[name] && data[name].services) out[name].services = data[name].services;
            });
            return out;
        } catch {
            return EMPTY();
        }
    };

    // Shared by both lists: the parameter shapes are identical.
    const applyParams = (params, patch) => {
        if (!patch || !params) return;

        params.forEach(param => {
            const p = patch[param.key];
            if (!p) return;

            if (typeof p.price        === 'number') param.price        = p.price;
            if (typeof p.pricePerUnit === 'number') param.pricePerUnit = p.pricePerUnit;

            // Positional, and only trusted when the stored list still has one
            // entry per choice — the code may have gained or lost an option
            // since the override was written.
            if (Array.isArray(p.options) && Array.isArray(param.options)
                && p.options.length === param.options.length) {
                param.options.forEach((option, i) => { option.price = p.options[i]; });
            }
        });
    };

    // --- portal --------------------------------------------------------------
    // Mutates `services` in place. Only fields the override actually carries are
    // touched, so a service the admin has never opened keeps every code default.
    const applyPortal = (services, section) => {
        const stored = (section && section.services) || {};

        services.forEach(service => {
            const patch = stored[service.id];
            if (!patch) return;

            if (typeof patch.basePrice  === 'number') service.basePrice  = patch.basePrice;
            if (typeof patch.floorPrice === 'number') service.floorPrice = patch.floorPrice;

            applyParams(service.params, patch.params);
        });

        return services;
    };

    // --- white-label site ----------------------------------------------------
    // The price element belonging to a card, ignoring any price that sits inside
    // a nested service of its own.
    const priceElement = (container) =>
        Array.from(container.querySelectorAll(PRICE_SELECTOR))
            .find(el => el.closest('[data-service-id]') === container) || null;

    // currency.js keeps each element's pristine euro figure in dataset.eurAmount
    // and re-derives the display from it on every switch. Writing the new price
    // there is therefore the whole job: the conversion keeps working, and a
    // visitor who has already switched to GBP sees the new price in GBP.
    const applySiteBasePrice = (container, amount) => {
        const el = priceElement(container);
        if (!el) return;

        el.dataset.eurAmount = String(Math.round(amount));

        const unit = el.querySelector('.price-unit, .emb-unit');
        Array.from(el.childNodes).forEach(node => {
            if (node.nodeType === Node.TEXT_NODE) el.removeChild(node);
        });
        el.insertBefore(document.createTextNode(Math.round(amount) + '€'), el.firstChild);
        if (unit) el.appendChild(unit);

        // The element also feeds the EL/EN translation cache when it carries one.
        // Dropping the stale snapshot makes currency.js rebuild it from the new
        // figure rather than reinstating the old one on the next switch.
        delete el.dataset.origEn;
        delete el.dataset.origEl;
    };

    const applySite = (section, serviceParams) => {
        const stored = (section && section.services) || {};

        Object.keys(stored).forEach(id => {
            const patch = stored[id];

            const container = document.querySelector(`[data-service-id="${CSS.escape(id)}"]`);
            if (container && typeof patch.basePrice === 'number') {
                applySiteBasePrice(container, patch.basePrice);
            }

            if (serviceParams && serviceParams[id]) applyParams(serviceParams[id], patch.params);
        });

        // Re-render in whatever currency the visitor is on. When currency.js has
        // not started yet this is a no-op and it will pick the new figures up on
        // its own first pass.
        if (typeof window.applyCurrencyToPage === 'function') {
            window.applyCurrencyToPage(window.CURRENCY);
        }
    };

    return { fetchOverrides, applyPortal, applySite, applyParams, ENDPOINT, PRICE_SELECTOR };
})();
