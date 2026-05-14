/* =========================================================
   COMÈTE STUDIO — main.js
   Blob cursor · burger nav · sticky CTA · GSAP counters · analytics
   ========================================================= */

const prefersReducedMotion =
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ========== BLOB CURSOR FOLLOW ========== */
(function () {
  const blob = document.querySelector('.blob');
  if (!blob) return;
  if (prefersReducedMotion) return;
  document.addEventListener('mousemove', (e) => {
    blob.style.transform = `translate(${e.clientX - 300}px, ${e.clientY - 300}px)`;
  });
})();

/* ========== MOBILE NAV — burger (3 traits → croix) ========== */
(function () {
  const burger = document.querySelector('.nav__burger');
  const navLinks = document.querySelector('.nav__links');
  const body = document.body;
  if (!burger || !navLinks) return;

  function openMenu() {
    navLinks.classList.add('is-open');
    burger.setAttribute('aria-expanded', 'true');
    burger.setAttribute('aria-label', 'Fermer le menu');
    body.style.overflow = 'hidden';
  }

  function closeMenu() {
    navLinks.classList.remove('is-open');
    burger.setAttribute('aria-expanded', 'false');
    burger.setAttribute('aria-label', 'Ouvrir le menu');
    body.style.overflow = '';
  }

  burger.addEventListener('click', () => {
    if (navLinks.classList.contains('is-open')) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  navLinks.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', closeMenu);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && navLinks.classList.contains('is-open')) {
      closeMenu();
      burger.focus();
    }
  });
})();

/* ========== STICKY CTA visibility (mobile only) ========== */
(function () {
  const sticky = document.getElementById('sticky-cta');
  if (!sticky) return;

  const hero = document.getElementById('hero');
  const discovery = document.getElementById('discovery');
  const footer = document.querySelector('.site-footer');

  function updateStickyVisibility() {
    const viewportH = window.innerHeight;

    if (hero) {
      const heroRect = hero.getBoundingClientRect();
      if (heroRect.bottom > viewportH * 0.5) {
        hideSticky();
        return;
      }
    }

    if (discovery) {
      const discRect = discovery.getBoundingClientRect();
      if (discRect.top < viewportH * 0.7) {
        hideSticky();
        return;
      }
    }

    if (footer) {
      const footerRect = footer.getBoundingClientRect();
      if (footerRect.top < viewportH * 0.85) {
        hideSticky();
        return;
      }
    }

    showSticky();
  }

  function showSticky() {
    sticky.classList.add('is-visible');
    sticky.setAttribute('aria-hidden', 'false');
    sticky.removeAttribute('tabindex');
  }

  function hideSticky() {
    sticky.classList.remove('is-visible');
    sticky.setAttribute('aria-hidden', 'true');
    sticky.setAttribute('tabindex', '-1');
  }

  let ticking = false;
  window.addEventListener(
    'scroll',
    () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          updateStickyVisibility();
          ticking = false;
        });
        ticking = true;
      }
    },
    { passive: true }
  );

  window.addEventListener('resize', updateStickyVisibility);
  updateStickyVisibility();
})();

/* ========== VERCEL ANALYTICS — événements granulaires ========== */
function trackEvent(name, properties) {
  if (typeof window.va !== 'undefined') {
    window.va('event', Object.assign({ name: name }, properties || {}));
  }
}

/* Scroll Depth Home — paliers 25/50/75/100% */
if (window.location.pathname === '/' || window.location.pathname === '/index.html') {
  const scrollMilestones = new Set();
  function checkScrollDepth() {
    const scrollPercent = Math.round(
      ((window.scrollY + window.innerHeight) / document.body.scrollHeight) * 100
    );
    [25, 50, 75, 100].forEach((milestone) => {
      if (scrollPercent >= milestone && !scrollMilestones.has(milestone)) {
        scrollMilestones.add(milestone);
        trackEvent('Scroll Depth Home', { depth: milestone + '%' });
      }
    });
  }
  window.addEventListener('scroll', checkScrollDepth, { passive: true });
}

/* CTA Discovery — capture la source via data-cta-source */
document.querySelectorAll('a[data-cta-source]').forEach((link) => {
  link.addEventListener('click', () => {
    trackEvent('CTA Discovery Click', {
      source: link.dataset.ctaSource || 'unknown',
      from: window.location.pathname
    });
  });
});

/* Outbound Click — LinkedIn + Cal.com */
document.querySelectorAll('a[href*="linkedin.com"]').forEach((link) => {
  link.addEventListener('click', () => {
    trackEvent('Outbound Click', { target: 'linkedin' });
  });
});
document.querySelectorAll('a[href*="cal.eu"]').forEach((link) => {
  link.addEventListener('click', () => {
    trackEvent('Outbound Click', { target: 'cal.com' });
  });
});

/* PDF Download — étude de cas Écho */
document.querySelectorAll('a[download], a[href$=".pdf"]').forEach((link) => {
  link.addEventListener('click', () => {
    trackEvent('PDF Download', {
      file: link.getAttribute('href') || 'unknown'
    });
  });
});

/* FAQ Opened */
document.querySelectorAll('.faq__item').forEach((item) => {
  item.addEventListener('toggle', () => {
    if (!item.open) return;
    const summary = item.querySelector('summary');
    const question = (summary?.textContent || 'unknown').trim();
    trackEvent('FAQ Opened', { question: question });
  });
});

/* ========== GSAP — compteurs animés (scroll-triggered) ========== */
if (!prefersReducedMotion && typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger);

  document.querySelectorAll('[data-counter]').forEach((el) => {
    const target = parseFloat(el.dataset.counter);
    const prefix = el.dataset.prefix || '';
    const suffix = el.dataset.suffix || '';
    const separator = el.dataset.separator || '';
    const decimals = parseInt(el.dataset.decimals) || 0;

    const counter = { val: 0 };

    ScrollTrigger.create({
      trigger: el,
      start: 'top 85%',
      once: true,
      onEnter: () => {
        gsap.to(counter, {
          val: target,
          duration: 2,
          ease: 'power2.out',
          onUpdate: () => {
            let display =
              decimals > 0
                ? counter.val.toFixed(decimals).replace('.', ',')
                : Math.round(counter.val).toString();

            if (separator && decimals === 0) {
              display = display.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
            }

            el.textContent = prefix + display + suffix;
          }
        });
      }
    });
  });

  /* Stagger reveal pour cards Orbite */
  const appCards = document.querySelectorAll('.app-card');
  if (appCards.length) {
    gsap.fromTo(
      appCards,
      { opacity: 0, y: 24 },
      {
        opacity: 1,
        y: 0,
        duration: 0.6,
        stagger: 0.15,
        ease: 'power2.out',
        scrollTrigger: { trigger: '.orbite__grid', start: 'top 80%', once: true }
      }
    );
  }

  /* Stagger reveal pour blocs qualitatifs cas Peggy */
  const casBlocks = document.querySelectorAll('.cas__block');
  if (casBlocks.length) {
    gsap.fromTo(
      casBlocks,
      { opacity: 0, x: -20 },
      {
        opacity: 1,
        x: 0,
        duration: 0.5,
        stagger: 0.18,
        ease: 'power2.out',
        scrollTrigger: { trigger: '.cas__qualitative', start: 'top 80%', once: true }
      }
    );
  }

  /* Stagger reveal pour 4 piliers */
  const piliers = document.querySelectorAll('.pilier');
  if (piliers.length) {
    gsap.fromTo(
      piliers,
      { opacity: 0, y: 16 },
      {
        opacity: 1,
        y: 0,
        duration: 0.5,
        stagger: 0.12,
        ease: 'power2.out',
        scrollTrigger: { trigger: '.piliers__list', start: 'top 80%', once: true }
      }
    );
  }

  /* Proof stats stagger */
  const proofStats = document.querySelectorAll('.proof-stat');
  if (proofStats.length) {
    gsap.fromTo(
      proofStats,
      { opacity: 0, y: 20 },
      {
        opacity: 1,
        y: 0,
        duration: 0.5,
        stagger: 0.15,
        ease: 'power2.out',
        scrollTrigger: { trigger: '.proof-strip', start: 'top 85%', once: true }
      }
    );
  }
}
