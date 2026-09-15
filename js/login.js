// Sign-in for the portal.
//
// Two screens: which door you are coming through, then who you are. The door
// is a courtesy, not a permission — what an account may do comes from the
// account itself, and the server says so on the way back.
(() => {
    'use strict';

    const stepRole = document.getElementById('step-role');
    const stepCredentials = document.getElementById('step-credentials');
    const form = document.getElementById('login-form');
    const username = document.getElementById('login-username');
    const password = document.getElementById('login-password');
    const submit = document.getElementById('login-submit');
    const error = document.getElementById('login-error');
    const roleLabel = document.getElementById('login-role-label');
    const back = document.getElementById('login-back');

    if (!form) return;

    const LABELS = { partner: 'Συνεργάτης', client: 'Πελάτης' };
    const HOME = 'portal.html';

    let role = null;

    const say = (message) => {
        error.textContent = message;
        error.hidden = !message;
    };

    const show = (step) => {
        stepRole.hidden = step !== 'role';
        stepCredentials.hidden = step !== 'credentials';
    };

    // Someone who is already signed in has no business looking at this page.
    fetch('/api/session', { credentials: 'same-origin' })
        .then(res => res.json())
        .then(data => { if (data && data.user) location.replace(HOME); })
        .catch(() => { /* offline or misconfigured: the form still works */ });

    document.querySelectorAll('.role-choice').forEach(choice => {
        choice.addEventListener('click', () => {
            role = choice.dataset.role;
            roleLabel.textContent = LABELS[role] || 'Είσοδος';
            say('');
            show('credentials');
            username.focus();
        });
    });

    back.addEventListener('click', () => {
        say('');
        show('role');
    });

    const MESSAGES = {
        'wrong-credentials': 'Λάθος όνομα χρήστη ή κωδικός.',
        'too-many-attempts': 'Πολλές λάθος προσπάθειες. Δοκίμασε ξανά σε ένα τέταρτο.'
    };

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        say('');
        submit.disabled = true;
        submit.textContent = 'Γίνεται έλεγχος…';

        try {
            const res = await fetch('/api/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    username: username.value.trim(),
                    password: password.value,
                    role
                })
            });
            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
                say(MESSAGES[data.error] || data.error || 'Κάτι πήγε στραβά. Δοκίμασε ξανά.');
                password.value = '';
                password.focus();
                return;
            }

            // The door they picked was the wrong one. Nothing turns on it, so
            // say it once and take them where they actually belong.
            if (data.picked === false) {
                const actual = LABELS[data.user && data.user.role] || '';
                say(actual
                    ? `Ο λογαριασμός σου είναι ${actual.toLowerCase()}. Σε πάμε εκεί.`
                    : 'Σε πάμε στο περιβάλλον σου.');
                setTimeout(() => location.replace(HOME), 1400);
                return;
            }

            location.replace(HOME);
        } catch {
            say('Δεν έγινε σύνδεση με τον διακομιστή. Δοκίμασε ξανά.');
        } finally {
            submit.disabled = false;
            submit.textContent = 'Είσοδος';
        }
    });
})();
