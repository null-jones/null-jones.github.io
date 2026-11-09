/* ==========================================================================
   Terrain — ridgeline (joyplot) + isoline renderers
   --------------------------------------------------------------------------
   Two views of the same idea:
     • Ridgelines: side-on transects of real elevation data (Bow Valley, AB),
       drawn back-to-front with hidden-line occlusion. Optionally raises the
       letterforms of an HTML element out of the terrain.
     • Isolines:   top-down contour rings offset around a word, like the
       index contours on a topographic map.
   ========================================================================== */

const TERRAIN_URL = '/assets/data/bow-valley.json';
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let terrainPromise = null;

/** Load and decode the elevation grid (rows = transects back→front, 0..1). */
export function loadTerrain() {
    if (!terrainPromise) {
        terrainPromise = fetch(TERRAIN_URL)
            .then(function (res) {
                if (!res.ok) throw new Error('terrain ' + res.status);
                return res.json();
            })
            .then(function (json) {
                const bin = atob(json.data);
                const h = new Float32Array(bin.length);
                for (let i = 0; i < bin.length; i++) h[i] = bin.charCodeAt(i) / 255;
                return { rows: json.rows, cols: json.cols, h: h, name: json.name };
            });
    }
    return terrainPromise;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

/** Bilinear sample of the grid at u (west→east) and v (back→front), both 0..1. */
export function sampleTerrain(t, u, v) {
    const x = clamp01(u) * (t.cols - 1);
    const y = clamp01(v) * (t.rows - 1);
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, t.cols - 1), y1 = Math.min(y0 + 1, t.rows - 1);
    const fx = x - x0, fy = y - y0;
    const H = t.h, C = t.cols;
    const a = H[y0 * C + x0], b = H[y0 * C + x1];
    const c = H[y1 * C + x0], d = H[y1 * C + x1];
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

/** Small deterministic hash → 0..1, used to give each glyph its own patch of valley. */
export function hash01(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 10000) / 10000;
}

const DEFAULTS = {
    spacing: 9,              // px between transects, or fn(width, height)
    amp: 5,                  // terrain height, in multiples of spacing
    step: 3,                 // px between samples along a line
    padTop: 0,
    padBottom: 0,
    u: [0, 1],               // horizontal window into the terrain
    v: [0, 1],               // depth window into the terrain
    flip: false,             // mirror horizontally
    text: null,              // array of elements whose letters rise out of the terrain
    textAmp: 1.35,           // letter height, in multiples of spacing
    clear: 0.85,             // how much terrain flattens around the letters
    wave: false,             // slow breathing swell
    intro: true,             // rise from flat on first view
    introDuration: 1600,
    stagger: 12,             // ms between transects during intro
    pointer: null,           // element that drives the pointer bump
    bumpAmp: 2.4,            // in multiples of spacing
    bumpRadius: 90,          // px
    color: [0, 212, 170],
    ink: [236, 236, 230],
    bg: '#0a0a0a',
    alpha: [0.16, 0.7],      // stroke alpha back → front
    lineWidth: 1,
    onTextRise: null,        // called once when letters start rising
    onSample: null,          // ({u, v, z}) under the pointer
};

export class Ridgelines {
    constructor(canvas, terrain, options) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.t = terrain;
        this.o = Object.assign({}, DEFAULTS, options || {});
        this.raf = 0;
        this.visible = false;
        this.introStart = null;
        this.textRiseFired = false;
        this.ptr = { x: -9999, y: -9999, tx: -9999, ty: -9999, s: 0, ts: 0 };
        this.tick = this.tick.bind(this);

        this.layout();
        this.observe();
        if (this.o.pointer) this.bindPointer(this.o.pointer);
    }

    /* ---------- geometry ---------- */

    layout() {
        const o = this.o;
        const rect = this.canvas.getBoundingClientRect();
        const W = Math.max(1, Math.round(rect.width));
        const H = Math.max(1, Math.round(rect.height));
        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        this.W = W; this.H = H; this.dpr = dpr;
        this.canvas.width = Math.round(W * dpr);
        this.canvas.height = Math.round(H * dpr);

        const sp = typeof o.spacing === 'function' ? o.spacing(W, H) : o.spacing;
        this.sp = sp;
        this.ampPx = o.amp * sp;
        this.textAmpPx = o.textAmp * sp;
        this.y0 = o.padTop + this.ampPx * 0.75;
        const usable = H - o.padBottom - this.y0;
        this.N = Math.max(2, Math.floor(usable / sp) + 1);

        const P = Math.max(2, Math.ceil(W / o.step) + 1);
        this.P = P;
        this.xs = new Float32Array(P);
        for (let i = 0; i < P; i++) this.xs[i] = (i / (P - 1)) * W;
        this.ys = new Float32Array(P);

        // Terrain heights per transect, cached — only rise/wave/bump change per frame.
        const N = this.N;
        this.base = new Float32Array(N * P);
        // The u window may depend on size, e.g. a narrower slice on phones so peaks aren't squeezed.
        this.u = typeof o.u === 'function' ? o.u(W, H) : o.u;
        const [u0, u1] = this.u, [v0, v1] = o.v;
        for (let r = 0; r < N; r++) {
            const v = v0 + (v1 - v0) * (r / (N - 1));
            for (let i = 0; i < P; i++) {
                let u = i / (P - 1);
                if (o.flip) u = 1 - u;
                this.base[r * P + i] = sampleTerrain(this.t, u0 + (u1 - u0) * u, v);
            }
        }

        this.mask = null;
        this.clearMask = null;
        if (o.text && o.text.length) this.buildTextMasks(rect);
    }

    /** Rasterise the text elements into a sharp mask (letters) and a soft one (clearing). */
    buildTextMasks(rect) {
        const s = 0.5; // mask resolution
        const mw = Math.max(1, Math.round(this.W * s));
        const mh = Math.max(1, Math.round(this.H * s));

        const a = document.createElement('canvas');
        a.width = mw; a.height = mh;
        const actx = a.getContext('2d');
        actx.fillStyle = '#fff';

        let fontPx = 0;
        this.o.text.forEach(function (el) {
            const r = el.getBoundingClientRect();
            if (!r.width) return;
            const cs = getComputedStyle(el);
            const size = parseFloat(cs.fontSize);
            fontPx = Math.max(fontPx, size);
            let label = el.textContent.trim();
            if (cs.textTransform === 'uppercase') label = label.toUpperCase();

            actx.font = cs.fontWeight + ' ' + (size * s) + 'px ' + cs.fontFamily;
            actx.textBaseline = 'alphabetic';
            const m = actx.measureText(label);
            // Match the CSS layout width regardless of canvas font-stretch support.
            const sx = Math.min(1.8, Math.max(0.5, (r.width * s) / (m.width || 1)));
            const asc = m.actualBoundingBoxAscent || size * s * 0.72;
            const desc = m.actualBoundingBoxDescent || 0;
            const cx = (r.left - rect.left) * s;
            const cy = (r.top - rect.top + r.height / 2) * s + (asc - desc) / 2;

            actx.save();
            actx.translate(cx, cy);
            actx.scale(sx, 1);
            actx.fillText(label, 0, 0);
            actx.restore();
        });

        // The clearing also covers supporting copy (tagline, links) so it stays legible.
        const c = document.createElement('canvas');
        c.width = mw; c.height = mh;
        const cctx = c.getContext('2d');
        cctx.drawImage(a, 0, 0);
        cctx.fillStyle = '#fff';
        (this.o.clearEls || []).forEach(function (el) {
            const r = el.getBoundingClientRect();
            if (!r.width) return;
            cctx.fillRect((r.left - rect.left) * s, (r.top - rect.top) * s, r.width * s, r.height * s);
        });

        const blurred = function (src, radius) {
            const b = document.createElement('canvas');
            b.width = mw; b.height = mh;
            const bctx = b.getContext('2d');
            // Shadow trick: blurs everywhere canvas filters aren't supported.
            bctx.shadowColor = '#fff';
            bctx.shadowBlur = radius;
            bctx.shadowOffsetX = mw;
            bctx.drawImage(src, -mw, 0);
            return bctx.getImageData(0, 0, mw, mh).data;
        };

        const sharp = blurred(a, 1.2);
        const soft = blurred(c, Math.max(8, fontPx * s * 0.3));

        const N = this.N, P = this.P;
        this.mask = new Float32Array(N * P);
        this.clearMask = new Float32Array(N * P);
        for (let r = 0; r < N; r++) {
            const yb = this.y0 + r * this.sp;
            // Letters appear lifted by textAmp, so sample where they will be seen.
            const my = Math.round((yb - this.textAmpPx) * s);
            const cy = Math.round(yb * s);
            for (let i = 0; i < P; i++) {
                const mx = Math.min(mw - 1, Math.round(this.xs[i] * s));
                const idx = r * P + i;
                if (my >= 0 && my < mh) this.mask[idx] = sharp[(my * mw + mx) * 4 + 3] / 255;
                if (cy >= 0 && cy < mh) this.clearMask[idx] = Math.min(1, (soft[(cy * mw + mx) * 4 + 3] / 255) * 3);
            }
        }
    }

    /* ---------- lifecycle ---------- */

    observe() {
        const self = this;
        this.io = new IntersectionObserver(function (entries) {
            entries.forEach(function (e) {
                self.visible = e.isIntersecting;
                if (self.visible) {
                    if (self.introStart === null) self.introStart = performance.now();
                    self.kick();
                }
            });
        }, { rootMargin: '80px' });
        this.io.observe(this.canvas);

        let timer = 0;
        let lastW = this.canvas.clientWidth, lastH = this.canvas.clientHeight;
        this.ro = new ResizeObserver(function () {
            const w = self.canvas.clientWidth, h = self.canvas.clientHeight;
            if (w === lastW && h === lastH) return;
            lastW = w; lastH = h;
            clearTimeout(timer);
            timer = setTimeout(function () { self.relayout(); }, 120);
        });
        this.ro.observe(this.canvas);
    }

    relayout() {
        this.layout();
        this.draw(performance.now());
        this.kick();
    }

    replay() {
        if (reduceMotion.matches) return;
        this.introStart = performance.now();
        this.kick();
    }

    bindPointer(el) {
        const self = this;
        const move = function (e) {
            const r = self.canvas.getBoundingClientRect();
            self.ptr.tx = e.clientX - r.left;
            self.ptr.ty = e.clientY - r.top;
            self.ptr.ts = 1;
            if (self.ptr.x < -999) { self.ptr.x = self.ptr.tx; self.ptr.y = self.ptr.ty; }
            if (self.o.onSample) self.o.onSample(self.sampleAt(self.ptr.tx, self.ptr.ty));
            self.kick();
        };
        el.addEventListener('pointermove', move, { passive: true });
        el.addEventListener('pointerdown', move, { passive: true });
        el.addEventListener('pointerleave', function () {
            self.ptr.ts = 0;
            if (self.o.onSample) self.o.onSample(null);
            self.kick();
        });
    }

    sampleAt(x, y) {
        const u = clamp01(x / this.W);
        const row = Math.max(0, Math.min(this.N - 1, Math.round((y - this.y0) / this.sp)));
        const v = row / (this.N - 1);
        const [u0, u1] = this.u, [v0, v1] = this.o.v;
        const uu = u0 + (u1 - u0) * (this.o.flip ? 1 - u : u);
        return { u: uu, v: v0 + (v1 - v0) * v, z: sampleTerrain(this.t, uu, v0 + (v1 - v0) * v) };
    }

    kick() {
        if (!this.raf && this.visible) this.raf = requestAnimationFrame(this.tick);
    }

    tick(now) {
        this.raf = 0;
        const p = this.ptr;
        p.x += (p.tx - p.x) * 0.16;
        p.y += (p.ty - p.y) * 0.16;
        p.s += (p.ts - p.s) * 0.07;

        const busy = this.draw(now);
        const pointerBusy = Math.abs(p.ts - p.s) > 0.004 ||
            (p.s > 0.01 && (Math.abs(p.tx - p.x) > 0.3 || Math.abs(p.ty - p.y) > 0.3));
        const waving = this.o.wave && !reduceMotion.matches;
        if (this.visible && (busy || pointerBusy || waving)) this.raf = requestAnimationFrame(this.tick);
    }

    /* ---------- drawing ---------- */

    /** Draws one frame. Returns true while the intro is still animating. */
    draw(now) {
        const o = this.o, ctx = this.ctx;
        const { W, H, N, P, xs, ys, base, mask, clearMask, sp } = this;
        const reduce = reduceMotion.matches || !o.intro;

        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        const elapsed = this.introStart === null ? 0 : now - this.introStart;
        const introTotal = o.introDuration + N * o.stagger;
        let introBusy = !reduce && elapsed < introTotal + 1400;

        // Letters rise once most of the terrain is up.
        const textDelay = introTotal * 0.55;
        const textRise = reduce ? 1 : easeOutCubic(clamp01((elapsed - textDelay) / 1300));
        if (mask && !this.textRiseFired && (reduce || elapsed > textDelay) && this.introStart !== null) {
            this.textRiseFired = true;
            if (o.onTextRise) o.onTextRise();
        }

        const p = this.ptr;
        const bumpPx = o.bumpAmp * sp * p.s;
        const inv2r2 = 1 / (2 * o.bumpRadius * o.bumpRadius);
        const wave = o.wave && !reduce;
        const t = now * 0.00045;
        const [r0, g0, b0] = o.color;
        const [r1, g1, b1] = o.ink;

        for (let r = 0; r < N; r++) {
            const yb = this.y0 + r * sp;
            const rise = reduce ? 1 : easeOutCubic(clamp01((elapsed - r * o.stagger) / o.introDuration));
            const off = r * P;
            const dy = yb - p.y;
            const rowBump = bumpPx > 0.05 ? Math.exp(-dy * dy * inv2r2) : 0;

            for (let i = 0; i < P; i++) {
                const x = xs[i];
                let terrain = base[off + i];
                if (wave) terrain *= 1 + 0.14 * Math.sin(x * 0.006 + r * 0.22 - t * 2.2);
                const clear = clearMask ? 1 - o.clear * clearMask[off + i] : 1;
                let h = this.ampPx * terrain * clear * rise;
                if (mask) h += this.textAmpPx * mask[off + i] * textRise;
                if (rowBump > 0.001) {
                    const dx = x - p.x;
                    h += bumpPx * rowBump * Math.exp(-dx * dx * inv2r2);
                }
                ys[i] = yb - h;
            }

            // Occlude the transects behind.
            ctx.beginPath();
            ctx.moveTo(0, yb + 2);
            for (let i = 0; i < P; i++) ctx.lineTo(xs[i], ys[i]);
            ctx.lineTo(W, yb + 2);
            ctx.closePath();
            ctx.fillStyle = o.bg;
            ctx.fill();

            const depth = N > 1 ? r / (N - 1) : 1;
            const alpha = o.alpha[0] + (o.alpha[1] - o.alpha[0]) * depth;
            ctx.beginPath();
            ctx.moveTo(xs[0], ys[0]);
            for (let i = 1; i < P; i++) ctx.lineTo(xs[i], ys[i]);
            ctx.strokeStyle = 'rgba(' + r0 + ',' + g0 + ',' + b0 + ',' + alpha.toFixed(3) + ')';
            ctx.lineWidth = o.lineWidth;
            ctx.stroke();

            // Re-ink the stretches that run over letters.
            if (mask && textRise > 0.02) {
                ctx.beginPath();
                let on = false;
                for (let i = 0; i < P; i++) {
                    const inside = mask[off + i] > 0.45;
                    if (inside && !on) { ctx.moveTo(xs[i > 0 ? i - 1 : 0], ys[i > 0 ? i - 1 : 0]); on = true; }
                    if (inside || on) ctx.lineTo(xs[i], ys[i]);
                    if (!inside) on = false;
                }
                ctx.strokeStyle = 'rgba(' + r1 + ',' + g1 + ',' + b1 + ',' + (0.95 * textRise).toFixed(3) + ')';
                ctx.lineWidth = o.lineWidth * 1.5;
                ctx.stroke();
            }
        }

        return introBusy;
    }
}

/* ==========================================================================
   Isolines — concentric contour rings around a word (SVG)
   ========================================================================== */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Builds an SVG of `text` ringed by offset contours.
 * Each ring is a wide accent stroke with a slightly narrower background stroke
 * on top, leaving a hairline at a fixed distance from the letterforms.
 */
export function isolines(host, opts) {
    const o = Object.assign({ rings: 6, gap: 5.5, weight: 0.9, size: 100 }, opts || {});
    const text = (host.getAttribute('data-isolines') || host.textContent.trim()).toUpperCase();

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.classList.add('isolines');
    const g = document.createElementNS(SVG_NS, 'g');
    svg.appendChild(g);

    const layer = function (cls, width) {
        const t = document.createElementNS(SVG_NS, 'text');
        t.setAttribute('x', '0');
        t.setAttribute('y', '0');
        t.setAttribute('class', cls);
        t.setAttribute('font-size', String(o.size));
        if (width) t.setAttribute('stroke-width', width.toFixed(2));
        t.textContent = text;
        g.appendChild(t);
        return t;
    };

    for (let k = o.rings; k >= 1; k--) {
        const d = k * o.gap;
        const ring = layer('iso-ring', 2 * d + o.weight);
        ring.style.setProperty('--ring', String(k));
        ring.style.opacity = String(Math.max(0.12, 1 - (k - 1) / o.rings));
        layer('iso-knock', 2 * d - o.weight);
    }
    layer('iso-glyph', 0);

    host.appendChild(svg);

    // Size in ems so the drawing tracks the host's font-size like real type.
    const fit = function () {
        try {
            const bb = g.getBBox();
            if (!bb.width) return;
            const pad = o.rings * o.gap + o.weight + 2;
            const vb = [bb.x - pad, bb.y - pad, bb.width + pad * 2, bb.height + pad * 2];
            svg.setAttribute('viewBox', vb.map(function (n) { return n.toFixed(1); }).join(' '));
            svg.style.width = (vb[2] / o.size).toFixed(3) + 'em';
            svg.style.margin = (-pad / o.size).toFixed(3) + 'em';
            host.classList.add('has-isolines');
        } catch (e) { /* not rendered yet */ }
    };
    fit();
    if (document.fonts) document.fonts.ready.then(fit);
    return svg;
}
