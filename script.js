document.addEventListener('DOMContentLoaded', function() {
    // Mobile Menu Toggle
    const menuToggle = document.querySelector('.menu-toggle');
    const nav = document.querySelector('nav');
    
    if (menuToggle) {
        menuToggle.addEventListener('click', function() {
            nav.classList.toggle('active');
            
            // Toggle menu icon
            const icon = this.querySelector('i');
            if (icon.classList.contains('fa-bars')) {
                icon.classList.remove('fa-bars');
                icon.classList.add('fa-times');
            } else {
                icon.classList.remove('fa-times');
                icon.classList.add('fa-bars');
            }
        });
    }
    
    // Close mobile menu when clicking outside
    document.addEventListener('click', function(event) {
        if (nav && nav.classList.contains('active') && !event.target.closest('nav') && !event.target.closest('.menu-toggle')) {
            nav.classList.remove('active');
            
            // Reset menu icon
            const icon = menuToggle.querySelector('i');
            if (icon.classList.contains('fa-times')) {
                icon.classList.remove('fa-times');
                icon.classList.add('fa-bars');
            }
        }
    });
    
    // Smooth scrolling for navigation links
    const navLinks = document.querySelectorAll('nav a, .footer-links a, .cta-buttons a');
    
    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            // Check if the link is an anchor link
            if (this.getAttribute('href').startsWith('#')) {
                e.preventDefault();
                
                const targetId = this.getAttribute('href');
                const targetElement = document.querySelector(targetId);
                
                if (targetElement) {
                    // Close mobile menu if open
                    if (nav && nav.classList.contains('active')) {
                        nav.classList.remove('active');
                        
                        // Reset menu icon
                        const icon = menuToggle.querySelector('i');
                        if (icon.classList.contains('fa-times')) {
                            icon.classList.remove('fa-times');
                            icon.classList.add('fa-bars');
                        }
                    }
                    
                    // Smooth scroll to target
                    window.scrollTo({
                        top: targetElement.offsetTop - 70, // Adjust for header height
                        behavior: 'smooth'
                    });
                    
                    // Update active link
                    navLinks.forEach(link => link.classList.remove('active'));
                    this.classList.add('active');
                }
            }
        });
    });
    
    // Update active navigation link on scroll
    window.addEventListener('scroll', function() {
        const scrollPosition = window.scrollY;
        
        // Get all sections
        const sections = document.querySelectorAll('section');
        
        sections.forEach(section => {
            const sectionTop = section.offsetTop - 100; // Adjust for header height
            const sectionHeight = section.offsetHeight;
            const sectionId = section.getAttribute('id');
            
            if (scrollPosition >= sectionTop && scrollPosition < sectionTop + sectionHeight) {
                // Remove active class from all links
                navLinks.forEach(link => link.classList.remove('active'));
                
                // Add active class to corresponding link
                const activeLink = document.querySelector(`nav a[href="#${sectionId}"]`);
                if (activeLink) {
                    activeLink.classList.add('active');
                }
            }
        });
        
        // Header scroll effect
        const header = document.querySelector('header');
        if (header) {
            if (scrollPosition > 100) {
                header.style.padding = '10px 0';
                header.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.1)';
            } else {
                header.style.padding = '15px 0';
                header.style.boxShadow = 'none';
            }
        }
    });
    
    // Form submission
    const forms = document.querySelectorAll('form');

    forms.forEach(form => {
        form.addEventListener('submit', function(e) {
            e.preventDefault();

            // Get form inputs
            const formInputs = this.querySelectorAll('input, textarea');
            let isValid = true;

            // Simple validation
            formInputs.forEach(input => {
                if (input.hasAttribute('required') && !input.value.trim()) {
                    isValid = false;
                    input.style.borderColor = 'red';
                } else {
                    input.style.borderColor = '#ddd';
                }
            });

            if (!isValid) {
                return;
            }

            const formParent = this.parentElement;
            const showMessage = (text, isError) => {
                const message = document.createElement('div');
                message.className = 'success-message';
                message.textContent = text;
                message.style.color = isError ? '#b00020' : '#04844b';
                message.style.padding = '15px';
                message.style.marginTop = '15px';
                message.style.backgroundColor = isError ? 'rgba(176, 0, 32, 0.1)' : 'rgba(4, 132, 75, 0.1)';
                message.style.borderRadius = '5px';

                formParent.appendChild(message);

                setTimeout(() => {
                    message.remove();
                }, 5000);
            };

            if (this.hasAttribute('data-netlify')) {
                // Real submission: handled by Netlify Forms
                const encode = (data) => {
                    return Object.keys(data)
                        .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(data[key]))
                        .join('&');
                };
                const data = Object.fromEntries(new FormData(this).entries());

                fetch('/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: encode(data)
                })
                    .then(response => {
                        if (response.ok) {
                            this.reset();
                            showMessage('Thank you for your message! We will get back to you soon.', false);
                        } else {
                            showMessage('Something went wrong sending your message. Please email us directly.', true);
                        }
                    })
                    .catch(() => {
                        showMessage('Something went wrong sending your message. Please email us directly.', true);
                    });
            } else {
                // No backend wired up yet for this form
                this.reset();
                showMessage('Thank you for your message! We will get back to you soon.', false);
            }
        });
    });

    // Theme color switcher
    const themeToggle = document.querySelector('.theme-toggle');
    const themePanel = document.querySelector('.theme-panel');
    const themeSwatches = document.querySelectorAll('.theme-swatch');
    const themeCustomColor = document.getElementById('theme-custom-color');
    const themeReset = document.querySelector('.theme-reset');
    const THEME_STORAGE_KEY = 'landh-theme';
    const DEFAULT_THEME = { primary: '#0066cc', secondary: '#00a1e0' };

    const shadeColor = (hex, percent) => {
        const num = parseInt(hex.replace('#', ''), 16);
        const amt = Math.round(2.55 * percent);
        const r = Math.min(255, Math.max(0, (num >> 16) + amt));
        const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00ff) + amt));
        const b = Math.min(255, Math.max(0, (num & 0x0000ff) + amt));
        return '#' + (0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1);
    };

    const applyTheme = (primary, secondary) => {
        document.documentElement.style.setProperty('--primary-color', primary);
        document.documentElement.style.setProperty('--secondary-color', secondary);
        if (themeCustomColor) {
            themeCustomColor.value = primary;
        }
    };

    const saveTheme = (primary, secondary) => {
        try {
            localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ primary, secondary }));
        } catch (e) {}
    };

    if (themeToggle && themePanel) {
        themeToggle.addEventListener('click', function(e) {
            e.stopPropagation();
            const isOpen = themePanel.classList.toggle('open');
            themeToggle.setAttribute('aria-expanded', isOpen);
        });

        document.addEventListener('click', function(event) {
            if (themePanel.classList.contains('open') && !event.target.closest('.theme-switcher')) {
                themePanel.classList.remove('open');
                themeToggle.setAttribute('aria-expanded', 'false');
            }
        });
    }

    themeSwatches.forEach(swatch => {
        swatch.addEventListener('click', function() {
            const primary = this.dataset.primary;
            const secondary = this.dataset.secondary;
            applyTheme(primary, secondary);
            saveTheme(primary, secondary);
        });
    });

    if (themeCustomColor) {
        themeCustomColor.addEventListener('input', function() {
            const primary = this.value;
            const secondary = shadeColor(primary, 20);
            applyTheme(primary, secondary);
            saveTheme(primary, secondary);
        });
    }

    if (themeReset) {
        themeReset.addEventListener('click', function() {
            applyTheme(DEFAULT_THEME.primary, DEFAULT_THEME.secondary);
            try {
                localStorage.removeItem(THEME_STORAGE_KEY);
            } catch (e) {}
        });
    }

    try {
        const saved = JSON.parse(localStorage.getItem(THEME_STORAGE_KEY));
        if (saved && saved.primary && themeCustomColor) {
            themeCustomColor.value = saved.primary;
        }
    } catch (e) {}

    // Projects page sub-navigation (independent of the main site nav above)
    const projectSubnavLinks = document.querySelectorAll('.project-subnav a');

    if (projectSubnavLinks.length) {
        projectSubnavLinks.forEach(link => {
            link.addEventListener('click', function(e) {
                e.preventDefault();
                const target = document.querySelector(this.getAttribute('href'));
                if (target) {
                    window.scrollTo({
                        top: target.offsetTop - 130,
                        behavior: 'smooth'
                    });
                }
            });
        });

        const projectCards = document.querySelectorAll('.project-card[id]');
        const setActiveSubnavLink = () => {
            let currentId = null;
            projectCards.forEach(card => {
                if (window.scrollY >= card.offsetTop - 150) {
                    currentId = card.id;
                }
            });
            projectSubnavLinks.forEach(link => {
                link.classList.toggle('active', link.getAttribute('href') === `#${currentId}`);
            });
        };

        window.addEventListener('scroll', setActiveSubnavLink);
        setActiveSubnavLink();
    }
});
