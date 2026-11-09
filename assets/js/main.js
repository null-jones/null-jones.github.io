import { loadTerrain, Ridgelines, isolines, hash01 } from './terrain.js';

document.documentElement.classList.add('js');

/* ==========================================================================
   Navigation
   ========================================================================== */
(function () {
    const nav = document.querySelector('.site-nav');
    if (!nav) return;

    const onScroll = function () { nav.classList.toggle('is-scrolled', window.scrollY > 24); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    const toggle = nav.querySelector('.nav-toggle');
    const menu = document.getElementById(toggle && toggle.getAttribute('aria-controls'));
    if (!toggle || !menu) return;

    const setOpen = function (open) {
        toggle.setAttribute('aria-expanded', String(open));
        toggle.querySelector('.nav-toggle__label').textContent = open ? 'Close' : 'Menu';
        document.body.classList.toggle('menu-open', open);
    };
    toggle.addEventListener('click', function () {
        setOpen(toggle.getAttribute('aria-expanded') !== 'true');
    });
    menu.querySelectorAll('a').forEach(function (a) {
        a.addEventListener('click', function () { setOpen(false); });
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
            setOpen(false);
            toggle.focus();
        }
    });
})();

/* ==========================================================================
   Reveal on scroll
   ========================================================================== */
(function () {
    const els = document.querySelectorAll('[data-reveal]');
    if (!els.length) return;
    const io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
            if (!e.isIntersecting) return;
            e.target.classList.add('is-in');
            io.unobserve(e.target);
        });
    }, { rootMargin: '0px 0px -12% 0px' });
    els.forEach(function (el) { io.observe(el); });
})();

/* ==========================================================================
   Isoline titles
   ========================================================================== */
document.querySelectorAll('[data-isolines]').forEach(function (el) {
    const rings = parseInt(el.getAttribute('data-rings') || '6', 10);
    isolines(el, { rings: rings });
});

/* ==========================================================================
   Ridgelines
   ========================================================================== */
(async function () {
    const canvases = document.querySelectorAll('canvas[data-ridge]');
    if (!canvases.length) return;

    let terrain;
    try {
        terrain = await loadTerrain();
    } catch (e) {
        return; // Page still reads fine as plain type.
    }
    if (document.fonts) await document.fonts.ready;

    const narrow = function (w) { return w < 700; };

    canvases.forEach(function (canvas) {
        const kind = canvas.getAttribute('data-ridge');
        const host = canvas.closest('[data-ridge-host]') || canvas.parentElement;

        if (kind === 'hero') {
            const hero = canvas.closest('.hero');
            const words = hero.querySelectorAll('.hero-name .w');
            const hud = hero.querySelector('[data-hud]');
            const fmt = function (n) { return n.toFixed(3); };
            new Ridgelines(canvas, terrain, {
                spacing: function (w) { return narrow(w) ? 5.5 : 7; },
                u: function (w) { return narrow(w) ? [0.3, 0.7] : [0, 1]; },
                amp: 6.5,
                step: 3,
                padTop: 40,
                padBottom: 0,
                text: Array.from(words),
                clearEls: Array.from(hero.querySelectorAll('[data-clear]')),
                clear: 0.8,
                textAmp: 1.15,
                wave: true,
                pointer: hero,
                alpha: [0.1, 0.62],
                onTextRise: function () { hero.classList.add('has-terrain'); },
                onSample: hud ? function (s) {
                    if (!s) { hud.classList.remove('is-live'); return; }
                    hud.classList.add('is-live');
                    hud.querySelector('[data-u]').textContent = fmt(s.u);
                    hud.querySelector('[data-v]').textContent = fmt(s.v);
                    hud.querySelector('[data-z]').textContent = fmt(s.z);
                } : null,
            });
            return;
        }

        if (kind === 'band') {
            const seed = hash01(canvas.getAttribute('data-seed') || host.textContent);
            new Ridgelines(canvas, terrain, {
                spacing: 7,
                amp: 4.2,
                step: 4,
                u: [seed * 0.4, seed * 0.4 + 0.6],
                v: [0.15 + seed * 0.3, 0.55 + seed * 0.3],
                flip: seed > 0.5,
                pointer: host,
                bumpAmp: 2,
                bumpRadius: 70,
                stagger: 40,
                alpha: [0.12, 0.5],
            });
            return;
        }

        if (kind === 'glyph') {
            const seed = hash01(canvas.getAttribute('data-seed') || '');
            const r = new Ridgelines(canvas, terrain, {
                spacing: 5,
                amp: 3.6,
                step: 2,
                u: [seed * 0.8, seed * 0.8 + 0.2],
                v: [seed * 0.6, seed * 0.6 + 0.35],
                stagger: 60,
                introDuration: 900,
                bumpAmp: 1.6,
                bumpRadius: 26,
                pointer: host,
                alpha: [0.25, 0.85],
            });
            host.addEventListener('pointerenter', function () { r.replay(); });
            host.addEventListener('focus', function () { r.replay(); });
            return;
        }

        if (kind === 'footer') {
            new Ridgelines(canvas, terrain, {
                spacing: function (w) { return narrow(w) ? 6 : 8; },
                u: function (w) { return narrow(w) ? [0.5, 0.85] : [0, 1]; },
                amp: 5,
                step: 4,
                v: [0.35, 1],
                pointer: host,
                stagger: 25,
                alpha: [0.06, 0.4],
            });
        }
    });
})();
