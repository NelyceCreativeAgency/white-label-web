// Currency selector + live EUR conversion (rates via frankfurter.app, ECB-backed, no API key required).
const CURRENCIES = [
    { code: 'EUR', flag: '🇪🇺', name: 'Euro', symbol: '€' },
    { code: 'USD', flag: '🇺🇸', name: 'US Dollar', symbol: '$' },
    { code: 'GBP', flag: '🇬🇧', name: 'British Pound', symbol: '£' },
    { code: 'CHF', flag: '🇨🇭', name: 'Swiss Franc', symbol: 'CHF' },
    { code: 'CAD', flag: '🇨🇦', name: 'Canadian Dollar', symbol: 'CA$' },
    { code: 'AUD', flag: '🇦🇺', name: 'Australian Dollar', symbol: 'A$' },
    { code: 'NZD', flag: '🇳🇿', name: 'New Zealand Dollar', symbol: 'NZ$' },
    { code: 'JPY', flag: '🇯🇵', name: 'Japanese Yen', symbol: '¥' },
    { code: 'CNY', flag: '🇨🇳', name: 'Chinese Yuan', symbol: '¥' },
    { code: 'HKD', flag: '🇭🇰', name: 'Hong Kong Dollar', symbol: 'HK$' },
    { code: 'SGD', flag: '🇸🇬', name: 'Singapore Dollar', symbol: 'S$' },
    { code: 'INR', flag: '🇮🇳', name: 'Indian Rupee', symbol: '₹' },
    { code: 'KRW', flag: '🇰🇷', name: 'South Korean Won', symbol: '₩' },
    { code: 'IDR', flag: '🇮🇩', name: 'Indonesian Rupiah', symbol: 'Rp' },
    { code: 'MYR', flag: '🇲🇾', name: 'Malaysian Ringgit', symbol: 'RM' },
    { code: 'PHP', flag: '🇵🇭', name: 'Philippine Peso', symbol: '₱' },
    { code: 'THB', flag: '🇹🇭', name: 'Thai Baht', symbol: '฿' },
    { code: 'ILS', flag: '🇮🇱', name: 'Israeli Shekel', symbol: '₪' },
    { code: 'TRY', flag: '🇹🇷', name: 'Turkish Lira', symbol: '₺' },
    { code: 'ZAR', flag: '🇿🇦', name: 'South African Rand', symbol: 'R' },
    { code: 'BRL', flag: '🇧🇷', name: 'Brazilian Real', symbol: 'R$' },
    { code: 'MXN', flag: '🇲🇽', name: 'Mexican Peso', symbol: 'MX$' },
    { code: 'NOK', flag: '🇳🇴', name: 'Norwegian Krone', symbol: 'kr' },
    { code: 'SEK', flag: '🇸🇪', name: 'Swedish Krona', symbol: 'kr' },
    { code: 'DKK', flag: '🇩🇰', name: 'Danish Krone', symbol: 'kr' },
    { code: 'ISK', flag: '🇮🇸', name: 'Icelandic Krona', symbol: 'kr' },
    { code: 'PLN', flag: '🇵🇱', name: 'Polish Zloty', symbol: 'zł' },
    { code: 'CZK', flag: '🇨🇿', name: 'Czech Koruna', symbol: 'Kč' },
    { code: 'HUF', flag: '🇭🇺', name: 'Hungarian Forint', symbol: 'Ft' },
    { code: 'RON', flag: '🇷🇴', name: 'Romanian Leu', symbol: 'lei' },
    { code: 'BGN', flag: '🇧🇬', name: 'Bulgarian Lev', symbol: 'лв' }
];

// Fallback rates (approximate, only used if the live API call fails)
const FALLBACK_RATES = {
    USD: 1.08, GBP: 0.84, CHF: 0.95, CAD: 1.47, AUD: 1.62, NZD: 1.77,
    JPY: 163, CNY: 7.75, HKD: 8.42, SGD: 1.45, INR: 90, KRW: 1450,
    IDR: 17200, MYR: 5.10, PHP: 61, THB: 39, ILS: 4.0, TRY: 34,
    ZAR: 20, BRL: 6.1, MXN: 18.5, NOK: 11.4, SEK: 11.2, DKK: 7.46,
    ISK: 149, PLN: 4.28, CZK: 25.1, HUF: 393, RON: 4.97, BGN: 1.96
};

window.CURRENCY = { code: 'EUR', rate: 1, symbol: '€' };

// Format an amount that is already expressed in the target currency (i.e. eurAmount * rate).
window.formatCurrencyAmount = (amount, currency) => {
    currency = currency || window.CURRENCY;
    const rounded = Math.round(amount);
    const num = rounded.toLocaleString('en-US');
    if (currency.code === 'EUR') return num + '€';
    return currency.symbol.length <= 3 ? currency.symbol + num : num + ' ' + currency.code;
};

// Best-effort UK / US / Canada detection from the browser's timezone and locale —
// no IP lookup, runs instantly and silently, no network round-trip needed to pick a default.
const US_CA_TIMEZONES = new Set([
    'America/New_York', 'America/Detroit', 'America/Kentucky/Louisville', 'America/Kentucky/Monticello',
    'America/Indiana/Indianapolis', 'America/Indiana/Vincennes', 'America/Indiana/Winamac',
    'America/Indiana/Marengo', 'America/Indiana/Petersburg', 'America/Indiana/Vevay',
    'America/Chicago', 'America/Indiana/Tell_City', 'America/Indiana/Knox', 'America/Menominee',
    'America/North_Dakota/Center', 'America/North_Dakota/New_Salem', 'America/North_Dakota/Beulah',
    'America/Denver', 'America/Boise', 'America/Phoenix', 'America/Los_Angeles',
    'America/Anchorage', 'America/Juneau', 'America/Sitka', 'America/Metlakatla',
    'America/Yakutat', 'America/Nome', 'America/Adak', 'Pacific/Honolulu',
    'America/St_Johns', 'America/Halifax', 'America/Glace_Bay', 'America/Moncton',
    'America/Goose_Bay', 'America/Blanc-Sablon', 'America/Toronto', 'America/Nipigon',
    'America/Thunder_Bay', 'America/Iqaluit', 'America/Pangnirtung', 'America/Winnipeg',
    'America/Rainy_River', 'America/Resolute', 'America/Rankin_Inlet', 'America/Regina',
    'America/Swift_Current', 'America/Edmonton', 'America/Cambridge_Bay', 'America/Yellowknife',
    'America/Inuvik', 'America/Creston', 'America/Dawson_Creek', 'America/Fort_Nelson',
    'America/Vancouver', 'America/Whitehorse', 'America/Dawson'
]);

const getLocaleRegion = () => {
    const tag = (navigator.languages && navigator.languages[0]) || navigator.language || '';
    const match = tag.match(/-([A-Za-z]{2})$/);
    return match ? match[1].toUpperCase() : '';
};

const detectCurrencyCode = () => {
    let timeZone = '';
    try {
        timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch (e) { /* Intl unsupported — fall through to locale-only detection */ }

    if (timeZone === 'Europe/London') return 'GBP';
    if (US_CA_TIMEZONES.has(timeZone)) return 'USD';

    const region = getLocaleRegion();
    if (region === 'GB') return 'GBP';
    if (region === 'US' || region === 'CA') return 'USD';

    return 'EUR';
};

document.addEventListener('DOMContentLoaded', () => {
    const dropdowns = Array.from(document.querySelectorAll('.currency-dropdown'));
    const currencyButtons = document.querySelectorAll('.currency-btn');
    if (!dropdowns.length) return;

    const getLang = () => document.documentElement.getAttribute('data-lang') || 'en';
    const PRICE_PATTERN = /[\d.]+€/;

    // Cache every price element's original EUR amount once, so repeated
    // currency switches always convert from the true (pristine) source value.
    const collectPriceElements = () => {
        const selectors = '.price-amount, .sub-price, .addon-value, .emb-value';
        return Array.from(document.querySelectorAll(selectors)).filter(el => {
            const clone = el.cloneNode(true);
            clone.querySelectorAll('.price-unit, .emb-unit').forEach(u => u.remove());
            return /\d/.test(clone.textContent);
        });
    };

    const cacheOriginalAmounts = () => {
        collectPriceElements().forEach(el => {
            if (el.dataset.eurAmount) return;
            const clone = el.cloneNode(true);
            clone.querySelectorAll('.price-unit, .emb-unit').forEach(u => u.remove());
            const digits = clone.textContent.replace(/[^\d]/g, '');
            if (digits) el.dataset.eurAmount = digits;

            // Elements that also participate in EL/EN translation (data-en) embed the
            // price inside their translated string (e.g. data-en="from 600€"). Snapshot
            // the pristine EN/EL strings once so every currency switch derives from them
            // instead of compounding on top of an already-converted display.
            if (el.hasAttribute('data-en')) {
                el.dataset.origEn = el.getAttribute('data-en');
                el.dataset.origEl = el.dataset.el || clone.textContent.trim();
            }
        });
    };

    const applyCurrencyToPage = (currency) => {
        cacheOriginalAmounts();
        const lang = getLang();

        collectPriceElements().forEach(el => {
            const eurAmount = parseInt(el.dataset.eurAmount, 10);
            if (!eurAmount) return;
            const converted = window.formatCurrencyAmount(eurAmount * currency.rate, currency);
            const unitEl = el.querySelector('.price-unit, .emb-unit');

            if (el.dataset.origEn) {
                // Keep the translation source-of-truth in sync so future language
                // switches show the converted price instead of the stale EUR one.
                const newEn = el.dataset.origEn.replace(PRICE_PATTERN, converted);
                const newEl = el.dataset.origEl.replace(PRICE_PATTERN, converted);
                el.setAttribute('data-en', newEn);
                el.dataset.el = newEl;

                const displayText = lang === 'en' ? newEn : newEl;
                el.textContent = '';
                el.appendChild(document.createTextNode(displayText));
                if (unitEl) el.appendChild(unitEl);
            } else {
                // No translation binding on this element (e.g. .price-amount) — just
                // swap the leading number, preserving any nested unit span.
                Array.from(el.childNodes).forEach(node => {
                    if (node.nodeType === Node.TEXT_NODE) el.removeChild(node);
                });
                el.insertBefore(document.createTextNode(converted), el.firstChild);
                if (unitEl) el.appendChild(unitEl);
            }
        });
    };

    const updateHeaderButton = (currency) => {
        currencyButtons.forEach(btn => {
            const flagEl = btn.querySelector('.currency-btn-flag');
            const codeEl = btn.querySelector('.currency-btn-code');
            if (flagEl) flagEl.textContent = currency.flag || '';
            if (codeEl) {
                codeEl.textContent = currency.code;
            } else if (!flagEl) {
                btn.textContent = `${currency.flag || ''} ${currency.code}`;
            }
        });
        document.querySelectorAll('.currency-dropdown-option').forEach(opt => {
            opt.classList.toggle('active', opt.dataset.code === currency.code);
        });
    };

    const setCurrency = (currency) => {
        window.CURRENCY = currency;
        applyCurrencyToPage(currency);
        updateHeaderButton(currency);
        localStorage.setItem('site-currency', JSON.stringify(currency));
        window.dispatchEvent(new CustomEvent('currencychange', { detail: currency }));
    };

    const fetchRate = async (code) => {
        if (code === 'EUR') return 1;
        try {
            const res = await fetch(`https://api.frankfurter.app/latest?amount=1&from=EUR&to=${code}`);
            if (!res.ok) throw new Error('bad response');
            const data = await res.json();
            const rate = data.rates && data.rates[code];
            if (!rate) throw new Error('missing rate');
            return rate;
        } catch (err) {
            console.warn('Live exchange rate fetch failed, using fallback rate for', code);
            return FALLBACK_RATES[code] || 1;
        }
    };

    const selectCurrency = async (code) => {
        const meta = CURRENCIES.find(c => c.code === code);
        if (!meta) return;
        const rate = await fetchRate(code);
        setCurrency({ code: meta.code, rate, symbol: meta.symbol, flag: meta.flag });
    };

    // --- Wire each dropdown instance (header + mobile sidebar) ---
    const closeAllDropdowns = (except) => {
        dropdowns.forEach(d => {
            if (d !== except) {
                d.classList.remove('open');
                d.querySelector('.currency-btn').setAttribute('aria-expanded', 'false');
            }
        });
    };

    dropdowns.forEach(dropdown => {
        const toggle = dropdown.querySelector('.currency-btn');
        const list = dropdown.querySelector('.currency-dropdown-list');
        if (!toggle || !list) return;

        CURRENCIES.forEach(c => {
            const opt = document.createElement('button');
            opt.type = 'button';
            opt.className = 'currency-dropdown-option';
            opt.dataset.code = c.code;
            opt.setAttribute('role', 'option');
            opt.innerHTML = `<span>${c.flag} ${c.code}</span><span class="currency-dropdown-option-name">${c.name}</span>`;
            opt.addEventListener('click', () => {
                selectCurrency(c.code);
                dropdown.classList.remove('open');
                toggle.setAttribute('aria-expanded', 'false');
            });
            list.appendChild(opt);
        });

        toggle.addEventListener('click', () => {
            const willOpen = !dropdown.classList.contains('open');
            closeAllDropdowns();
            dropdown.classList.toggle('open', willOpen);
            toggle.setAttribute('aria-expanded', String(willOpen));
        });
    });

    document.addEventListener('click', (e) => {
        dropdowns.forEach(d => {
            if (!d.contains(e.target)) {
                d.classList.remove('open');
                d.querySelector('.currency-btn').setAttribute('aria-expanded', 'false');
            }
        });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeAllDropdowns();
    });

    // Init: restore a previously chosen currency, otherwise silently auto-detect
    // from timezone/locale (no modal, no interruption) and use that as the default.
    const savedRaw = localStorage.getItem('site-currency');
    if (savedRaw) {
        try {
            setCurrency(JSON.parse(savedRaw));
        } catch (e) {
            selectCurrency(detectCurrencyCode());
        }
    } else {
        selectCurrency(detectCurrencyCode());
    }
});
