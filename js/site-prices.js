// Applies the admin's white-label prices to index.html.
//
// The page ships with its prices written into the markup, which stays the
// source of truth and the fallback: this only moves a figure that has actually
// been overridden in admin.html, and does nothing at all when the API cannot be
// reached.
document.addEventListener('DOMContentLoaded', () => {
    if (!window.NELYCE_PRICES) return;

    window.NELYCE_PRICES.fetchOverrides().then(overrides => {
        // SERVICE_PARAMS is declared by js/customize-data.js as a plain script
        // global, so it is reachable by name but may be absent if that file
        // failed to load.
        const params = (typeof SERVICE_PARAMS !== 'undefined') ? SERVICE_PARAMS : null;
        window.NELYCE_PRICES.applySite(overrides.site, params);
    });
});
