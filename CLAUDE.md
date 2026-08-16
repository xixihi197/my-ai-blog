# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

研习录 (`my-ai-blog`) is a static, Chinese-language blog for recording AI learning notes. It is hosted on GitHub Pages at `https://xixihi197.github.io/my-ai-blog/`.

The site is intentionally simple: plain HTML files plus a single shared CSS file. There is no build system, no JavaScript bundler, and no test suite.

## Repository structure

- `index.html` — homepage listing all notes.
- `categories.html` — archive grouped by category.
- `style.css` — global styles; every page links to it.
- `notes/` — individual note pages.
- `images/` — screenshots and figures referenced by notes.

## Common commands

This project has no build, lint, or test commands. Typical workflows:

Preview locally:

```powershell
# From the repository root
python -m http.server 8000
# Then open http://localhost:8000
```

Deploy changes (GitHub Pages reads from the `main` branch):

```bash
git add .
git commit -m "<message>"
git push origin main
```

## How to add a new note

1. Create a new HTML file in `notes/`.
2. Use the same template as existing notes:
   - `<html lang="zh-CN">`
   - Link to `../style.css`.
   - Navigation: `../index.html` · `../categories.html`
   - Wrap content in `<article class="note-full">`.
   - Use `<h1>` for the note title, followed by `<time class="meta" datetime="YYYY-MM-DD">` and `<span class="tag">分类名</span>`.
   - End with `<hr class="divider">`, the Giscus `<section class="comments">`, and a link back to `../index.html`.
3. Add the note to `index.html` in the `<section class="note-list">`.
4. Add the note to `categories.html` under the matching category heading. If the category does not exist, create a new `<h2>` heading for it.
5. Keep filenames lowercase; use hyphens for multi-word names. Chinese filenames are acceptable and already used (`建站过程记录.html`).

## Style conventions

All styling lives in `style.css`. Key design tokens used across the site:

- Background: `#0d0d0d`
- Body text: `#e8e4dc`
- Muted text: `#9e998f`
- Accent / links: `#a85e5e`
- Borders / dividers: `#262626`
- Heading font: `"Noto Serif SC", Georgia, "Songti SC", "STSong", serif`
- Mono / meta font: `"SFMono-Regular", "Menlo", "Consolas", "Noto Sans SC", monospace`

When adding new elements, match the existing spacing, border radius (`2px`), and hover transitions. Avoid introducing new colors unless necessary.

## Comments

Notes use Giscus, which stores comments in GitHub Discussions. The Giscus script block is identical in every note and must not be modified unless the repository or category changes.

Important limitation: Giscus rejects `file:///` origins. Comments can only be tested after pushing to the live GitHub Pages URL; local preview shows the page layout but not the comment widget.

## Deployment

The site is published with GitHub Pages from the `main` branch. Pushing to `origin main` is sufficient to deploy. There is no CI/CD pipeline or separate build step.

## Notes on file naming

- Use `.html` extensions.
- Image assets go in `images/`.
- Reference images from notes with `../images/<filename>`.
