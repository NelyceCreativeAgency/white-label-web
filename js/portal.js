// Client portal — quote builder.
// Pricing rule (mirrors js/customize.js):
//   total = (basePrice + per-unit extras) * units + flat extras, then floored.
document.addEventListener('DOMContentLoaded', () => {

    const VAT_RATE = 0.24;
    const INSTALMENT_THRESHOLD = 2500;

    const state = {
        market: 'GR',        // GR = 24% VAT, INT = 0% (reverse charge)
        activeCat: null,   // null = the category screen
        openService: null,   // service id whose configurator is open
        values: {},          // serviceId -> { paramKey: value }
        cart: []             // [{ id, total, summary }]
    };

    // The header owns language and currency; this page follows them.
    const lang = () => document.documentElement.getAttribute('data-lang') || 'el';
    const t = (obj) => (obj && (obj[lang()] || obj.el)) || '';

    const rate = () => (window.CURRENCY ? window.CURRENCY.rate : 1);
    const money = (n) => window.formatCurrencyAmount
        ? window.formatCurrencyAmount(n * rate())
        : Math.round(n) + '\u20ac';

    // UI chrome that is not part of the service data
    const UI = {
        from:       { el: 'από',                     en: 'from' },
        configure:  { el: 'Διαμόρφωση & τιμή',       en: 'Configure & price' },
        close:      { el: 'Κλείσιμο',                en: 'Close' },
        perUnit:    { el: '/ μονάδα',                en: '/ unit' },
        oneOff:     { el: 'εφάπαξ',                  en: 'one-off' },
        included:   { el: 'περιλαμβάνεται',          en: 'included' },
        total:      { el: 'Σύνολο',                  en: 'Total' },
        netNote:    { el: 'προ ΦΠΑ',                 en: 'excl. VAT' },
        floor:      { el: 'Ελάχιστη χρέωση έργου:',  en: 'Project minimum:' },
        add:        { el: 'Προσθήκη στην προσφορά',  en: 'Add to quote' },
        added:      { el: 'Στην προσφορά',           en: 'In your quote' },
        quote:      { el: 'Η προσφορά σου',          en: 'Your quote' },
        empty:      { el: 'Διάλεξε υπηρεσίες για να δεις το σύνολο.',
                      en: 'Pick services to see the total.' },
        subtotal:   { el: 'Υποσύνολο',               en: 'Subtotal' },
        vat:        { el: 'ΦΠΑ',                     en: 'VAT' },
        reverse:    { el: '0% — reverse charge',     en: '0% — reverse charge' },
        schedule:   { el: 'Πρόγραμμα πληρωμών',      en: 'Payment schedule' },
        deposit:    { el: 'προκαταβολή',             en: 'deposit' },
        onDesign:   { el: 'στο design',              en: 'on design' },
        onDelivery: { el: 'στην παράδοση',           en: 'on delivery' },
        send:       { el: 'Στείλε μου την προσφορά', en: 'Send me this quote' },
        disclaimer: { el: 'Εκτίμηση, όχι δεσμευτική προσφορά.',
                      en: 'An estimate, not a binding quote.' },
        remove:     { el: 'Αφαίρεση',                en: 'Remove' },
        pickCat:    { el: 'Διάλεξε κατηγορία',       en: 'Choose a category' },
        allCats:    { el: 'Όλες οι κατηγορίες',      en: 'All categories' },
        oneService: { el: 'υπηρεσία',                en: 'service' },
        nServices:  { el: 'υπηρεσίες',               en: 'services' }
    };
    const u = (key) => t(UI[key]);

    const svc = (id) => PORTAL_SERVICES.find(s => s.id === id);

    // --- pricing ----------------------------------------------------------
    const visibleParams = (service) =>
        service.params.filter(p => !p.market || p.market === state.market);

    const defaults = (service) => {
        const v = {};
        visibleParams(service).forEach(p => {
            v[p.key] = p.type === 'stepper' ? p.default
                     : p.type === 'toggle'  ? false
                     : 0;
        });
        return v;
    };

    const valuesFor = (service) => {
        if (!state.values[service.id]) state.values[service.id] = defaults(service);
        return state.values[service.id];
    };

    const price = (service) => {
        const vals = valuesFor(service);
        let units = 1, perUnit = 0, flat = 0;

        visibleParams(service).forEach(p => {
            const val = vals[p.key];
            const add = (amount) => { if (p.scope === 'flat') flat += amount; else perUnit += amount; };

            if (p.type === 'stepper') {
                if (p.role === 'multiplier') units = val;
                else add((val - (p.baseline || 0)) * p.pricePerUnit);
            } else if (p.type === 'toggle') {
                if (val) add(p.price);
            } else if (p.type === 'select') {
                add(p.options[val].price);
            }
        });

        const raw = (service.basePrice + perUnit) * units + flat;
        const total = Math.max(raw, service.floorPrice || 0);
        return { raw, total, floored: total > raw, units };
    };

    // --- rendering: categories & services ---------------------------------
    const catNav = document.getElementById('cat-nav');
    const grid = document.getElementById('service-grid');

    const countIn = (catId) => PORTAL_SERVICES.filter(s => s.category === catId).length;

    const renderCats = () => {
        // Landing view: the four categories and nothing else.
        if (!state.activeCat) {
            catNav.innerHTML = `
                <div class="cat-list">
                    ${PORTAL_CATEGORIES.map((c, i) => {
                        const n = countIn(c.id);
                        return `
                        <button class="cat-row" data-cat="${c.id}">
                            <span class="cat-num">${String(i + 1).padStart(2, '0')}</span>
                            <img class="cat-icon" src="${c.icon}" alt="" width="30" height="30" loading="lazy">
                            <span class="cat-text">
                                <span class="cat-name">${t(c.intent)}</span>
                                <span class="cat-line">${t(c.label)}</span>
                                <span class="cat-blurb">${t(c.blurb)}</span>
                            </span>
                            <span class="cat-count">${n} ${n === 1 ? u('oneService') : u('nServices')}</span>
                            <span class="cat-go" aria-hidden="true">→</span>
                        </button>`;
                    }).join('')}
                </div>`;
            return;
        }

        // Drilled in: a way back, plus which category you are in.
        const c = PORTAL_CATEGORIES.find(x => x.id === state.activeCat);
        catNav.innerHTML = `
            <div class="cat-bar">
                <button type="button" class="cat-back" data-cat="">
                    <span aria-hidden="true">←</span> ${u('allCats')}
                </button>
                <span class="cat-current">
                    <img class="cat-icon" src="${c.icon}" alt="" width="26" height="26">
                    <strong>${t(c.label)}</strong>
                </span>
            </div>`;
    };

    const paramControl = (service, p) => {
        const vals = valuesFor(service);
        const val = vals[p.key];
        const id = `${service.id}--${p.key}`;

        if (p.type === 'stepper') {
            const delta = p.role === 'multiplier' ? '' :
                p.pricePerUnit ? `<span class="param-rate">+${money(p.pricePerUnit)} ${u('perUnit')}</span>` : '';
            return `
                <div class="param param-stepper">
                    <label class="param-label" for="${id}">${t(p.label)}${delta}</label>
                    <div class="stepper">
                        <button type="button" class="step-btn" data-step="-1" data-param="${p.key}" aria-label="−">−</button>
                        <output id="${id}" class="step-value">${val}</output>
                        <button type="button" class="step-btn" data-step="1" data-param="${p.key}" aria-label="+">+</button>
                    </div>
                </div>`;
        }

        if (p.type === 'toggle') {
            return `
                <label class="param param-toggle" for="${id}">
                    <span class="param-label">${t(p.label)}
                        <span class="param-rate">+${money(p.price)}${p.scope === 'flat' ? ' ' + u('oneOff') : ''}</span>
                    </span>
                    <input type="checkbox" id="${id}" class="toggle-input" data-param="${p.key}" ${val ? 'checked' : ''}>
                    <span class="toggle-track"><span class="toggle-knob"></span></span>
                </label>`;
        }

        return `
            <div class="param param-select">
                <span class="param-label">${t(p.label)}</span>
                <div class="option-list">
                    ${p.options.map((o, i) => `
                        <label class="option${i === val ? ' is-active' : ''}">
                            <input type="radio" name="${id}" data-param="${p.key}" value="${i}" ${i === val ? 'checked' : ''}>
                            <span class="option-body">
                                <strong>${t(o.label)}</strong>
                                ${o.note ? `<small>${t(o.note)}</small>` : ''}
                            </span>
                            <span class="option-price">${o.price ? '+' + money(o.price) : u('included')}</span>
                        </label>`).join('')}
                </div>
            </div>`;
    };

    const renderGrid = () => {
        if (!state.activeCat) { grid.innerHTML = ''; return; }
        const list = PORTAL_SERVICES.filter(s => s.category === state.activeCat);

        grid.innerHTML = list.map(s => {
            const open = state.openService === s.id;
            const { total, floored } = price(s);
            const inCart = state.cart.some(c => c.id === s.id);

            return `
            <article class="svc-card${open ? ' is-open' : ''}" data-svc="${s.id}">
                <header class="svc-head">
                    <div class="svc-title">
                        <h3>${t(s.name)}</h3>
                        <p>${t(s.desc)}</p>
                    </div>
                    <div class="svc-price">
                        <span class="svc-from">${u('from')}</span>
                        <span class="svc-amount">${money(s.basePrice)}</span>
                        ${s.unit ? `<span class="svc-unit">${t(s.unit)}</span>` : ''}
                    </div>
                </header>

                <button type="button" class="svc-toggle" data-toggle="${s.id}">
                    ${open ? u('close') : u('configure')}
                    <span class="chev">${open ? '▲' : '▼'}</span>
                </button>

                ${open ? `
                <div class="svc-config">
                    ${visibleParams(s).map(p => paramControl(s, p)).join('')}

                    <div class="svc-total">
                        <div class="svc-total-row">
                            <span>${u('total')} <small>(${u('netNote')})</small></span>
                            <strong>${money(total)}</strong>
                        </div>
                        ${floored ? `<p class="floor-note">${u('floor')} ${money(s.floorPrice)}</p>` : ''}
                        <button type="button" class="add-btn${inCart ? ' is-added' : ''}" data-add="${s.id}">
                            ${inCart ? '\u2713 ' + u('added') : u('add')}
                        </button>
                    </div>
                </div>` : ''}
            </article>`;
        }).join('');
    };

    // --- rendering: quote summary -----------------------------------------
    const summaryEl = document.getElementById('quote-summary');

    const renderSummary = () => {
        if (!state.cart.length) {
            summaryEl.innerHTML = `
                <h2>${u('quote')}</h2>
                <p class="empty">${u('empty')}</p>`;
            return;
        }

        const net = state.cart.reduce((sum, c) => sum + c.total, 0);
        const vat = state.market === 'GR' ? net * VAT_RATE : 0;
        const gross = net + vat;

        summaryEl.innerHTML = `
            <h2>${u('quote')}</h2>
            <ul class="quote-lines">
                ${state.cart.map(c => `
                    <li>
                        <span class="line-name">${t(svc(c.id).name)}</span>
                        <span class="line-price">${money(c.total)}</span>
                        <button type="button" class="line-remove" data-remove="${c.id}" aria-label="${u('remove')}">×</button>
                    </li>`).join('')}
            </ul>

            <div class="quote-totals">
                <div class="qt-row"><span>${u('subtotal')}</span><span>${money(net)}</span></div>
                <div class="qt-row"><span>${u('vat')} ${state.market === 'GR' ? '24%' : u('reverse')}</span><span>${money(vat)}</span></div>
                <div class="qt-row qt-total"><span>${u('total')}</span><span>${money(gross)}</span></div>
            </div>

            ${net >= INSTALMENT_THRESHOLD ? `
                <div class="instalments">
                    <strong>${u('schedule')}</strong>
                    <p>40% ${u('deposit')} ${money(gross * 0.4)} · 30% ${u('onDesign')} ${money(gross * 0.3)} · 30% ${u('onDelivery')} ${money(gross * 0.3)}</p>
                </div>` : ''}

            <button type="button" class="portal-cta">${u('send')}</button>
            <p class="disclaimer">${u('disclaimer')}</p>`;
    };

    // --- events ------------------------------------------------------------
    catNav.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-cat]');
        if (!btn) return;
        state.activeCat = btn.dataset.cat || null;
        state.openService = null;
        renderCats(); renderGrid(); layout();
        if (!state.activeCat) window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    grid.addEventListener('click', (e) => {
        const toggle = e.target.closest('[data-toggle]');
        if (toggle) {
            state.openService = state.openService === toggle.dataset.toggle ? null : toggle.dataset.toggle;
            return renderGrid();
        }

        const step = e.target.closest('[data-step]');
        if (step) {
            const service = svc(step.closest('[data-svc]').dataset.svc);
            const p = service.params.find(x => x.key === step.dataset.param);
            const vals = valuesFor(service);
            const next = vals[p.key] + Number(step.dataset.step) * (p.step || 1);
            vals[p.key] = Math.min(p.max, Math.max(p.min, next));
            syncCart(service);
            return renderGrid();
        }

        const add = e.target.closest('[data-add]');
        if (add) {
            const service = svc(add.dataset.add);
            const existing = state.cart.findIndex(c => c.id === service.id);
            if (existing > -1) state.cart.splice(existing, 1);
            else state.cart.push({ id: service.id, total: price(service).total });
            renderGrid(); renderSummary(); layout();
        }
    });

    grid.addEventListener('change', (e) => {
        const input = e.target.closest('[data-param]');
        if (!input) return;
        const service = svc(input.closest('[data-svc]').dataset.svc);
        const vals = valuesFor(service);
        vals[input.dataset.param] = input.type === 'checkbox' ? input.checked : Number(input.value);
        syncCart(service);
        renderGrid();
    });

    summaryEl.addEventListener('click', (e) => {
        const rm = e.target.closest('[data-remove]');
        if (!rm) return;
        state.cart = state.cart.filter(c => c.id !== rm.dataset.remove);
        renderGrid(); renderSummary(); layout();
    });

    const syncCart = (service) => {
        const line = state.cart.find(c => c.id === service.id);
        if (line) line.total = price(service).total;
        renderSummary();
    };

    document.getElementById('market-toggle').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-market]');
        if (!btn) return;
        state.market = btn.dataset.market;
        document.querySelectorAll('#market-toggle [data-market]')
            .forEach(b => b.classList.toggle('is-active', b.dataset.market === state.market));
        // market-specific params appear or vanish, so reset their stored values
        PORTAL_SERVICES.forEach(s => { delete state.values[s.id]; });
        state.cart.forEach(c => { c.total = price(svc(c.id)).total; });
        renderGrid(); renderSummary();
    });

    // On the category screen with an empty quote there is nothing to put in the
    // second column, so the catalogue takes the full width.
    const layout = () => {
        const body = document.querySelector('.portal-body');
        if (body) body.classList.toggle('is-browsing', !state.activeCat && !state.cart.length);
    };

    const renderAll = () => { renderCats(); renderGrid(); renderSummary(); layout(); };

    // The header's language switcher rewrites data-lang on <html>; the currency
    // dropdown fires 'currencychange'. Neither touches nodes rendered here, so
    // both need an explicit redraw.
    new MutationObserver(renderAll).observe(document.documentElement,
        { attributes: true, attributeFilter: ['data-lang'] });
    window.addEventListener('currencychange', renderAll);

    renderAll();
});
