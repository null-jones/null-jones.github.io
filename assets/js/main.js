/* ========================================
   Nav scroll effect
   ======================================== */
(function() {
    const nav = document.querySelector('.site-nav');
    if (!nav) return;

    const toggle = nav.querySelector('.nav-toggle');
    const links = nav.querySelector('.nav-links');

    window.addEventListener('scroll', function() {
        nav.classList.toggle('scrolled', window.scrollY > 50);
    });

    if (toggle && links) {
        toggle.addEventListener('click', function() {
            links.classList.toggle('open');
        });

        // Close nav when clicking a link
        links.querySelectorAll('a').forEach(function(a) {
            a.addEventListener('click', function() {
                links.classList.remove('open');
            });
        });
    }
})();

/* ========================================
   Contour line drawing animation
   ======================================== */
(function() {
    if (typeof anime === 'undefined') return;

    var contourSvg = document.querySelector('.hero-contours');
    if (!contourSvg) return;

    var paths = contourSvg.querySelectorAll('.contour-line');
    paths.forEach(function(path) {
        var length = path.getTotalLength();
        path.style.strokeDasharray = length;
        path.style.strokeDashoffset = length;
    });

    contourSvg.classList.add('visible');

    anime({
        targets: '.hero-contours .contour-line',
        strokeDashoffset: [anime.setDashoffset, 0],
        easing: 'easeInOutQuad',
        duration: 3000,
        delay: function(el, i) { return i * 150; }
    });
})();

/* ========================================
   Lightbox (only on pages with .gallery)
   ======================================== */
(function() {
    var gallery = document.querySelector('.gallery');
    if (!gallery) return;

    // Create lightbox DOM
    var lightbox = document.createElement('div');
    lightbox.className = 'lightbox';
    lightbox.innerHTML = '<button class="lightbox-close" aria-label="Close">&times;</button>'
        + '<button class="lightbox-nav lightbox-prev" aria-label="Previous">&lsaquo;</button>'
        + '<img src="" alt="">'
        + '<button class="lightbox-nav lightbox-next" aria-label="Next">&rsaquo;</button>';
    document.body.appendChild(lightbox);

    var lbImg = lightbox.querySelector('img');
    var images = [];
    var currentIndex = 0;

    function open(index) {
        currentIndex = index;
        lbImg.src = images[currentIndex].src;
        lightbox.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function close() {
        lightbox.classList.remove('active');
        document.body.style.overflow = '';
    }

    function prev() {
        currentIndex = (currentIndex - 1 + images.length) % images.length;
        lbImg.src = images[currentIndex].src;
    }

    function next() {
        currentIndex = (currentIndex + 1) % images.length;
        lbImg.src = images[currentIndex].src;
    }

    // Bind gallery item clicks
    gallery.addEventListener('click', function(e) {
        var item = e.target.closest('.gallery-item');
        if (!item) return;
        var img = item.querySelector('img');
        if (!img) return;

        // Rebuild images list each time (in case of shuffle)
        images = Array.from(gallery.querySelectorAll('.gallery-item img'));
        var idx = images.indexOf(img);
        if (idx >= 0) open(idx);
    });

    lightbox.querySelector('.lightbox-close').addEventListener('click', close);
    lightbox.querySelector('.lightbox-prev').addEventListener('click', prev);
    lightbox.querySelector('.lightbox-next').addEventListener('click', next);

    // Click backdrop to close
    lightbox.addEventListener('click', function(e) {
        if (e.target === lightbox) close();
    });

    // Keyboard navigation
    document.addEventListener('keydown', function(e) {
        if (!lightbox.classList.contains('active')) return;
        if (e.key === 'Escape') close();
        if (e.key === 'ArrowLeft') prev();
        if (e.key === 'ArrowRight') next();
    });
})();
