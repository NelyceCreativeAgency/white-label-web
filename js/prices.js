// The one place that knows how a stored price override lands on a service.
//
// Both the portal and the admin page read the same catalogue out of
// js/portal-data.js and the same overrides out of /api/prices; keeping the
// merge here is what stops the two from ever disagreeing about a figure.
window.NELYCE_PRICES = (function () {

    const ENDPOINT = '/api/prices';

    // The portal must render even when the API is unreachable — a store that is
    // down, a preview deploy without the env vars, or simply no override saved
    // yet. In every one of those cases the prices in the code are the answer.
    const fetchOverrides = async () => {
        try {
            const res = await fetch(ENDPOINT, { cache: 'no-store', credentials: 'same-origin' });
            if (!res.ok) return { services: {} };
            const data = await res.json();
            return (data && data.services) ? data : { services: {} };
        } catch {
            return { services: {} };
        }
    };

    // Mutates `services` in place. Only fields the override actually carries are
    // touched, so a service the admin has never opened keeps every code default.
    const apply = (services, overrides) => {
        const stored = (overrides && overrides.services) || {};

        services.forEach(service => {
            const patch = stored[service.id];
            if (!patch) return;

            if (typeof patch.basePrice  === 'number') service.basePrice  = patch.basePrice;
            if (typeof patch.floorPrice === 'number') service.floorPrice = patch.floorPrice;
            if (!patch.params) return;

            (service.params || []).forEach(param => {
                const p = patch.params[param.key];
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
        });

        return services;
    };

    return { fetchOverrides, apply, ENDPOINT };
})();
