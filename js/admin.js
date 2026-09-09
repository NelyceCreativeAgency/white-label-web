// Pricing admin.
//
// The catalogue is read straight out of js/portal-data.js, so this page never
// carries its own copy of the services and cannot drift from the portal. Each
// figure on screen knows three things about itself: the number in the code, the
// number currently saved, and what is in the box right now. Those three are
// what drive the orange dot, the reset arrow and the Save button.
document.addEventListener('DOMContentLoaded', () => {

    const gate     = document.getElementById('admin-gate');
    const gateForm = document.getElementById('gate-form');
    const gatePass  = document.getElementById('gate-password');
    const gateError = document.getElementById('gate-error');
    const gateSubmit = document.getElementById('gate-submit');

    const shell   = document.getElementById('admin-shell');
    const list    = document.getElementById('admin-services');
    const saveBtn = document.getElementById('admin-save');
    const status  = document.getElementById('admin-status');
    const logout  = document.getElementById('admin-logout');

    const el = (obj) => (obj && (obj.el || obj.en)) || '';
    const esc = (s) => String(s).replace(/[&<>"]/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    // Every editable figure on the page, in render order.
    let fields = [];

    const setStatus = (text, kind) => {
        status.textContent = text || '';
        status.className = 'admin-status' + (kind ? ' is-' + kind : '');
    };

    // --- rendering ---------------------------------------------------------
    const row = (label, note, id) => `
        <div class="admin-row" data-row="${id}">
            <div class="admin-row-label"><span class="admin-row-name">${esc(label)}</span>${note ? `<span class="admin-row-note">${esc(note)}</span>` : ''}</div>
            <div class="admin-field">
                <label class="admin-euro">
                    <input type="number" min="0" step="1" inputmode="decimal" data-field="${id}"
                           aria-label="${esc(label)}">
                </label>
                <button class="admin-reset" type="button" data-reset="${id}"
                        title="Επαναφορά στην τιμή του κώδικα" aria-label="Επαναφορά">&#8635;</button>
            </div>
        </div>`;

    // Which figures a parameter exposes. A stepper that only multiplies the
    // subtotal (number of videos, number of months) carries no price of its
    // own, so it gets no row — there would be nothing to type into it.
    const rowsFor = (service, param) => {
        const id = service.id;

        if (param.type === 'select') {
            return (param.options || []).map((option, i) => ({
                key: `${id}|opt|${param.key}|${i}`,
                def: option.price,
                label: `${el(param.label)} — ${el(option.label)}`,
                note: el(option.note),
                target: { kind: 'option', param: param.key, index: i }
            }));
        }

        if (param.type === 'toggle') {
            return [{
                key: `${id}|price|${param.key}`,
                def: param.price,
                label: el(param.label),
                note: param.scope === 'flat' ? 'εφάπαξ' : 'ανά μονάδα',
                target: { kind: 'price', param: param.key }
            }];
        }

        if (param.type === 'stepper' && param.role !== 'multiplier') {
            return [{
                key: `${id}|unit|${param.key}`,
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

    const specsFor = (service) => {
        const specs = [
            { key: `${service.id}|base`, def: service.basePrice,
              label: 'Βασική τιμή', note: 'από αυτήν ξεκινάει ο υπολογισμός',
              target: { kind: 'basePrice' } },
            { key: `${service.id}|floor`, def: service.floorPrice || 0,
              label: 'Ελάχιστη χρέωση', note: 'η προσφορά δεν πέφτει ποτέ κάτω από αυτό',
              target: { kind: 'floorPrice' } }
        ];
        (service.params || []).forEach(param => specs.push(...rowsFor(service, param)));
        return specs;
    };

    const render = (overrides) => {
        const stored = (overrides && overrides.services) || {};
        let html = '';
        fields = [];

        PORTAL_CATEGORIES.forEach(cat => {
            const services = PORTAL_SERVICES.filter(s => s.category === cat.id);
            if (!services.length) return;

            html += `<h2 class="admin-cat">${esc(el(cat.label))}</h2>`;

            services.forEach(service => {
                html += `<section class="admin-service">
                    <h3 class="admin-service-name">${esc(el(service.name))}</h3>
                    <p class="admin-service-id">${esc(service.id)}</p>`;

                specsFor(service).forEach(spec => {
                    html += row(spec.label, spec.note, spec.key);
                    fields.push({ ...spec, service: service.id, saved: savedValue(stored, service, spec) });
                });

                html += `</section>`;
            });
        });

        list.innerHTML = html;

        // The inputs exist only now, so bind each spec to its box in one pass.
        fields.forEach(field => {
            field.input = list.querySelector(`[data-field="${CSS.escape(field.key)}"]`);
            field.row = list.querySelector(`[data-row="${CSS.escape(field.key)}"]`);
            field.input.value = field.saved;
            paint(field);
        });
    };

    // What is currently live for this figure: the stored override if there is
    // one, otherwise the number in the code.
    const savedValue = (stored, service, spec) => {
        const patch = stored[service.id];
        if (!patch) return spec.def;
        const t = spec.target;

        if (t.kind === 'basePrice'  && typeof patch.basePrice  === 'number') return patch.basePrice;
        if (t.kind === 'floorPrice' && typeof patch.floorPrice === 'number') return patch.floorPrice;

        const param = patch.params && patch.params[t.param];
        if (!param) return spec.def;

        if (t.kind === 'option') {
            const live = ((service.params || []).find(p => p.key === t.param) || {}).options || [];
            // Positional: only trusted while the stored list still lines up with
            // the choices the code offers.
            if (Array.isArray(param.options) && param.options.length === live.length) {
                return param.options[t.index];
            }
            return spec.def;
        }

        return typeof param[t.kind] === 'number' ? param[t.kind] : spec.def;
    };

    // --- state -------------------------------------------------------------
    const current = (field) => {
        const n = Number(field.input.value);
        return (field.input.value.trim() !== '' && Number.isFinite(n) && n >= 0) ? n : null;
    };

    const paint = (field) => {
        const value = current(field);
        field.row.classList.toggle('is-changed', value !== null && value !== field.def);
    };

    const isDirty = () => fields.some(f => current(f) !== f.saved);

    const refresh = () => {
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

    // --- saving ------------------------------------------------------------
    // Only figures that differ from the code are sent. That keeps the stored
    // object small and, more usefully, means a price left alone here still
    // follows the code if it is ever edited there.
    const payload = () => {
        const services = {};
        const bucket = (id) => (services[id] = services[id] || {});
        const params = (id, key) => {
            const s = bucket(id);
            s.params = s.params || {};
            return (s.params[key] = s.params[key] || {});
        };

        fields.forEach(field => {
            const value = current(field);
            if (value === null || value === field.def) return;
            const t = field.target;

            if (t.kind === 'basePrice' || t.kind === 'floorPrice') {
                bucket(field.service)[t.kind] = value;
            } else if (t.kind === 'option') {
                // apply() only trusts a complete options list, so one changed
                // choice means writing the whole set.
                const siblings = fields.filter(f =>
                    f.service === field.service && f.target.kind === 'option' && f.target.param === t.param);
                params(field.service, t.param).options =
                    siblings.map(f => { const v = current(f); return v === null ? f.def : v; });
            } else {
                params(field.service, t.param)[t.kind] = value;
            }
        });

        return { services };
    };

    const save = async () => {
        const bad = fields.find(f => current(f) === null);
        if (bad) {
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

    // --- sign in / out -----------------------------------------------------
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
        render(await window.NELYCE_PRICES.fetchOverrides());
        setStatus('');
        refresh();
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
