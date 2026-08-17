# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

研习录 (`my-ai-blog`) is a Chinese-language blog for recording AI learning notes and sharing insights within a small circle. It supports public submission of notes, image uploads, and Giscus-based comments.

The site uses a hybrid architecture:

- **Static frontend**: plain HTML files + a single shared CSS file, hosted on **GitHub Pages** at `https://xixihi197.github.io/my-ai-blog/`.
- **Submission backend**: a Vercel Serverless Function (`api/submit.js`) at `https://my-ai-blog-psi.vercel.app/api/submit` that writes new notes directly to this GitHub repository via the GitHub API.
- **Comments**: Giscus, backed by GitHub Discussions.
- **Hosting**: static pages are served by GitHub Pages from the `main` branch; Vercel only runs the `/api/submit` endpoint.

There is no build system, no JavaScript bundler, and no test suite.

## Repository structure

- `index.html` — homepage listing all notes.
- `categories.html` — archive grouped by category.
- `pages/submit.html` — public submission form. Its `action` points to the full Vercel API URL.
- `style.css` — global styles; every page links to it.
- `notes/` — individual note pages.
- `images/` — screenshots and figures referenced by notes, organized as `images/<slug>/<filename>`.
- `api/submit.js` — Vercel Serverless Function that receives submissions and writes files to GitHub.
- `api/edit.js` — edits an existing note given the correct edit token.
- `api/delete.js` — deletes a note and its assets given the correct edit token.
- `lib/utils.js` — shared helpers used by the serverless functions.
- `data/tokens.json` — maps note slugs to edit tokens (do not expose unnecessarily).
- `data/notes/<slug>.json` — note metadata (title, category, author, summary, content, date, images) used by the edit flow.
- `package.json` / `package-lock.json` — Node dependencies for the Vercel function (`busboy`).

## How to add a new note

### Option 1: Submit through the website

1. Open `pages/submit.html` on the live site.
2. Fill in title, category, author, summary, and Markdown content.
3. To include images, write Markdown image syntax in the content using the **original uploaded filename** (basename only):
   ```markdown
   ![截图说明](原始文件名.jpg)
   ```
   The backend matches images by basename, so the exact path is not required.
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

### GitHub Pages (static frontend)

The repository is configured for GitHub Pages from the `main` branch. Pushing to `origin main` updates the site at `https://xixihi197.github.io/my-ai-blog/`.

```powershell
git add .
git commit -m "<message>"
git push origin main
```

### Vercel (API only)

The serverless function is deployed to Vercel and the project is already connected to the GitHub repository. Pushing to `main` automatically triggers a new Vercel production deployment.

To deploy manually from the repository root (rarely needed now):

```powershell
vercel --prod
```

If the Git connection is ever lost, reconnect it with:

```powershell
vercel git connect https://github.com/xixihi197/my-ai-blog.git
```

## Environment variables

The serverless function requires these Vercel project environment variables:

- `GITHUB_TOKEN` — GitHub personal access token with `repo` or `contents:write` permission for `xixihi197/my-ai-blog`.
- `SITE_URL` (optional) — public site URL used in generated notes and submission response. Defaults to `https://xixihi197.github.io/my-ai-blog`.
- `GITHUB_REPO` / `GITHUB_BRANCH` (optional) — override the target repository or branch. Defaults to `xixihi197/my-ai-blog` and `main`.

## Editing and deleting notes

Notes can be edited or deleted by anyone who has the note's edit token. The token is generated when a note is submitted and stored in `data/tokens.json`.

- Each generated note page includes **编辑笔记** and **删除笔记** links at the bottom, which carry the `slug` and `token` query parameters.
- `pages/edit.html` loads the existing note metadata from `api/edit.js` (GET) and submits changes via JSON (POST).
- `pages/delete.html` asks for confirmation and then calls `api/delete.js` to remove the note HTML, its metadata, its image directory, and its entries in `index.html` and `categories.html`.
- **Security model**: the edit token is a weak secret. Keep the edit/delete links private; anyone with the link can modify or remove the note.

## Image handling

- Image assets go in `images/<slug>/<filename>`.
- Reference images from notes with `../images/<slug>/<filename>`.
- When submitting through the form, use the original filename (basename) in Markdown image syntax; the backend replaces it with the actual stored path.
- The frontend now validates that every local image referenced in Markdown has a matching uploaded file before submission.
- The backend normalizes filenames with NFKC before matching, so full-width punctuation (e.g. `－`) and half-width punctuation (e.g. `-`) are treated as equivalent.
- Uploaded filenames are parsed as UTF-8, so Chinese characters are preserved correctly.
- Allowed image types: `image/jpeg`, `image/png`, `image/webp`.
- Maximum 5 images per submission, each ≤ 2MB.

### GitHub Pages image pitfall

GitHub Pages uses Jekyll by default, and Jekyll **ignores any file or directory whose name starts with an underscore `_`**. Screenshots uploaded from mobile devices often have names like `_20260812134452.png`, which means they are silently omitted from the published site and return 404.

To prevent this, the repository root contains an empty `.nojekyll` file. **Do not remove it.** If it is ever deleted, images with underscore-prefixed filenames (and any other `_`-prefixed assets) will stop being served on GitHub Pages. Vercel deployments are not affected by Jekyll, so the same images will still load on the Vercel URL.

### Image display

Images inside note pages are constrained to the page width by default (`max-width: 100%`). Clicking an image opens a full-screen lightbox overlay so readers can view the original size without leaving the page.

## Notes on file naming

- Use `.html` extensions.
- Submission slugs are derived from the title and preserve Chinese characters.
- Generated note filenames match the slug: `notes/<slug>.html`.
