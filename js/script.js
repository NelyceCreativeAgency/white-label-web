document.addEventListener('DOMContentLoaded', () => {

    // Experimental: inertia smooth scrolling, desktop only
    let lenisInstance = null;
    const setupInertiaScroll = () => {
        const isDesktop = window.matchMedia('(min-width: 769px)').matches;
        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!isDesktop || prefersReducedMotion || typeof Lenis === 'undefined') return;

        lenisInstance = new Lenis({
            duration: 1.1,
            easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        });

        const raf = (time) => {
            lenisInstance.raf(time);
            requestAnimationFrame(raf);
        };
        requestAnimationFrame(raf);
    };

    // Prefetch Geologica on EL hover/focus/touch, so switching to Greek
    // doesn't cause a flash while the 5 weight files download on demand.
    const setupGeologicaPrefetch = () => {
        if (!('fonts' in document)) return;

        let prefetched = false;
        const prefetch = () => {
            if (prefetched) return;
            prefetched = true;
            ['300', '400', '500', '600', '700'].forEach(weight => {
                document.fonts.load(`${weight} 16px Geologica`).catch(() => {});
            });
        };

        document.querySelectorAll('.lang-btn[data-lang="el"]').forEach(btn => {
            btn.addEventListener('mouseenter', prefetch, { once: true });
            btn.addEventListener('focus', prefetch, { once: true });
            btn.addEventListener('touchstart', prefetch, { once: true, passive: true });
        });
    };

    // Force the sticky category sidebar to release before the final CTA
    // section, since Lenis doesn't reliably trigger the browser's native
    // re-evaluation of sticky state during its own scroll loop.
    const setupSidebarUnstick = () => {
        const sidebar = document.querySelector('.category-sidebar');
        const ctaSection = document.querySelector('.final-cta-section');
        if (!sidebar || !ctaSection || !('IntersectionObserver' in window)) return;

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                sidebar.classList.toggle('is-unstuck', entry.isIntersecting);
            });
        }, { rootMargin: '-110px 0px 0px 0px', threshold: 0 });

        observer.observe(ctaSection);
    };

    // 0. Ambient Sparkles (warm embers drifting upward)
    const setupNightSky = () => {
        const sky = document.querySelector('.night-sky');
        if (!sky) return;

        const SPARKLE_COLORS = ['#ff6b35', '#ffb800', '#ff9d4d'];
        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        const SPARKLE_COUNT = isMobile ? 28 : 90;
        for (let i = 0; i < SPARKLE_COUNT; i++) {
            const sparkle = document.createElement('span');
            sparkle.className = 'sparkle';

            // Mostly-upward flow (like rising embers) with some side drift for variety.
            const angle = -Math.PI / 2 + (Math.random() - 0.5) * (Math.PI / 2);
            const distance = Math.random() * 200 + 120;
            const dx = Math.cos(angle) * distance;
            const dy = Math.sin(angle) * distance;
            const size = (Math.random() * 2.5 + 2.5).toFixed(1);

            sparkle.style.left = `${Math.random() * 100}%`;
            sparkle.style.top = `${Math.random() * 100}%`;
            sparkle.style.width = `${size}px`;
            sparkle.style.height = `${size}px`;
            sparkle.style.color = SPARKLE_COLORS[Math.floor(Math.random() * SPARKLE_COLORS.length)];
            sparkle.style.setProperty('--dx', `${dx.toFixed(0)}px`);
            sparkle.style.setProperty('--dy', `${dy.toFixed(0)}px`);
            sparkle.style.setProperty('--flow-duration', `${(Math.random() * 6 + 8).toFixed(1)}s`);
            sparkle.style.setProperty('--flow-delay', `${(Math.random() * 8).toFixed(1)}s`);
            sparkle.style.setProperty('--sparkle-opacity', `${(Math.random() * 0.35 + 0.5).toFixed(2)}`);
            sky.appendChild(sparkle);
        }
    };

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

                        if (lenisInstance) {
                            lenisInstance.scrollTo(targetElement, { offset: -headerOffset });
                        } else {
                            const elementPosition = targetElement.getBoundingClientRect().top;
                            const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
                            window.scrollTo({
                                top: offsetPosition,
                                behavior: 'smooth'
                            });
                        }
                    }
                }
            });
        });
    };

    // Collapsed header search: icon by default, click to reveal the input inline
    const setupHeaderSearchToggle = () => {
        const wrapper = document.getElementById('header-search');
        const toggleBtn = document.getElementById('search-toggle-btn');
        const input = wrapper ? wrapper.querySelector('.search-input') : null;
        if (!wrapper || !toggleBtn || !input) return;

        const open = () => {
            wrapper.classList.add('is-open');
            toggleBtn.setAttribute('aria-expanded', 'true');
            input.focus();
        };
        const close = () => {
            wrapper.classList.remove('is-open');
            toggleBtn.setAttribute('aria-expanded', 'false');
        };

        toggleBtn.addEventListener('click', () => {
            if (wrapper.classList.contains('is-open')) {
                if (input.value.trim() === '') close();
                else input.focus();
            } else {
                open();
            }
        });

        document.addEventListener('click', (e) => {
            if (!wrapper.contains(e.target) && input.value.trim() === '') close();
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                input.value = '';
                close();
                toggleBtn.blur();
            }
        });
    };

    // --- Forgiving search matching: accent/case-insensitive, tolerates typos
    // and partial words (e.g. "λογο" or "logot" both reach "Λογότυπο"/"Logo"). ---
    const normalizeSearchText = (str) => (str || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // strip Greek tonos / other combining accents
        .replace(/ς/g, 'σ'); // treat final sigma same as regular sigma

    const levenshteinDistance = (a, b) => {
        const m = a.length, n = b.length;
        if (m === 0) return n;
        if (n === 0) return m;
        let prevRow = Array.from({ length: n + 1 }, (_, j) => j);
        for (let i = 1; i <= m; i++) {
            const currRow = [i];
            for (let j = 1; j <= n; j++) {
                currRow[j] = a[i - 1] === b[j - 1]
                    ? prevRow[j - 1]
                    : 1 + Math.min(prevRow[j], currRow[j - 1], prevRow[j - 1]);
            }
            prevRow = currRow;
        }
        return prevRow[n];
    };

    // Returns a match rank (lower = better) or -1 if the term doesn't match at all.
    const fuzzyMatchScore = (haystack, term) => {
        const normHaystack = normalizeSearchText(haystack);
        const normTerm = normalizeSearchText(term).trim();
        if (!normTerm) return 0;

        const exactIndex = normHaystack.indexOf(normTerm);
        if (exactIndex !== -1) return exactIndex; // exact substring: best, earlier match ranks higher

        const words = normHaystack.split(/[\s,/&()\-·]+/).filter(Boolean);
        const maxDist = normTerm.length <= 4 ? 1 : normTerm.length <= 8 ? 2 : 3;
        let best = -1;
        words.forEach(word => {
            if (word.startsWith(normTerm) || normTerm.startsWith(word)) {
                best = best === -1 ? 500 : best; // prefix match: good, but ranks below exact substrings
                return;
            }
            if (Math.abs(word.length - normTerm.length) > maxDist + 2) return;
            const dist = levenshteinDistance(word, normTerm);
            if (dist <= maxDist) {
                const score = 1000 + dist; // fuzzy/typo match: still surfaced, ranked last
                if (best === -1 || score < best) best = score;
            }
        });
        return best;
    };

    // 2. Interactive Category Sidebar Filter + Search Suggestions
    const setupCategoryFilters = () => {
        const sidebarLinks = document.querySelectorAll('.category-sidebar-link, .category-pill');
        // There are two search bar instances in the DOM (desktop: in the header,
        // mobile: in its own section) — only one is visible per breakpoint, but
        // both stay wired and mirrored so switching viewport mid-search keeps the term.
        const searchInputs = Array.from(document.querySelectorAll('.search-input'));
        const categories = document.querySelectorAll('.category-block');

        // currentCategory is either "all", a group key (design/web/marketing/motion,
        // matched against data-category) or a single block id (matched against the
        // block's own id) so the sidebar can filter to one exact service.
        let currentCategory = 'all';
        // Populated by the mobile filter drawer with the full set of filterable item
        // ids; null means "no drawer restriction" (every item is a candidate).
        let selectedServiceIds = null;

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
            const block = item.closest('.category-block');
            const keywords = block ? (block.dataset.keywords || '') : '';
            return fuzzyMatchScore(title + ' ' + desc + ' ' + own + ' ' + keywords, term) !== -1;
        };

        const applyFilters = () => {
            const activeInput = searchInputs.find(input => input.value.trim() !== '');
            const term = activeInput ? activeInput.value.trim().toLowerCase() : '';

            categories.forEach(block => {
                const blockCategory = block.getAttribute('data-category');
                const categoryMatch = currentCategory === 'all'
                    || blockCategory === currentCategory
                    || block.id === currentCategory;

                // Individual items directly inside the block (not sub-block containers)
                const items = block.querySelectorAll('.price-card:not(.container-sub-block), .sub-item, .addon-item');
                let anyMatch = false;
                items.forEach(item => {
                    const matchesSelection = !selectedServiceIds || selectedServiceIds.has(item.dataset.filterId);
                    const matches = matchesSelection && itemMatchesSearch(item, term);
                    item.style.display = matches ? '' : 'none';
                    if (matches) anyMatch = true;
                });

                // Collapse sub-block / addons containers if none of their children matched
                block.querySelectorAll('.container-sub-block, .addons-container').forEach(wrapper => {
                    const children = wrapper.querySelectorAll('.sub-item, .addon-item');
                    const visibleChildren = Array.from(children).filter(c => c.style.display !== 'none');
                    wrapper.style.display = (term && visibleChildren.length === 0) ? 'none' : '';
                });

                // Hide the whole block once none of its items survive (search term and/or
                // the drawer's per-service selection can both empty it out completely).
                const visible = categoryMatch && (!items.length || anyMatch);
                if (visible) {
                    showBlock(block);
                } else {
                    hideBlock(block);
                }
            });
        };

        const setActiveFilter = (filterValue, scrollTarget) => {
            currentCategory = filterValue;
            sidebarLinks.forEach(link => link.classList.toggle('active', link.getAttribute('data-filter') === filterValue));
            applyFilters();

            if (scrollTarget) {
                // Wait for hideBlock's 400ms display:none so collapsing categories
                // aren't still occupying layout height when we measure the target's position.
                setTimeout(() => {
                    // Use the offsetTop chain rather than getBoundingClientRect(): the target's
                    // scroll-reveal fade-in is still mid-transition at this point, and
                    // getBoundingClientRect() would include that transform's live offset.
                    // offsetTop is a pure layout value, unaffected by the transform animation.
                    let layoutTop = 0;
                    for (let el = scrollTarget; el; el = el.offsetParent) {
                        layoutTop += el.offsetTop;
                    }
                    // Account for the sticky main header, plus the mobile pills bar
                    // (also sticky, stacked below it) when that bar is visible.
                    const header = document.querySelector('.main-header');
                    const pillsBar = document.querySelector('.category-pills-mobile');
                    let headerOffset = header ? header.offsetHeight : 90;
                    if (pillsBar && getComputedStyle(pillsBar).display !== 'none') {
                        headerOffset += pillsBar.offsetHeight;
                    }
                    headerOffset += 20;
                    window.scrollTo({ top: layoutTop - headerOffset, behavior: 'smooth' });
                }, 420);
            }
        };

        sidebarLinks.forEach(link => {
            link.addEventListener('click', () => {
                const filterValue = link.getAttribute('data-filter');
                const target = filterValue === 'all' ? null : document.getElementById(filterValue);
                setActiveFilter(filterValue, target);
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
                const keywords = block ? (block.dataset.keywords || '') : '';
                const target = el.closest('.price-card, .sub-item, .addon-item');
                // `text` is what's shown in the dropdown; `keywords` (category synonyms,
                // Greek/English) only widen what the term can match against, invisibly.
                return { text: el.textContent.trim(), categoryTitle: categoryTitle || '', keywords, target };
            });
        };

        // Keep every search instance in sync so switching viewport mid-search carries the term over.
        const syncSearchInputs = (value) => {
            searchInputs.forEach(input => { input.value = value; });
        };

        searchInputs.forEach(searchInput => {
            const suggestionsBox = searchInput.closest('.search-bar-wrapper').querySelector('.search-suggestions');
            if (!suggestionsBox) return;
            let activeSuggestionIndex = -1;

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
                syncSearchInputs(match.text);
                suggestionsBox.classList.remove('open');
                applyFilters();
                if (match.target) {
                    setTimeout(() => {
                        match.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 100);
                }
            };

            const updateSuggestions = () => {
                const term = searchInput.value.trim();
                if (!term) {
                    suggestionsBox.classList.remove('open');
                    return;
                }
                const source = getSuggestionSource();
                const matches = source
                    .map(item => ({ item, score: fuzzyMatchScore(item.text + ' ' + item.keywords, term) }))
                    .filter(({ score }) => score !== -1)
                    .sort((a, b) => a.score - b.score)
                    .map(({ item }) => item)
                    .slice(0, 6);
                renderSuggestions(matches);
            };

            searchInput.addEventListener('input', () => {
                syncSearchInputs(searchInput.value);
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
        });

        // --- Mobile Filter Drawer: per-service checkboxes, grouped by category ---
        const drawerTrigger = document.getElementById('filter-drawer-trigger');
        const drawer = document.getElementById('filter-drawer');
        const drawerOverlay = document.getElementById('filter-drawer-overlay');
        const drawerClose = document.getElementById('filter-drawer-close');
        const drawerBody = document.getElementById('filter-drawer-body');
        const drawerReset = document.getElementById('filter-drawer-reset');
        const drawerApply = document.getElementById('filter-drawer-apply');

        if (drawerTrigger && drawer && drawerOverlay && drawerBody) {
            const allFilterIds = [];
            // The drawer is built once, but the language switcher can relabel item/category
            // titles afterwards — keep {span, sourceEl} pairs so text can be refreshed on open.
            const labelSyncPairs = [];

            categories.forEach(block => {
                const items = block.querySelectorAll('.price-card:not(.container-sub-block), .sub-item, .addon-item');
                const titleEl = block.querySelector('.category-title');

                const group = document.createElement('div');
                group.className = 'filter-group';

                const header = document.createElement('label');
                header.className = 'filter-group-header';
                const groupCheckbox = document.createElement('input');
                groupCheckbox.type = 'checkbox';
                groupCheckbox.checked = true;
                const headerText = document.createElement('span');
                headerText.textContent = titleEl ? titleEl.textContent.trim() : block.id;
                if (titleEl) labelSyncPairs.push({ span: headerText, sourceEl: titleEl });
                header.appendChild(groupCheckbox);
                header.appendChild(headerText);
                group.appendChild(header);

                const itemsWrap = document.createElement('div');
                itemsWrap.className = 'filter-group-items';
                const itemCheckboxes = [];

                items.forEach((item, index) => {
                    const id = item.dataset.serviceId || `${block.id}-${index}`;
                    item.dataset.filterId = id;
                    allFilterIds.push(id);

                    const titleNode = item.querySelector('.item-title, h5, .addon-name');
                    const label = document.createElement('label');
                    label.className = 'filter-item-row';
                    const cb = document.createElement('input');
                    cb.type = 'checkbox';
                    cb.checked = true;
                    cb.dataset.filterId = id;
                    const span = document.createElement('span');
                    span.textContent = titleNode ? titleNode.textContent.trim() : id;
                    if (titleNode) labelSyncPairs.push({ span, sourceEl: titleNode });
                    label.appendChild(cb);
                    label.appendChild(span);
                    itemsWrap.appendChild(label);
                    itemCheckboxes.push(cb);
                });

                if (!itemCheckboxes.length) return;

                const updateGroupCheckboxState = () => {
                    const checkedCount = itemCheckboxes.filter(cb => cb.checked).length;
                    groupCheckbox.checked = checkedCount === itemCheckboxes.length;
                    groupCheckbox.indeterminate = checkedCount > 0 && checkedCount < itemCheckboxes.length;
                    updateTriggerState();
                };

                itemCheckboxes.forEach(cb => {
                    cb.addEventListener('change', () => {
                        if (cb.checked) selectedServiceIds.add(cb.dataset.filterId);
                        else selectedServiceIds.delete(cb.dataset.filterId);
                        updateGroupCheckboxState();
                    });
                });

                groupCheckbox.addEventListener('change', () => {
                    itemCheckboxes.forEach(cb => {
                        cb.checked = groupCheckbox.checked;
                        if (cb.checked) selectedServiceIds.add(cb.dataset.filterId);
                        else selectedServiceIds.delete(cb.dataset.filterId);
                    });
                    groupCheckbox.indeterminate = false;
                    updateTriggerState();
                });

                group.appendChild(itemsWrap);
                drawerBody.appendChild(group);
            });

            // Everything selected by default so the drawer starts in sync with "All Services".
            selectedServiceIds = new Set(allFilterIds);

            const updateTriggerState = () => {
                drawerTrigger.classList.toggle('has-custom-selection', selectedServiceIds.size < allFilterIds.length);
            };

            const openDrawer = () => {
                labelSyncPairs.forEach(({ span, sourceEl }) => {
                    span.textContent = sourceEl.textContent.trim();
                });
                drawer.classList.add('open');
                drawerOverlay.classList.add('open');
            };

            const closeDrawer = () => {
                drawer.classList.remove('open');
                drawerOverlay.classList.remove('open');
                // A drawer selection can span multiple categories, so drop back to
                // "All Services" and let the checked-item set alone decide visibility.
                currentCategory = 'all';
                sidebarLinks.forEach(link => link.classList.toggle('active', link.getAttribute('data-filter') === 'all'));
                applyFilters();
            };

            drawerTrigger.addEventListener('click', openDrawer);
            drawerClose.addEventListener('click', closeDrawer);
            drawerOverlay.addEventListener('click', closeDrawer);
            if (drawerApply) drawerApply.addEventListener('click', closeDrawer);

            if (drawerReset) {
                drawerReset.addEventListener('click', () => {
                    selectedServiceIds = new Set(allFilterIds);
                    drawerBody.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                        cb.checked = true;
                        cb.indeterminate = false;
                    });
                    updateTriggerState();
                });
            }
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
    };

    // 6. Desktop Sidebar Scrollspy: highlight whichever category is currently in
    // view as the user scrolls, without hiding the others (that only happens on click).
    const setupCategoryScrollSpy = () => {
        const blocks = Array.from(document.querySelectorAll('.category-block'));
        const sidebarLinks = document.querySelectorAll('.category-sidebar-link');
        if (!blocks.length || !sidebarLinks.length) return;

        const desktopQuery = window.matchMedia('(min-width: 769px)');
        let ticking = false;

        const updateActive = () => {
            ticking = false;
            if (!desktopQuery.matches) return;

            const header = document.querySelector('.main-header');
            const refY = (header ? header.getBoundingClientRect().bottom : 0) + 40;

            let current = null;
            blocks.forEach(block => {
                if (getComputedStyle(block).display === 'none') return;
                if (block.getBoundingClientRect().top <= refY) {
                    current = block;
                }
            });
            if (!current) {
                current = blocks.find(block => getComputedStyle(block).display !== 'none');
            }
            if (!current) return;

            sidebarLinks.forEach(link => {
                link.classList.toggle('active', link.getAttribute('data-filter') === current.id);
            });
        };

        window.addEventListener('scroll', () => {
            if (!ticking) {
                ticking = true;
                requestAnimationFrame(updateActive);
            }
        }, { passive: true });

        updateActive();
    };

    // Initialize UI Actions
    setupInertiaScroll();
    setupGeologicaPrefetch();
    setupNightSky();
    setupSidebarUnstick();
    setupSmoothScrolling();
    setupHeaderSearchToggle();
    setupCategoryFilters();
    setupScrollReveal();
    setupLanguageSwitcher();
    setupMobileSidebar();
    setupCategoryScrollSpy();
});