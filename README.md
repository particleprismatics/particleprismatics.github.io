# particleprismatics.github.io

Marketing site for **Particle Prismatics LLC** — computational design, data
visualization, and applied AI. Served via GitHub Pages at
[particleprismatics.com](https://particleprismatics.com).

## Structure

| File | Purpose |
|------|---------|
| `index.html` | Single-page site: hero animation, statement, services, featured work, about, contact. |
| `animation.html` | Full particle-logo animation with a live control panel (for tuning / grabbing video). |
| `styles.css` | Site styling — dark editorial theme, Montserrat + Cormorant Garamond. |
| `assets/particle-anim.js` | Reusable WebGL particle-intro engine (drives both the hero and the studio page). |
| `assets/logo.png` | Master logo (`PARTICLE PRISMATICS`). |
| `assets/photodance-*.jpg` | Featured-work imagery. |
| `assets/favicon.svg` | Favicon. |
| `CNAME` | Custom domain (`particleprismatics.com`). |
| `.nojekyll` | Serve files as-is (skip Jekyll processing). |

It's a **static site — no build step**. Edit and push; GitHub Pages serves it directly.

## Local preview

```bash
python -m http.server 8000     # then open http://localhost:8000
```

## Deploy (GitHub Pages)

1. Create the repo `particleprismatics.github.io` under the `particleprismatics` org.
2. Push these files to the default branch.
3. Settings → Pages → Source: deploy from branch (root).
4. DNS for `particleprismatics.com`: an `A`/`ALIAS` (apex) → GitHub Pages IPs, or a
   `CNAME` for `www` → `particleprismatics.github.io`. Enable **Enforce HTTPS**.

## Editing notes

- **Contact:** `hello@particleprismatics.com` / `licensing@particleprismatics.com`
  (catch-all forwards to the owner).
- **Demo video:** the featured PhotoDance link points at `youtu.be/Af9nWLuhhR8`.
- Copy © 2026 Particle Prismatics LLC.
