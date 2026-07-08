document.addEventListener('DOMContentLoaded', () => {

    const getLang = () => document.documentElement.getAttribute('data-lang') || 'el';

    // --- Parse a "150€ / σελίδα" style price element into { amount, unitText } ---
    const parsePrice = (root, priceSelector, unitSelector) => {
        const priceEl = root.querySelector(priceSelector);
        if (!priceEl) return null;

        const clone = priceEl.cloneNode(true);
        let unitText = '';
        if (unitSelector) {
            const unitEl = clone.querySelector(unitSelector);
            if (unitEl) {
                unitText = unitEl.textContent.trim();
                unitEl.remove();
            }
        }

        const digits = clone.textContent.replace(/[^\d]/g, '');
        if (!digits) return null;

        return { amount: parseInt(digits, 10), unitText: unitText.replace(/^[\s/]+/, '').trim() };
    };

    // --- Modal shell ---
    const overlay = document.createElement('div');
    overlay.className = 'customize-overlay';
    overlay.innerHTML = `
        <div class="customize-modal">
            <button type="button" class="customize-close" aria-label="Close">&times;</button>
            <h3 class="customize-title"></h3>
            <p class="customize-desc"></p>
            <div class="customize-params"></div>
            <div class="customize-total-row">
                <span class="customize-total-label" data-en="Estimated Total">Εκτιμώμενο Σύνολο</span>
                <span class="customize-total-value">0€</span>
            </div>
            <a href="#" class="btn btn-primary customize-email-btn" data-en="Email This Estimate">Στείλε την Εκτίμηση</a>
        </div>
    `;
    document.body.appendChild(overlay);

    const modalTitle = overlay.querySelector('.customize-title');
    const modalDesc = overlay.querySelector('.customize-desc');
    const paramsContainer = overlay.querySelector('.customize-params');
    const totalValue = overlay.querySelector('.customize-total-value');
    const emailBtn = overlay.querySelector('.customize-email-btn');
    const closeBtn = overlay.querySelector('.customize-close');

    let current = null; // { title, desc, baseAmount, baseUnitText, params, values }

    const recompute = () => {
        if (!current) return;
        let units = 1;
        let additive = 0;

        current.params.forEach(p => {
            const val = current.values[p.key];
            if (p.type === 'stepper') {
                if (p.role === 'multiplier') {
                    units = val;
                } else {
                    additive += (val - (p.baseline || 0)) * p.pricePerUnit;
                }
            } else if (p.type === 'toggle') {
                if (val) additive += p.price;
            } else if (p.type === 'select') {
                additive += p.options[val].price;
            }
        });

        const total = (current.baseAmount + additive) * units;
        totalValue.textContent = total.toLocaleString('el-GR') + '€';
        current.total = total;
        current.units = units;
    };

    const renderParams = () => {
        const lang = getLang();
        paramsContainer.innerHTML = '';

        current.params.forEach(p => {
            const group = document.createElement('div');
            group.className = 'customize-param-group';

            const row = document.createElement('div');
            row.className = 'customize-param-row';

            const label = document.createElement('span');
            label.className = 'customize-param-label';
            label.textContent = p.label[lang];
            row.appendChild(label);

            if (p.type === 'stepper') {
                const step = p.step || 1;
                const qty = document.createElement('div');
                qty.className = 'calc-qty';
                qty.innerHTML = `
                    <button type="button" class="qty-btn param-minus">&minus;</button>
                    <input type="number" class="qty-input param-input" value="${current.values[p.key]}" min="${p.min}" max="${p.max}" step="${step}">
                    <button type="button" class="qty-btn param-plus">+</button>
                `;
                const input = qty.querySelector('.param-input');
                const minus = qty.querySelector('.param-minus');
                const plus = qty.querySelector('.param-plus');

                const setVal = (v) => {
                    v = Math.max(p.min, Math.min(p.max, v));
                    input.value = v;
                    current.values[p.key] = v;
                    recompute();
                };

                input.addEventListener('input', () => setVal(parseInt(input.value, 10) || p.min));
                minus.addEventListener('click', () => setVal(current.values[p.key] - step));
                plus.addEventListener('click', () => setVal(current.values[p.key] + step));

                row.appendChild(qty);
            } else if (p.type === 'toggle') {
                const toggle = document.createElement('label');
                toggle.className = 'customize-toggle';
                toggle.innerHTML = `<input type="checkbox" ${current.values[p.key] ? 'checked' : ''}><span class="customize-toggle-track"></span>`;
                toggle.querySelector('input').addEventListener('change', (e) => {
                    current.values[p.key] = e.target.checked;
                    recompute();
                });
                row.appendChild(toggle);
            } else if (p.type === 'select') {
                const select = document.createElement('select');
                select.className = 'customize-select';
                p.options.forEach((opt, i) => {
                    const optionEl = document.createElement('option');
                    optionEl.value = i;
                    optionEl.textContent = opt.label[lang] + (opt.price ? ` (+${opt.price}€)` : '');
                    select.appendChild(optionEl);
                });
                select.value = current.values[p.key];

                const note = document.createElement('p');
                note.className = 'customize-param-note';
                const updateNote = () => {
                    const opt = p.options[current.values[p.key]];
                    note.textContent = opt.note ? opt.note[lang] : '';
                    note.style.display = opt.note ? 'block' : 'none';
                };
                updateNote();

                select.addEventListener('change', () => {
                    current.values[p.key] = parseInt(select.value, 10);
                    updateNote();
                    recompute();
                });
                row.appendChild(select);
                group.appendChild(row);
                group.appendChild(note);
                paramsContainer.appendChild(group);
                return;
            }

            group.appendChild(row);
            paramsContainer.appendChild(group);
        });
    };

    const openModal = (data) => {
        const params = data.params || [];
        const values = {};
        params.forEach(p => {
            if (p.type === 'stepper') values[p.key] = p.default;
            else if (p.type === 'toggle') values[p.key] = false;
            else if (p.type === 'select') values[p.key] = 0;
        });

        current = {
            title: data.title,
            desc: data.desc,
            baseAmount: data.amount,
            baseUnitText: data.unitText,
            params,
            values
        };

        modalTitle.textContent = data.title;
        modalDesc.textContent = data.desc || '';
        modalDesc.style.display = data.desc ? 'block' : 'none';

        renderParams();
        recompute();

        overlay.classList.add('open');
        document.body.classList.add('customize-open');
    };

    const closeModal = () => {
        overlay.classList.remove('open');
        document.body.classList.remove('customize-open');
        current = null;
    };

    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });

    emailBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (!current) return;
        const lang = getLang();

        const lines = current.params.map(p => {
            const val = current.values[p.key];
            if (p.type === 'stepper') return `- ${p.label[lang]}: ${val}`;
            if (p.type === 'toggle') return `- ${p.label[lang]}: ${val ? (lang === 'en' ? 'Yes' : 'Ναι') : (lang === 'en' ? 'No' : 'Όχι')}`;
            if (p.type === 'select') return `- ${p.label[lang]}: ${p.options[val].label[lang]}`;
            return '';
        });

        const subject = encodeURIComponent(
            (lang === 'en' ? 'Custom Quote Request: ' : 'Αίτημα Προσφοράς: ') + current.title
        );
        const bodyLines = [
            (lang === 'en' ? 'Service: ' : 'Υπηρεσία: ') + current.title,
            '',
            ...lines,
            '',
            (lang === 'en' ? 'Estimated Total: ' : 'Εκτιμώμενο Σύνολο: ') + current.total + '€'
        ];
        const body = encodeURIComponent(bodyLines.join('\n'));
        window.location.href = `mailto:info@nelycedesign.com?subject=${subject}&body=${body}`;
    });

    // --- Button injection ---
    const makeButton = () => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'customize-btn';
        btn.dataset.en = 'Customize';
        btn.textContent = 'Εξατομίκευση';
        return btn;
    };

    const attachButton = (containerEl, serviceId, parsed, titleEl, descEl) => {
        if (containerEl.querySelector('.customize-btn')) return;
        const params = SERVICE_PARAMS[serviceId];
        if (!params) return;

        const btn = makeButton();
        btn.addEventListener('click', () => {
            openModal({
                title: titleEl ? titleEl.textContent.trim() : '',
                desc: descEl ? descEl.textContent.trim() : '',
                amount: parsed.amount,
                unitText: parsed.unitText,
                params
            });
        });
        containerEl.appendChild(btn);
    };

    // Standard price cards
    document.querySelectorAll('.price-card[data-service-id]').forEach(card => {
        const footer = card.querySelector('.card-footer');
        if (!footer) return;
        const parsed = parsePrice(footer, '.price-amount', '.price-unit');
        if (!parsed) return;
        attachButton(footer, card.dataset.serviceId, parsed, card.querySelector('.item-title'), card.querySelector('.item-desc'));
    });

    // Sub-items (Logo Animation, Ads creatives)
    document.querySelectorAll('.sub-item[data-service-id]').forEach(subItem => {
        const parsed = parsePrice(subItem, '.sub-price', null);
        if (!parsed) return;
        attachButton(subItem, subItem.dataset.serviceId, parsed, subItem.querySelector('h5'), null);
    });

    // Add-ons
    document.querySelectorAll('.addon-item[data-service-id]').forEach(item => {
        const parsed = parsePrice(item, '.addon-value', null);
        if (!parsed) return;
        attachButton(item, item.dataset.serviceId, parsed, item.querySelector('.addon-name'), null);
    });

    // E-Commerce Management special box
    document.querySelectorAll('.ecommerce-management-box[data-service-id]').forEach(box => {
        const priceBlock = box.querySelector('.emb-price');
        if (!priceBlock) return;
        const parsed = parsePrice(priceBlock, '.emb-value', '.emb-unit');
        if (!parsed) return;
        attachButton(priceBlock, box.dataset.serviceId, parsed, box.querySelector('h3'), box.querySelector('.emb-content p'));
    });
});
