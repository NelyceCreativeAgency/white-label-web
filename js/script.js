document.addEventListener('DOMContentLoaded', () => {

    // 1. Smooth Scroll Handling for Anchor Links
    const setupSmoothScrolling = () => {
        const links = document.querySelectorAll('.desktop-nav a, .hero-actions a[href^="#"]');
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

    // 2. Interactive Category Matrix Filters
    const setupCategoryFilters = () => {
        const filterButtons = document.querySelectorAll('.filter-btn');
        const categories = document.querySelectorAll('.category-block');

        filterButtons.forEach(button => {
            button.addEventListener('click', () => {
                // Change Active Filter Button
                filterButtons.forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');

                const targetFilter = button.getAttribute('data-filter');

                categories.forEach(block => {
                    const blockCategory = block.getAttribute('data-category');
                    
                    if (targetFilter === 'all') {
                        block.style.display = 'block';
                        setTimeout(() => {
                            block.style.opacity = '1';
                            block.style.transform = 'translateY(0)';
                        }, 50);
                    } else if (blockCategory === targetFilter) {
                        block.style.display = 'block';
                        setTimeout(() => {
                            block.style.opacity = '1';
                            block.style.transform = 'translateY(0)';
                        }, 50);
                    } else {
                        block.style.opacity = '0';
                        block.style.transform = 'translateY(20px)';
                        // Short timeout to match aesthetic ease transition
                        setTimeout(() => {
                            block.style.style.display = 'none';
                        }, 400);
                        block.style.display = 'none';
                    }
                });
            });
        });
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

    // Initialize UI Actions
    setupSmoothScrolling();
    setupCategoryFilters();
    setupScrollReveal();
});