document.addEventListener('DOMContentLoaded', () => {
    const recipientEmail = 'info@nelycedesign.com';

    const tabs = document.querySelectorAll('.calc-tab');
    const packagesMode = document.getElementById('packagesMode');
    const customMode = document.getElementById('customMode');
    const packageCards = document.querySelectorAll('.package-card');

    const summaryTitle = document.getElementById('summaryTitle');
    const summaryItems = document.getElementById('summaryItems');
    const totalPriceEl = document.getElementById('totalPrice');
    const mainCta = document.getElementById('quoteEmailButton');

    const getLang = () => document.documentElement.getAttribute('data-lang') || 'en';
    const rate = () => (window.CURRENCY ? window.CURRENCY.rate : 1);
    const formatMoney = (eurAmount) => window.formatCurrencyAmount
        ? window.formatCurrencyAmount(eurAmount * rate())
        : Math.round(eurAmount) + '€';

    // currentQuote always stores the EUR amount (source of truth); display is converted at render time.
    let currentQuote = { title: '', eurPrice: 0, items: [] };

    const renderSummary = (title, eurPrice, items) => {
        summaryTitle.textContent = title;
        totalPriceEl.textContent = formatMoney(eurPrice);
        summaryItems.innerHTML = items.map(item => `<div>${item}</div>`).join('');

        currentQuote = { title, eurPrice, items };
        updateEmailLink();
    };

    // --- Ready Packages ---
    const renderPackagePrices = () => {
        packageCards.forEach(card => {
            const data = CALC_PACKAGES[card.dataset.package];
            const priceEl = card.querySelector('.package-price');
            priceEl.textContent = formatMoney(data.price) + (getLang() === 'en' ? ' + VAT / month' : ' + ΦΠΑ / μήνα');
        });
    };

    const selectPackage = (packageName) => {
        const lang = getLang();
        const data = CALC_PACKAGES[packageName];
        renderSummary(data.title[lang], data.price, data.items.map(i => i[lang]));

        packageCards.forEach(card => {
            card.classList.toggle('selected', card.dataset.package === packageName);
        });
    };

    // --- Custom Package ---
    const calculateCustom = () => {
        const lang = getLang();
        const platforms = Array.from(document.querySelectorAll('.platform-checkbox:checked')).map(input => input.value);
        const posts = Number(document.getElementById('posts').value) || 0;
        const stories = Number(document.getElementById('stories').value) || 0;
        const visits = Number(document.getElementById('visits').value) || 0;

        const graphics = document.getElementById('graphics').checked;
        const carousels = document.getElementById('carousels').checked;
        const comments = document.getElementById('comments').checked;
        const report = document.getElementById('report').checked;
        const fullManagement = document.getElementById('fullManagement').checked;

        let price = CALC_RATES.base;
        price += platforms.length * CALC_RATES.perPlatform;
        price += posts * CALC_RATES.perPost;
        price += stories * CALC_RATES.perStory;
        price += visits * CALC_RATES.perVisit;
        if (graphics) price += CALC_RATES.graphics;
        if (carousels) price += CALC_RATES.carousels;
        if (comments) price += CALC_RATES.comments;
        if (report) price += CALC_RATES.report;
        if (fullManagement) price += CALC_RATES.fullManagement;

        const items = [];
        const t = (el, en) => (lang === 'en' ? en : el);

        items.push(platforms.length ? platforms.join(' & ') : t('Χωρίς επιλεγμένη πλατφόρμα', 'No platform selected'));
        items.push(fullManagement
            ? t('Πλήρης διαχείριση προφίλ', 'Full profile management')
            : t('Ο πελάτης μπορεί να ανεβάζει επιπλέον posts ή stories', 'The client can upload extra posts or stories'));

        if (posts > 0) items.push(`${posts} ${t('posts / μήνα', 'posts / month')}`);
        if (stories > 0) items.push(`${stories} ${t('stories / μήνα', 'stories / month')}`);
        if (visits > 0) items.push(`${visits} ${t('επισκέψεις / μήνα', 'visits / month')}`);

        items.push(t('Concepts περιεχομένου', 'Content concepts'));
        items.push('Captions');
        items.push(t('Δημοσίευση περιεχομένου', 'Content publishing'));
        items.push(t('Video editing για Reels', 'Video editing for Reels'));

        if (graphics) items.push(t('Γραφικά posts', 'Post graphics'));
        if (carousels) items.push('Carousels');
        if (comments) items.push(t('Διαχείριση comments', 'Comment management'));
        if (report) items.push(t('Αναφορά απόδοσης', 'Performance report'));

        renderSummary(t('Custom Πακέτο', 'Custom Package'), price, items);
    };

    // --- Email quote ---
    const buildEmailLink = () => {
        const lang = getLang();
        const priceText = formatMoney(currentQuote.eurPrice);
        const subject = lang === 'en'
            ? `Interested in the ${currentQuote.title} Social Media package`
            : `Ενδιαφέρον για ${currentQuote.title} Social Media πακέτο`;

        const body = lang === 'en'
            ? `Hello,\n\nI'm interested in social media management with the following details:\n\nPackage: ${currentQuote.title}\nIndicative cost: ${priceText} + VAT / month\n\nSelected services:\n${currentQuote.items.map(i => `- ${i}`).join('\n')}\n\nI'd like to discuss further details.\n\nThank you.`
            : `Καλησπέρα σας,\n\nενδιαφέρομαι για την υπηρεσία διαχείρισης social media με τα παρακάτω στοιχεία:\n\nΠακέτο: ${currentQuote.title}\nΕνδεικτικό κόστος: ${priceText} + ΦΠΑ / μήνα\n\nΕπιλεγμένες υπηρεσίες:\n${currentQuote.items.map(i => `- ${i}`).join('\n')}\n\nΘα ήθελα να επικοινωνήσουμε για περισσότερες λεπτομέρειες.\n\nΕυχαριστώ πολύ.`;

        return `mailto:${recipientEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    };

    const updateEmailLink = () => {
        if (!mainCta) return;
        mainCta.setAttribute('href', buildEmailLink());
    };

    const openEmailQuote = (event) => {
        event.preventDefault();
        window.location.href = buildEmailLink();
    };

    // --- Wiring ---
    let activeMode = 'custom';

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            const mode = tab.dataset.mode;
            activeMode = mode;
            packagesMode.classList.toggle('active', mode === 'packages');
            customMode.classList.toggle('active', mode === 'custom');

            if (mode === 'packages') {
                const selected = document.querySelector('.package-card.selected');
                selectPackage(selected ? selected.dataset.package : 'standard');
            } else {
                calculateCustom();
            }
        });
    });

    packageCards.forEach(card => {
        card.addEventListener('click', () => selectPackage(card.dataset.package));
    });

    document.querySelectorAll('#customMode input').forEach(input => {
        input.addEventListener('input', calculateCustom);
        input.addEventListener('change', calculateCustom);
    });

    document.querySelectorAll('.qty-btn[data-target]').forEach(btn => {
        btn.addEventListener('click', () => {
            const input = document.getElementById(btn.dataset.target);
            const step = Number(btn.dataset.step);
            const min = Number(input.min) || 0;
            input.value = Math.max(min, (Number(input.value) || 0) + step);
            calculateCustom();
        });
    });

    if (mainCta) {
        mainCta.addEventListener('click', openEmailQuote);
    }

    // Re-render when language or currency changes (poll-free: hook into existing buttons).
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            setTimeout(() => {
                renderPackagePrices();
                activeMode === 'packages'
                    ? selectPackage((document.querySelector('.package-card.selected') || {}).dataset ? document.querySelector('.package-card.selected').dataset.package : 'standard')
                    : calculateCustom();
            }, 0);
        });
    });

    window.addEventListener('currencychange', () => {
        renderPackagePrices();
        const selected = document.querySelector('.package-card.selected');
        activeMode === 'packages' && selected
            ? selectPackage(selected.dataset.package)
            : calculateCustom();
    });

    // Initial render
    renderPackagePrices();
    selectPackage('standard');
    calculateCustom();
    customMode.classList.add('active');
    packagesMode.classList.remove('active');
});
