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

document.addEventListener('DOMContentLoaded', () => {
    const overlay = document.getElementById('currency-overlay');
    const select = document.getElementById('currency-select');
    const confirmBtn = document.getElementById('currency-confirm-btn');
    const currencyButtons = document.querySelectorAll('.currency-btn');
    if (!overlay || !select) return;

    // Build dropdown options
    CURRENCIES.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.code;
        opt.textContent = `${c.flag} ${c.code} — ${c.name}`;
        select.appendChild(opt);
    });

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
            const codeEl = btn.querySelector('.currency-btn-code');
            if (codeEl) {
                codeEl.textContent = currency.code;
            } else {
                btn.textContent = `${currency.flag} ${currency.code}`;
            }
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

    const openModal = () => {
        overlay.classList.add('open');
        document.body.classList.add('customize-open');
    };

    const closeModal = () => {
        overlay.classList.remove('open');
        document.body.classList.remove('customize-open');
    };

    confirmBtn.addEventListener('click', async () => {
        const code = select.value;
        const meta = CURRENCIES.find(c => c.code === code);
        confirmBtn.disabled = true;
        confirmBtn.textContent = getLang() === 'el' ? 'Φόρτωση...' : 'Loading...';
        const rate = await fetchRate(code);
        setCurrency({ code: meta.code, rate, symbol: meta.symbol, flag: meta.flag });
        confirmBtn.disabled = false;
        confirmBtn.textContent = confirmBtn.dataset.el && getLang() === 'el' ? confirmBtn.dataset.el : (confirmBtn.dataset.en || 'Continue');
        closeModal();
    });

    currencyButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const saved = window.CURRENCY;
            if (saved) select.value = saved.code;
            openModal();
        });
    });

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });

    // Init: restore saved currency, or show the picker on first visit
    const savedRaw = localStorage.getItem('site-currency');
    if (savedRaw) {
        try {
            const saved = JSON.parse(savedRaw);
            setCurrency(saved);
        } catch (e) {
            openModal();
        }
    } else {
        openModal();
    }
});
