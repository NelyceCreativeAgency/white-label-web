// Pricing admin — two lists, kept deliberately apart.
//
//   site    the white-label partner prices. Base prices are read straight out
//           of index.html, which stays their single source of truth, and the
//           extras come from js/customize-data.js.
//   portal  the end-client quote builder, entirely in js/portal-data.js.
//
// Nothing is copied into this page: both catalogues are read from where they
// already live, so the admin cannot drift from what the sites actually show.
// Each figure knows three things about itself — the number in the code, the
// number currently saved, and what is in the box right now. Those drive the
// orange dot, the reset arrow and the Save button.
document.addEventListener('DOMContentLoaded', () => {

    const gate       = document.getElementById('admin-gate');
    const gateForm   = document.getElementById('gate-form');
    const gatePass   = document.getElementById('gate-password');
    const gateError  = document.getElementById('gate-error');
    const gateSubmit = document.getElementById('gate-submit');

    const shell   = document.getElementById('admin-shell');
    const tabsNav = document.getElementById('admin-tabs');
    const list    = document.getElementById('admin-services');
    const filter  = document.getElementById('admin-filter');
    const empty   = document.getElementById('admin-empty');
    const saveBtn = document.getElementById('admin-save');
    const status  = document.getElementById('admin-status');
    const logout  = document.getElementById('admin-logout');

    const SECTIONS = ['site', 'portal'];

    const el = (obj) => (obj && (obj.el || obj.en)) || '';
    const esc = (s) => String(s).replace(/[&<>"]/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    let fields = [];          // every editable figure, in render order
    let activeTab = 'site';

    const setStatus = (text, kind) => {
        status.textContent = text || '';
        status.className = 'admin-status' + (kind ? ' is-' + kind : '');
    };

    // --- reading the white-label catalogue out of index.html ----------------
    // The prices there are written into the markup, so the page itself is the
    // list. Parsing it here means adding a service to the site is enough for it
    // to appear in the admin, with no second place to update.
    const loadSiteCatalogue = async () => {
        const res = await fetch('index.html', { cache: 'no-store' });
        if (!res.ok) throw new Error('Δεν διαβάστηκε το index.html');

        const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
        const out = [];
        let group = 'Υπηρεσίες';

        // Document order, so each card is filed under the heading above it.
        doc.querySelectorAll('.category-title, [data-service-id]').forEach(node => {
            if (node.classList.contains('category-title')) {
                group = node.textContent.trim();
                return;
            }

            const priceEl = Array.from(node.querySelectorAll(window.NELYCE_PRICES.PRICE_SELECTOR))
                .find(p => p.closest('[data-service-id]') === node);
            if (!priceEl) return;

            const bare = priceEl.cloneNode(true);
            bare.querySelectorAll('.price-unit, .emb-unit').forEach(u => u.remove());
            const digits = bare.textContent.replace(/[^\d]/g, '');
            if (!digits) return;   // "Κατόπιν εκτίμησης", "Custom" — nothing to edit

            const nameEl = node.querySelector('.item-title, .addon-name, h5, h3');
            const unitEl = priceEl.querySelector('.price-unit, .emb-unit');

            out.push({
                id: node.dataset.serviceId,
                group,
                name: nameEl ? nameEl.textContent.trim() : node.dataset.serviceId,
                basePrice: Number(digits),
                unit: unitEl ? unitEl.textContent.trim() : ''
            });
        });

        return out;
    };

    // --- what each catalogue exposes as editable figures --------------------
    const row = (label, note, id) => `
        <div class="admin-row" data-row="${esc(id)}">
            <div class="admin-row-label"><span class="admin-row-name">${esc(label)}</span>${
                note ? `<span class="admin-row-note">${esc(note)}</span>` : ''}</div>
            <div class="admin-field">
                <label class="admin-euro">
                    <input type="number" min="0" step="any" inputmode="decimal" data-field="${esc(id)}"
                           aria-label="${esc(label)}">
                </label>
                <button class="admin-reset" type="button" data-reset="${esc(id)}"
                        title="Επαναφορά στην τιμή του κώδικα" aria-label="Επαναφορά">&#8635;</button>
            </div>
        </div>`;

    // A stepper that only multiplies the subtotal (number of pages, number of
    // months) carries no price of its own, so it gets no row.
    const rowsFor = (prefix, param) => {
        if (param.type === 'select') {
            return (param.options || []).map((option, i) => ({
                key: `${prefix}|opt|${param.key}|${i}`,
                def: option.price,
                label: `${el(param.label)} — ${el(option.label)}`,
                note: el(option.note),
                target: { kind: 'option', param: param.key, index: i }
            }));
        }

        if (param.type === 'toggle') {
            return [{
                key: `${prefix}|price|${param.key}`,
                def: param.price,
                label: el(param.label),
                note: param.scope === 'flat' ? 'εφάπαξ' : 'ανά μονάδα',
                target: { kind: 'price', param: param.key }
            }];
        }

        if (param.type === 'stepper' && param.role !== 'multiplier') {
            return [{
                key: `${prefix}|unit|${param.key}`,
                def: param.pricePerUnit,
                label: el(param.label),
                note: param.baseline
                    ? `ανά μονάδα — οι πρώτες ${param.baseline} περιλαμβάνονται στη βάση`
                    : 'ανά μονάδα',
                target: { kind: 'pricePerUnit', param: param.key }
            }];
        }

        return [];
    };

    const portalSpecs = (service) => {
        const prefix = `portal|${service.id}`;
        const specs = [
            { key: `${prefix}|base`, def: service.basePrice,
              label: 'Βασική τιμή', note: 'από αυτήν ξεκινάει ο υπολογισμός',
              target: { kind: 'basePrice' } },
            { key: `${prefix}|floor`, def: service.floorPrice || 0,
              label: 'Ελάχιστη χρέωση', note: 'η προσφορά δεν πέφτει ποτέ κάτω από αυτό',
              target: { kind: 'floorPrice' } }
        ];
        (service.params || []).forEach(p => specs.push(...rowsFor(prefix, p)));
        return specs;
    };

    const siteSpecs = (entry, params) => {
        const prefix = `site|${entry.id}`;
        const specs = [
            { key: `${prefix}|base`, def: entry.basePrice,
              label: 'Βασική τιμή',
              note: 'η τιμή που δείχνει η κάρτα στο site' + (entry.unit ? ` (${entry.unit})` : ''),
              target: { kind: 'basePrice' } }
        ];
        (params || []).forEach(p => specs.push(...rowsFor(prefix, p)));
        return specs;
    };

    // --- what is live for a figure: the override if there is one, else code --
    const savedValue = (stored, params, spec) => {
        const patch = stored[spec.service];
        if (!patch) return spec.def;
        const t = spec.target;

        if (t.kind === 'basePrice'  && typeof patch.basePrice  === 'number') return patch.basePrice;
        if (t.kind === 'floorPrice' && typeof patch.floorPrice === 'number') return patch.floorPrice;

        const param = patch.params && patch.params[t.param];
        if (!param) return spec.def;

        if (t.kind === 'option') {
            const live = ((params || []).find(p => p.key === t.param) || {}).options || [];
            // Positional: only trusted while the stored list still lines up with
            // the choices the code offers.
            if (Array.isArray(param.options) && param.options.length === live.length) {
                return param.options[t.index];
            }
            return spec.def;
        }

        return typeof param[t.kind] === 'number' ? param[t.kind] : spec.def;
    };

    // --- rendering ----------------------------------------------------------
    const serviceBlock = (title, id, specs, stored, params) => {
        let html = `<section class="admin-service">
            <h3 class="admin-service-name">${esc(title)}</h3>
            <p class="admin-service-id">${esc(id)}</p>`;

        specs.forEach(spec => {
            html += row(spec.label, spec.note, spec.key);
            fields.push({ ...spec, saved: savedValue(stored, params, spec) });
        });

        return html + `</section>`;
    };

    const renderSite = (catalogue, stored) => {
        let html = '';
        let group = null;

        catalogue.forEach(entry => {
            if (entry.group !== group) {
                group = entry.group;
                html += `<h2 class="admin-cat">${esc(group)}</h2>`;
            }

            const params = (typeof SERVICE_PARAMS !== 'undefined') ? SERVICE_PARAMS[entry.id] : null;
            const specs = siteSpecs(entry, params)
                .map(s => ({ ...s, section: 'site', service: entry.id }));

            html += serviceBlock(entry.name, entry.id, specs, stored, params);
        });

        return html;
    };

    const renderPortal = (stored) => {
        let html = '';

        PORTAL_CATEGORIES.forEach(cat => {
            const services = PORTAL_SERVICES.filter(s => s.category === cat.id);
            if (!services.length) return;

            html += `<h2 class="admin-cat">${esc(el(cat.label))}</h2>`;
            services.forEach(service => {
                const specs = portalSpecs(service)
                    .map(s => ({ ...s, section: 'portal', service: service.id }));
                html += serviceBlock(el(service.name), service.id, specs, stored, service.params);
            });
        });

        return html;
    };

    const render = (overrides, catalogue) => {
        fields = [];

        const site   = renderSite(catalogue, (overrides.site   || {}).services || {});
        const portal = renderPortal(          (overrides.portal || {}).services || {});

        list.innerHTML =
            `<div class="admin-list" data-list="site">${site}</div>` +
            `<div class="admin-list" data-list="portal">${portal}</div>`;

        // The inputs exist only now, so bind each spec to its box in one pass.
        fields.forEach(field => {
            field.input = list.querySelector(`[data-field="${CSS.escape(field.key)}"]`);
            field.row   = list.querySelector(`[data-row="${CSS.escape(field.key)}"]`);
            field.input.value = field.saved;
            paint(field);
        });

        showTab(activeTab);
    };

    // --- searching ----------------------------------------------------------
    // Forty services on one list is a long scroll to reach one price. Matching
    // is on everything the card says — its name, its id and its parameter
    // labels — and a category heading disappears with the last card under it.
    const applyFilter = () => {
        const query = filter.value.trim().toLowerCase();
        let visibleHere = 0;

        list.querySelectorAll('.admin-list').forEach(section => {
            let heading = null;
            let headingHasMatch = false;
            const isActive = section.dataset.list === activeTab;

            const closeHeading = () => { if (heading) heading.hidden = !headingHasMatch; };

            Array.from(section.children).forEach(node => {
                if (node.classList.contains('admin-cat')) {
                    closeHeading();
                    heading = node;
                    headingHasMatch = false;
                    return;
                }

                const match = !query || node.textContent.toLowerCase().includes(query);
                node.hidden = !match;
                if (match) {
                    headingHasMatch = true;
                    if (isActive) visibleHere += 1;
                }
            });

            closeHeading();
        });

        empty.hidden = visibleHere > 0;
    };

    filter.addEventListener('input', applyFilter);

    // Escape clears the box rather than making you select and delete.
    filter.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && filter.value) {
            filter.value = '';
            applyFilter();
        }
    });

    // --- tabs ---------------------------------------------------------------
    // style.css gives body its own overflow, so which element actually scrolls
    // depends on the page. Setting all three is harmless and always right.
    const toTop = () => {
        window.scrollTo({ top: 0 });
        if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
        document.body.scrollTop = 0;
    };

    const showTab = (name) => {
        activeTab = name;
        list.querySelectorAll('.admin-list').forEach(node => {
            node.hidden = node.dataset.list !== name;
        });
        tabsNav.querySelectorAll('.admin-tab').forEach(btn => {
            btn.classList.toggle('is-active', btn.dataset.tab === name);
        });
        applyFilter();
        toTop();
    };

    tabsNav.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-tab]');
        if (btn) showTab(btn.dataset.tab);
    });

    // --- state --------------------------------------------------------------
    const current = (field) => {
        const n = Number(field.input.value);
        return (field.input.value.trim() !== '' && Number.isFinite(n) && n >= 0) ? n : null;
    };

    const paint = (field) => {
        const value = current(field);
        field.row.classList.toggle('is-changed', value !== null && value !== field.def);
    };

    const dirtyIn = (section) =>
        fields.some(f => f.section === section && current(f) !== f.saved);

    const isDirty = () => SECTIONS.some(dirtyIn);

    const refresh = () => {
        SECTIONS.forEach(name => {
            const btn = tabsNav.querySelector(`[data-tab="${name}"]`);
            if (btn) btn.classList.toggle('is-dirty', dirtyIn(name));
        });

        const dirty = isDirty();
        saveBtn.disabled = !dirty;
        if (dirty) setStatus('Μη αποθηκευμένες αλλαγές');
        else if (status.textContent === 'Μη αποθηκευμένες αλλαγές') setStatus('');
    };

    list.addEventListener('input', (e) => {
        const input = e.target.closest('[data-field]');
        if (!input) return;
        paint(fields.find(f => f.key === input.dataset.field));
        refresh();
    });

    list.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-reset]');
        if (!btn) return;
        const field = fields.find(f => f.key === btn.dataset.reset);
        field.input.value = field.def;
        paint(field);
        refresh();
    });

    // --- saving -------------------------------------------------------------
    // Only figures that differ from the code are sent. That keeps the stored
    // object small and, more usefully, means a price left alone here still
    // follows the code if it is ever edited there.
    const payload = () => {
        const out = {};
        SECTIONS.forEach(name => { out[name] = { services: {} }; });

        const bucket = (field) => {
            const services = out[field.section].services;
            return (services[field.service] = services[field.service] || {});
        };
        const paramsOf = (field) => {
            const s = bucket(field);
            s.params = s.params || {};
            return (s.params[field.target.param] = s.params[field.target.param] || {});
        };

        fields.forEach(field => {
            const value = current(field);
            if (value === null || value === field.def) return;
            const t = field.target;

            if (t.kind === 'basePrice' || t.kind === 'floorPrice') {
                bucket(field)[t.kind] = value;
            } else if (t.kind === 'option') {
                // applyParams only trusts a complete options list, so one changed
                // choice means writing the whole set.
                const siblings = fields.filter(f =>
                    f.section === field.section && f.service === field.service &&
                    f.target.kind === 'option' && f.target.param === t.param);
                paramsOf(field).options =
                    siblings.map(f => { const v = current(f); return v === null ? f.def : v; });
            } else {
                paramsOf(field)[t.kind] = value;
            }
        });

        return out;
    };

    const save = async () => {
        const bad = fields.find(f => current(f) === null);
        if (bad) {
            filter.value = '';
            showTab(bad.section);
            setStatus('Συμπλήρωσε έναν έγκυρο αριθμό', 'error');
            bad.input.focus();
            return;
        }

        saveBtn.disabled = true;
        setStatus('Αποθήκευση…');

        try {
            const res = await fetch(window.NELYCE_PRICES.ENDPOINT, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify(payload())
            });

            if (res.status === 401) return showGate('Η σύνδεση έληξε. Μπες ξανά.');
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || `Ο server απάντησε ${res.status}`);
            }

            fields.forEach(f => { f.saved = current(f); });
            setStatus('Αποθηκεύτηκε', 'done');
            refresh();
            saveBtn.disabled = true;
        } catch (err) {
            setStatus(err.message, 'error');
            saveBtn.disabled = false;
        }
    };

    saveBtn.addEventListener('click', save);

    window.addEventListener('beforeunload', (e) => {
        if (!shell.hidden && isDirty()) e.preventDefault();
    });

    // --- sign in / out ------------------------------------------------------
    const showGate = (message) => {
        shell.hidden = true;
        gate.hidden = false;
        gateError.hidden = !message;
        gateError.textContent = message || '';
        gatePass.value = '';
        gatePass.focus();
    };

    const showEditor = async () => {
        gate.hidden = true;
        shell.hidden = false;
        setStatus('Φόρτωση…');

        try {
            const overrides = await window.NELYCE_PRICES.fetchOverrides();

            // The white-label list is read out of index.html. If that read
            // fails there is no reason to lose the portal list as well, so it
            // degrades to the one catalogue it does have.
            let catalogue = [];
            let warning = '';
            try {
                catalogue = await loadSiteCatalogue();
            } catch {
                warning = 'Ο τιμοκατάλογος του site δεν διαβάστηκε — δείχνω μόνο το portal.';
            }

            render(overrides, catalogue);
            if (warning) {
                showTab('portal');
                setStatus(warning, 'error');
            } else {
                setStatus('');
            }
            refresh();
        } catch (err) {
            setStatus(err.message, 'error');
        }
    };

    const GATE_ERRORS = {
        'wrong-password': 'Λάθος κωδικός.',
        'too-many-attempts': 'Πολλές αποτυχημένες προσπάθειες. Δοκίμασε ξανά σε 15 λεπτά.'
    };

    gateForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        gateSubmit.disabled = true;
        gateError.hidden = true;

        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ password: gatePass.value })
            });
            const body = await res.json().catch(() => ({}));

            if (res.ok && body.authenticated) return showEditor();
            showGate(GATE_ERRORS[body.error] || body.error || 'Κάτι πήγε στραβά.');
        } catch {
            showGate('Δεν έγινε σύνδεση με τον server.');
        } finally {
            gateSubmit.disabled = false;
        }
    });

    logout.addEventListener('click', async () => {
        if (isDirty() && !confirm('Υπάρχουν αλλαγές που δεν αποθηκεύτηκαν. Αποσύνδεση;')) return;
        await fetch('/api/login', { method: 'DELETE', credentials: 'same-origin' }).catch(() => {});
        showGate();
    });

    // The cookie is HttpOnly, so only the server can say whether it is still
    // valid — and the editor stays hidden until it does.
    fetch('/api/login', { credentials: 'same-origin' })
        .then(r => r.json())
        .then(body => (body.authenticated ? showEditor() : showGate()))
        .catch(() => showGate());
});
