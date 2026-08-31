document.addEventListener('DOMContentLoaded', function () {
    const toggle = document.getElementById('menuToggle');
    const nav = document.querySelector('nav');

    if (toggle && nav) {
        toggle.addEventListener('click', function () {
            const open = nav.style.display === 'block';
            nav.style.display = open ? 'none' : 'block';
        });
    }
});
