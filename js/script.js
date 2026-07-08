document.addEventListener('DOMContentLoaded', () => {

    // 1. Smooth Scroll Handling for Anchor Links
    const setupSmoothScrolling = () => {
        const links = document.querySelectorAll('.hero-actions a[href^="#"]');
        links.forEach(link => {
            link.addEventListener('click', (e) => {
                const targetId = link.getAttribute('href');
                if (targetId.startsWith('#')) {
                    e.preventDefault();
                    const targetElement = document.querySelector(targetId);
                    if (targetElement) {
                        const headerOffset = 90;
                        const elementPosition = targetElement.getBoundingClientRect().top;
                        const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

                        window.scrollTo({
                            top: offsetPosition,
                            behavior: 'smooth'
                        });
                    }
                }
            });
        });
    };

    // 2. Interactive Category Matrix Filters (tags + search stay in sync) + Search Suggestions
    const setupCategoryFilters = () => {
        const tagButtons = document.querySelectorAll('.interest-tag');
        const searchInput = document.getElementById('service-search');
        const suggestionsBox = document.getElementById('search-suggestions');
        const categories = document.querySelectorAll('.category-block');

        let currentCategory = 'all';
        let activeSuggestionIndex = -1;

        const showBlock = (block) => {
            block.style.display = 'block';
            setTimeout(() => {
                block.style.opacity = '1';
                block.style.transform = 'translateY(0)';
            }, 50);
        };

        const hideBlock = (block) => {
            block.style.opacity = '0';
            block.style.transform = 'translateY(20px)';
            setTimeout(() => {
                block.style.display = 'none';
            }, 400);
        };

        const itemMatchesSearch = (item, term) => {
            if (!term) return true;
            const title = (item.querySelector('.item-title, h5') || {}).textContent || '';
            const desc = (item.querySelector('.item-desc') || {}).textContent || '';
            const own = item.matches('.item-title, h5, .addon-name') ? item.textContent : '';
            return (title + ' ' + desc + ' ' + own).toLowerCase().includes(term);
        };

        const applyFilters = () => {
            const term = searchInput ? searchInput.value.trim().toLowerCase() : '';

            categories.forEach(block => {
                const blockCategory = block.getAttribute('data-category');
                const categoryMatch = currentCategory === 'all' || blockCategory === currentCategory;

                // Individual items directly inside the block (not sub-block containers)
                const items = block.querySelectorAll('.price-card:not(.container-sub-block), .sub-item, .addon-item');
                let anyMatch = false;
                items.forEach(item => {
                    const matches = itemMatchesSearch(item, term);
                    item.style.display = matches ? '' : 'none';
                    if (matches) anyMatch = true;
                });

                // Collapse sub-block / addons containers if none of their children matched
                block.querySelectorAll('.container-sub-block, .addons-container').forEach(wrapper => {
                    const children = wrapper.querySelectorAll('.sub-item, .addon-item');
                    const visibleChildren = Array.from(children).filter(c => c.style.display !== 'none');
                    wrapper.style.display = (term && visibleChildren.length === 0) ? 'none' : '';
                });

                const visible = categoryMatch && (!term || anyMatch);
                if (visible) {
                    showBlock(block);
                } else {
                    hideBlock(block);
                }
            });
        };

        tagButtons.forEach(button => {
            button.addEventListener('click', () => {
                currentCategory = button.getAttribute('data-filter');
                tagButtons.forEach(btn => btn.classList.toggle('active', btn === button));
                applyFilters();
            });
        });

        // --- Search Suggestions ("AI-style" instant matching as you type) ---
        const getSuggestionSource = () => {
            const nodes = document.querySelectorAll(
                '.category-block .price-card:not(.container-sub-block) .item-title, .category-block .sub-item h5, .category-block .addon-item .addon-name'
            );
            return Array.from(nodes).map(el => {
                const block = el.closest('.category-block');
                const categoryTitle = block ? (block.querySelector('.category-title') || {}).textContent : '';
                const target = el.closest('.price-card, .sub-item, .addon-item');
                return { text: el.textContent.trim(), categoryTitle: categoryTitle || '', target };
            });
        };

        const renderSuggestions = (matches) => {
            suggestionsBox.innerHTML = '';
            activeSuggestionIndex = -1;

            if (!matches.length) {
                suggestionsBox.classList.remove('open');
                return;
            }

            matches.forEach(match => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'search-suggestion';
                btn.innerHTML = `<span>${match.text}</span><span class="search-suggestion-category">${match.categoryTitle}</span>`;
                btn.addEventListener('click', () => selectSuggestion(match));
                suggestionsBox.appendChild(btn);
            });

            suggestionsBox.classList.add('open');
        };

        const selectSuggestion = (match) => {
            searchInput.value = match.text;
            suggestionsBox.classList.remove('open');
            applyFilters();
            if (match.target) {
                setTimeout(() => {
                    match.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 100);
            }
        };

        const updateSuggestions = () => {
            const term = searchInput.value.trim().toLowerCase();
            if (!term) {
                suggestionsBox.classList.remove('open');
                return;
            }
            const source = getSuggestionSource();
            const matches = source
                .filter(item => item.text.toLowerCase().includes(term))
                .sort((a, b) => a.text.toLowerCase().indexOf(term) - b.text.toLowerCase().indexOf(term))
                .slice(0, 6);
            renderSuggestions(matches);
        };

        if (searchInput) {
            searchInput.addEventListener('input', () => {
                applyFilters();
                updateSuggestions();
            });

            searchInput.addEventListener('keydown', (e) => {
                const items = Array.from(suggestionsBox.querySelectorAll('.search-suggestion'));
                if (!items.length || !suggestionsBox.classList.contains('open')) return;

                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    activeSuggestionIndex = Math.min(activeSuggestionIndex + 1, items.length - 1);
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    activeSuggestionIndex = Math.max(activeSuggestionIndex - 1, 0);
                } else if (e.key === 'Enter' && activeSuggestionIndex >= 0) {
                    e.preventDefault();
                    items[activeSuggestionIndex].click();
                    return;
                } else if (e.key === 'Escape') {
                    suggestionsBox.classList.remove('open');
                    return;
                } else {
                    return;
                }

                items.forEach((item, i) => item.classList.toggle('active', i === activeSuggestionIndex));
            });

            document.addEventListener('click', (e) => {
                if (!searchInput.contains(e.target) && !suggestionsBox.contains(e.target)) {
                    suggestionsBox.classList.remove('open');
                }
            });
        }
    };

    // 3. Subtle Motion Scroll Reveal with Intersection Observer
    const setupScrollReveal = () => {
        const revealElements = document.querySelectorAll('.scroll-reveal');
        
        const observerOptions = {
            root: null,
            threshold: 0.1,
            rootMargin: '0px 0px -40px 0px'
        };

        const revealCallback = (entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('revealed');
                    observer.unobserve(entry.target); // Reveal once
                }
            });
        };

        const observer = new IntersectionObserver(revealCallback, observerOptions);
        revealElements.forEach(element => observer.observe(element));
    };

    // 4. Language Switcher (EL / EN)
    const setupLanguageSwitcher = () => {
        const langButtons = document.querySelectorAll('.lang-btn');
        const translatable = document.querySelectorAll('[data-en]');
        const translatablePlaceholders = document.querySelectorAll('[data-en-placeholder]');

        const applyLanguage = (lang) => {
            document.documentElement.setAttribute('lang', lang);
            document.documentElement.setAttribute('data-lang', lang);

            const ownText = (el) => {
                let text = '';
                el.childNodes.forEach(node => {
                    if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
                });
                return text.trim();
            };

            translatable.forEach(el => {
                if (!el.dataset.el) {
                    el.dataset.el = ownText(el);
                }
                const newText = lang === 'en' ? el.dataset.en : el.dataset.el;
                // Replace only direct text nodes so nested elements (e.g. a unit span
                // with its own data-en) survive the swap instead of being wiped out.
                const childElements = Array.from(el.children);
                Array.from(el.childNodes).forEach(node => {
                    if (node.nodeType === Node.TEXT_NODE) el.removeChild(node);
                });
                el.insertBefore(document.createTextNode(newText), el.firstChild);
                childElements.forEach(child => el.appendChild(child));
            });

            translatablePlaceholders.forEach(el => {
                if (!el.dataset.elPlaceholder) {
                    el.dataset.elPlaceholder = el.getAttribute('placeholder');
                }
                el.setAttribute('placeholder', lang === 'en' ? el.dataset.enPlaceholder : el.dataset.elPlaceholder);
            });

            langButtons.forEach(btn => {
                btn.classList.toggle('active', btn.dataset.lang === lang);
            });

            localStorage.setItem('site-lang', lang);
        };

        langButtons.forEach(btn => {
            btn.addEventListener('click', () => applyLanguage(btn.dataset.lang));
        });

        const savedLang = localStorage.getItem('site-lang') || 'en';
        applyLanguage(savedLang);
    };

    // 5. Mobile Sidebar (Contact Hub + Currency, hidden from the header on small screens)
    const setupMobileSidebar = () => {
        const menuBtn = document.getElementById('mobile-menu-btn');
        const sidebar = document.getElementById('mobile-sidebar');
        const overlay = document.getElementById('mobile-sidebar-overlay');
        const closeBtn = document.getElementById('mobile-sidebar-close');
        if (!menuBtn || !sidebar || !overlay) return;

        const openSidebar = () => {
            menuBtn.classList.add('active');
            sidebar.classList.add('open');
            overlay.classList.add('open');
        };

        const closeSidebar = () => {
            menuBtn.classList.remove('active');
            sidebar.classList.remove('open');
            overlay.classList.remove('open');
        };

        menuBtn.addEventListener('click', () => {
            sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
        });
        if (closeBtn) closeBtn.addEventListener('click', closeSidebar);
        overlay.addEventListener('click', closeSidebar);

        // The sidebar's currency button opens the currency modal on top of it —
        // close the sidebar first so both aren't visible at once.
        sidebar.querySelectorAll('.currency-btn').forEach(btn => {
            btn.addEventListener('click', closeSidebar);
        });
    };

    // Initialize UI Actions
    setupSmoothScrolling();
    setupCategoryFilters();
    setupScrollReveal();
    setupLanguageSwitcher();
    setupMobileSidebar();
});