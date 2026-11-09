# elliej.dev

Personal site of Ellie Jones. Plain static HTML/CSS/JS, served by GitHub Pages. No build step.

## Run locally

```bash
python3 -m http.server 8080
```

Paths are root-absolute (`/assets/...`), so serve from the repo root.

## Structure

```
index.html                 Home: hero, about, projects, blog
blog/index.html            Post list
blog/posts/*.html          Posts (use the .prose wrapper for body copy)
404.html                   Off the map
assets/css/style.css       Tokens, type system, components
assets/js/main.js          Nav, reveals, ridgeline wiring
assets/js/terrain.js       Ridgeline + isoline renderers
assets/data/bow-valley.json  46 elevation transects of the Bow Valley (from Contourist)
```

## Design system

**Two views of one terrain.** Ridgelines (side view, a joyplot) and isolines (top view, map contours).

- `<canvas data-ridge="hero|band|glyph|footer">`: draws live ridgelines from the Bow Valley data.
  The hero raises the letters of `.hero-name .w` out of the terrain; elements marked `data-clear`
  get flattened terrain behind them so they stay readable.
- `data-isolines="Word"` on a heading: wraps the word in contour rings. Put the real text in
  `<span class="iso-text">` so it stays accessible and shows if JS is off.

**Type**

| Role    | Face           | Used for                                   |
|---------|----------------|--------------------------------------------|
| Display | Anybody        | Names, titles. Width axis is animated.     |
| Text    | Newsreader     | Reading copy, taglines, intros             |
| Label   | JetBrains Mono | Nav, metadata, dates, tags, coordinates    |

The fluid type scale is `--step--2` … `--step-4` in `style.css`.

## Adding a post

1. Copy `blog/posts/hello-world.html`, edit the `<title>`, description, header and `.prose` body.
2. Add a `.post-item` to `blog/index.html` (and swap the latest one on the home page).
