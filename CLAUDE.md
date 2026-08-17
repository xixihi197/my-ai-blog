# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

研习录 (`my-ai-blog`) is a Chinese-language blog for recording AI learning notes and sharing insights within a small circle. It supports public submission of notes, image uploads, and Giscus-based comments.

The site uses a hybrid architecture:

- **Static frontend**: plain HTML files + a single shared CSS file.
- **Submission backend**: a Vercel Serverless Function (`api/submit.js`) that writes new notes directly to this GitHub repository via the GitHub API.
- **Comments**: Giscus, backed by GitHub Discussions.
- **Hosting**: currently deployed on Vercel at `https://my-ai-blog-psi.vercel.app`, with the repository still connected to GitHub Pages (`https://xixihi197.github.io/my-ai-blog/`).

There is no build system, no JavaScript bundler, and no test suite.

## Repository structure

- `index.html` — homepage listing all notes.
- `categories.html` — archive grouped by category.
- `pages/submit.html` — public submission form.
- `style.css` — global styles; every page links to it.
- `notes/` — individual note pages.
- `images/` — screenshots and figures referenced by notes, organized as `images/<slug>/<filename>`.
- `api/submit.js` — Vercel Serverless Function that receives submissions and writes files to GitHub.
- `package.json` / `package-lock.json` — Node dependencies for the Vercel function (`busboy`).

## How to add a new note

### Option 1: Submit through the website

1. Open `pages/submit.html` on the live site.
2. Fill in title, category, author, summary, and Markdown content.
3. To include images, write Markdown image syntax in the content using the **original uploaded filename**:
   ```markdown
   ![截图说明](原始文件名.jpg)
   ```
4. Select the matching image files (up to 5, each ≤ 2MB).
5. Submit. The serverless function will create:
   - `notes/<slug>.html`
   - `images/<slug>/<filename>` for each image
   - updated `index.html` and `categories.html`

### Option 2: Add manually

1. Create a new HTML file in `notes/`.
2. Use the same template as existing notes:
   - `<html lang="zh-CN">`
   - Link to `../style.css`.
   - Navigation: `../index.html` · `../categories.html` · `../pages/submit.html`
   - Wrap content in `<article class="note-full">`.
   - Use `<h1>` for the note title, followed by `<time class="meta" datetime="YYYY-MM-DD">` and `<span class="tag">分类名</span>`.
   - End with `<hr class="divider">`, the Giscus `<section class="comments">`, and a link back to `../index.html`.
3. Add the note to `index.html` in the `<section class="note-list">`.
4. Add the note to `categories.html` under the matching category heading. If the category does not exist, create a new `<h2>` heading for it.
5. Keep filenames lowercase; use hyphens for multi-word names. Chinese filenames are acceptable and already used (`建站过程记录.html`).

## Style conventions

All styling lives in `style.css`. The visual theme is inspired by the film *Prometheus*: sci-fi, archaeological, industrial, dark.

Key design tokens:

- Background: `#080a0b`
- Body text: `#e8e4dc`
- Muted text: `#9e998f`
- Accent / links (holographic cyan): `#00e5ff`
- Borders / dividers (Weyland grey): `#2a3033`
- Danger / rust red (used sparingly): `#8b3a3a`
- Heading font: `"Noto Serif SC", Georgia, "Songti SC", "STSong", serif`
- Mono / meta font: `"SFMono-Regular", "Menlo", "Consolas", "Noto Sans SC", monospace`
- UI font: `"JetBrains Mono", "Rajdhani", "Inter", sans-serif`

When adding new elements, match the existing spacing, border radius (`2px`), bracket decorations, scan-line textures, and hover transitions. Avoid introducing new colors unless necessary.

## Comments

Notes use Giscus, which stores comments in GitHub Discussions. The Giscus script block is identical in every note and must not be modified unless the repository or category changes.

Important limitation: Giscus rejects `file:///` origins. Comments can only be tested after pushing to the live URL; local preview shows the page layout but not the comment widget.

## Deployment

### Current Vercel deployment

The site is deployed on Vercel. To deploy manually:

```powershell
# From the repository root
vercel --prod
```

To link the Vercel project to the GitHub repository for automatic deploys on push, use the Vercel dashboard or:

```powershell
vercel git connect
```

### GitHub Pages

The repository is also configured for GitHub Pages from the `main` branch. Pushing to `origin main` updates the GitHub Pages site at `https://xixihi197.github.io/my-ai-blog/`.

## Environment variables

The serverless function requires `GITHUB_TOKEN` to be set in the Vercel project environment variables. The token needs `repo` or `contents:write` permission for `xixihi197/my-ai-blog`.

## Image handling

- Image assets go in `images/<slug>/<filename>`.
- Reference images from notes with `../images/<slug>/<filename>`.
- When submitting through the form, use the original filename in Markdown image syntax; the backend replaces it with the actual stored path.
- Allowed image types: `image/jpeg`, `image/png`, `image/webp`.
- Maximum 5 images per submission, each ≤ 2MB.

## Notes on file naming

- Use `.html` extensions.
- Submission slugs are derived from the title and preserve Chinese characters.
- Generated note filenames match the slug: `notes/<slug>.html`.
