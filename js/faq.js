document.addEventListener('DOMContentLoaded', () => {

    // FAQ accordion: each .faq-item toggles independently (multiple can be
    // open at once). Height animation is handled by CSS grid-rows, so this
    // just flips the state class + aria-expanded.
    document.querySelectorAll('.faq-item').forEach(item => {
        const question = item.querySelector('.faq-question');
        if (!question) return;

        question.addEventListener('click', () => {
            const isOpen = item.classList.toggle('is-open');
            question.setAttribute('aria-expanded', String(isOpen));
        });
    });

});
