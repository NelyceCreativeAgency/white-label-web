// Client portal — quote builder.
// Pricing rule (mirrors js/customize.js):
//   total = (basePrice + per-unit extras) * units + flat extras, then floored.
document.addEventListener('DOMContentLoaded', () => {

    const VAT_RATE = 0.24;
    const INSTALMENT_THRESHOLD = 2500;

    const state = {
        lang: 'el',
        market: 'GR',        // GR = 24% VAT, INT = 0% (reverse charge)
        activeCat: 'brand',
        openService: null,   // service id whose configurator is open
        values: {},          // serviceId -> { paramKey: value }
        cart: []             // [{ id, total, summary }]
    };

    const t = (obj) => (obj && (obj[state.lang] || obj.el)) || '';
    const money = (n) => new Intl.NumberFormat('el-GR', {
        style: 'currency', currency: 'EUR', maximumFractionDigits: 0
    }).format(Math.round(n));

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

    const renderCats = () => {
        catNav.innerHTML = PORTAL_CATEGORIES.map(c => `
            <button class="cat-tab${c.id === state.activeCat ? ' is-active' : ''}" data-cat="${c.id}">
                <span class="cat-icon">${c.icon}</span>
                <span class="cat-text">
                    <strong>${t(c.label)}</strong>
                    <small>${t(c.blurb)}</small>
                </span>
            </button>`).join('');
    };

    const paramControl = (service, p) => {
        const vals = valuesFor(service);
        const val = vals[p.key];
        const id = `${service.id}--${p.key}`;

        if (p.type === 'stepper') {
            const delta = p.role === 'multiplier' ? '' :
                p.pricePerUnit ? `<span class="param-rate">+${money(p.pricePerUnit)} / μονάδα</span>` : '';
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
                        <span class="param-rate">+${money(p.price)}${p.scope === 'flat' ? ' εφάπαξ' : ''}</span>
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
                            <span class="option-price">${o.price ? '+' + money(o.price) : 'incl.'}</span>
                        </label>`).join('')}
                </div>
            </div>`;
    };

    const renderGrid = () => {
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
                        <span class="svc-from">από</span>
                        <span class="svc-amount">${money(s.basePrice)}</span>
                        ${s.unit ? `<span class="svc-unit">${t(s.unit)}</span>` : ''}
                    </div>
                </header>

                <button type="button" class="svc-toggle" data-toggle="${s.id}">
                    ${open ? 'Κλείσιμο' : 'Διαμόρφωση & τιμή'}
                    <span class="chev">${open ? '▲' : '▼'}</span>
                </button>

                ${open ? `
                <div class="svc-config">
                    ${visibleParams(s).map(p => paramControl(s, p)).join('')}

                    <div class="svc-total">
                        <div class="svc-total-row">
                            <span>Σύνολο <small>(προ ΦΠΑ)</small></span>
                            <strong>${money(total)}</strong>
                        </div>
                        ${floored ? `<p class="floor-note">Ελάχιστη χρέωση έργου: ${money(s.floorPrice)}</p>` : ''}
                        <button type="button" class="add-btn${inCart ? ' is-added' : ''}" data-add="${s.id}">
                            ${inCart ? '✓ Στην προσφορά' : 'Προσθήκη στην προσφορά'}
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
                <h2>Η προσφορά σου</h2>
                <p class="empty">Διάλεξε υπηρεσίες για να δεις το σύνολο.</p>`;
            return;
        }

        const net = state.cart.reduce((sum, c) => sum + c.total, 0);
        const vat = state.market === 'GR' ? net * VAT_RATE : 0;
        const gross = net + vat;

        summaryEl.innerHTML = `
            <h2>Η προσφορά σου</h2>
            <ul class="quote-lines">
                ${state.cart.map(c => `
                    <li>
                        <span class="line-name">${t(svc(c.id).name)}</span>
                        <span class="line-price">${money(c.total)}</span>
                        <button type="button" class="line-remove" data-remove="${c.id}" aria-label="Αφαίρεση">×</button>
                    </li>`).join('')}
            </ul>

            <div class="quote-totals">
                <div class="qt-row"><span>Υποσύνολο</span><span>${money(net)}</span></div>
                <div class="qt-row"><span>ΦΠΑ ${state.market === 'GR' ? '24%' : '0% — reverse charge'}</span><span>${money(vat)}</span></div>
                <div class="qt-row qt-total"><span>Σύνολο</span><span>${money(gross)}</span></div>
            </div>

            ${net >= INSTALMENT_THRESHOLD ? `
                <div class="instalments">
                    <strong>Πρόγραμμα πληρωμών</strong>
                    <p>40% προκαταβολή ${money(gross * 0.4)} · 30% στο design ${money(gross * 0.3)} · 30% στην παράδοση ${money(gross * 0.3)}</p>
                </div>` : ''}

            <button type="button" class="cta">Στείλε μου την προσφορά</button>
            <p class="disclaimer">Εκτίμηση, όχι δεσμευτική προσφορά.</p>`;
    };

    // --- events ------------------------------------------------------------
    catNav.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-cat]');
        if (!btn) return;
        state.activeCat = btn.dataset.cat;
        state.openService = null;
        renderCats(); renderGrid();
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
            renderGrid(); renderSummary();
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
        renderGrid(); renderSummary();
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

    renderCats(); renderGrid(); renderSummary();
});
