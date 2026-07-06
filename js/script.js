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

    // 2. Interactive Category Matrix Filters (dropdown + tags stay in sync)
    const setupCategoryFilters = () => {
        const tagButtons = document.querySelectorAll('.interest-tag');
        const select = document.querySelector('.interest-select');
        const categories = document.querySelectorAll('.category-block');

        const applyFilter = (targetFilter) => {
            tagButtons.forEach(btn => btn.classList.toggle('active', btn.getAttribute('data-filter') === targetFilter));
            if (select) select.value = targetFilter;

            categories.forEach(block => {
                const blockCategory = block.getAttribute('data-category');

                if (targetFilter === 'all' || blockCategory === targetFilter) {
                    block.style.display = 'block';
                    setTimeout(() => {
                        block.style.opacity = '1';
                        block.style.transform = 'translateY(0)';
                    }, 50);
                } else {
                    block.style.opacity = '0';
                    block.style.transform = 'translateY(20px)';
                    setTimeout(() => {
                        block.style.display = 'none';
                    }, 400);
                }
            });
        };

        tagButtons.forEach(button => {
            button.addEventListener('click', () => applyFilter(button.getAttribute('data-filter')));
        });

        if (select) {
            select.addEventListener('change', () => applyFilter(select.value));
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

        const applyLanguage = (lang) => {
            document.documentElement.setAttribute('lang', lang);
            document.documentElement.setAttribute('data-lang', lang);

            translatable.forEach(el => {
                if (!el.dataset.el) {
                    el.dataset.el = el.textContent;
                }
                el.textContent = lang === 'en' ? el.dataset.en : el.dataset.el;
            });

            langButtons.forEach(btn => {
                btn.classList.toggle('active', btn.dataset.lang === lang);
            });

            localStorage.setItem('site-lang', lang);
        };

        langButtons.forEach(btn => {
            btn.addEventListener('click', () => applyLanguage(btn.dataset.lang));
        });

        const savedLang = localStorage.getItem('site-lang') || 'el';
        applyLanguage(savedLang);
    };

    // Initialize UI Actions
    setupSmoothScrolling();
    setupCategoryFilters();
    setupScrollReveal();
    setupLanguageSwitcher();
});