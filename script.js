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
});
