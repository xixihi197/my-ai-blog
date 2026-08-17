const crypto = require('crypto');

const REPO = process.env.GITHUB_REPO || 'xixihi197/my-ai-blog';
const TOKEN = process.env.GITHUB_TOKEN;
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const SITE_URL = (process.env.SITE_URL || 'https://xixihi197.github.io/my-ai-blog').replace(/\/$/, '');
const TOKENS_PATH = 'data/tokens.json';

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 把 Markdown 内容中的本地图片引用（basename）替换为实际存储路径。
// 支持全角/半角归一化（NFKC），支持引用中带路径前缀。
function resolveImagePaths(content, imageMap) {
  const normalizedMap = {};
  for (const [filename, url] of Object.entries(imageMap)) {
    normalizedMap[filename.normalize('NFKC')] = url;
  }

  return content.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, src) => {
    if (/^https?:\/\//i.test(src)) return match;
    const basename = src.normalize('NFKC').split('/').pop().split('\\').pop();
    const url = normalizedMap[basename];
    return url ? `![${alt}](${url})` : match;
  });
}

function listMissingImages(content, imageMap) {
  const uploadedNames = new Set(Object.keys(imageMap).map((n) => n.normalize('NFKC')));
  const missing = [];
  content.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, src) => {
    if (/^https?:\/\//i.test(src)) return match;
    const basename = src.normalize('NFKC').split('/').pop().split('\\').pop();
    if (!uploadedNames.has(basename)) {
      missing.push(basename);
    }
    return match;
  });
  return missing;
}

// 轻量级 Markdown → HTML
function mdToHtml(md) {
  const lines = md.split(/\r?\n/);
  let html = '';
  let inCodeBlock = false;
  let codeBuffer = [];
  let inUl = false;
  let inOl = false;

  const closeLists = () => {
    if (inUl) {
      html += '</ul>\n';
      inUl = false;
    }
    if (inOl) {
      html += '</ol>\n';
      inOl = false;
    }
  };

  const inlineToHtml = (text) => {
    const placeholders = [];
    let processed = escapeHtml(text)
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, src) => {
        const placeholder = `\0IMG${placeholders.length}\0`;
        placeholders.push(`<img alt="${escapeHtml(alt)}" src="${escapeHtml(src)}">`);
        return placeholder;
      })
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/_([^_]+)_/g, '<em>$1</em>');

    placeholders.forEach((img, i) => {
      processed = processed.replace(`\0IMG${i}\0`, img);
    });
    return processed;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('```')) {
      if (inCodeBlock) {
        html += '<pre><code>' + escapeHtml(codeBuffer.join('\n')) + '</code></pre>\n';
        codeBuffer = [];
        inCodeBlock = false;
      } else {
        closeLists();
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      if (inOl) closeLists();
      if (!inUl) {
        html += '<ul>\n';
        inUl = true;
      }
      const item = line.replace(/^\s*[-*]\s+/, '');
      html += '<li>' + inlineToHtml(item) + '</li>\n';
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      if (inUl) closeLists();
      if (!inOl) {
        html += '<ol>\n';
        inOl = true;
      }
      const item = line.replace(/^\s*\d+\.\s+/, '');
      html += '<li>' + inlineToHtml(item) + '</li>\n';
      continue;
    }

    closeLists();

    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      html += `<h${level}>${inlineToHtml(headerMatch[2])}</h${level}>\n`;
      continue;
    }

    if (line.trim() === '') {
      continue;
    }

    html += '<p>' + inlineToHtml(line) + '</p>\n';
  }

  closeLists();
  if (inCodeBlock) {
    html += '<pre><code>' + escapeHtml(codeBuffer.join('\n')) + '</code></pre>\n';
  }

  return html;
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toSlug(title) {
  let slug = title
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9一-龥\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  if (!slug) slug = 'note-' + formatDate(new Date());
  return slug;
}

function ensureImageExtension(filename, mimeType) {
  const extMap = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  const parts = filename.split('.');
  const ext = parts.length > 1 ? parts.pop().toLowerCase() : '';
  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return filename;
  const expected = extMap[mimeType];
  return expected ? `${filename}.${expected}` : filename;
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function githubGet(path) {
  const url = `https://api.github.com/repos/${REPO}/contents/${encodeURIComponent(path)}?ref=${BRANCH}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'my-ai-blog-submit',
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub GET ${path} 失败：${res.status} ${text}`);
  }
  return res.json();
}

async function githubPut(path, contentBase64, message, sha) {
  const url = `https://api.github.com/repos/${REPO}/contents/${encodeURIComponent(path)}`;
  const body = { message, content: contentBase64, branch: BRANCH };
  if (sha) body.sha = sha;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'my-ai-blog-submit',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub PUT ${path} 失败：${res.status} ${text}`);
  }
  return res.json();
}

async function githubDelete(path, message, sha) {
  const url = `https://api.github.com/repos/${REPO}/contents/${encodeURIComponent(path)}`;
  const body = { message, branch: BRANCH, sha };

  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'my-ai-blog-submit',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub DELETE ${path} 失败：${res.status} ${text}`);
  }
  return res.json();
}

async function loadTokensJson() {
  const file = await githubGet(TOKENS_PATH);
  if (!file) return {};
  const content = Buffer.from(file.content, 'base64').toString('utf-8');
  try {
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function saveTokensJson(tokens, message) {
  const content = Buffer.from(JSON.stringify(tokens, null, 2), 'utf-8').toString('base64');
  const file = await githubGet(TOKENS_PATH);
  await githubPut(TOKENS_PATH, content, message, file?.sha);
}

function buildNoteHtml({ title, category, date, contentHtml, siteUrl, slug, editToken }) {
  const editUrl = `${siteUrl}/pages/edit.html?slug=${encodeURIComponent(slug)}&token=${editToken}`;
  const deleteUrl = `${siteUrl}/pages/delete.html?slug=${encodeURIComponent(slug)}&token=${editToken}`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)} · 研习录</title>
    <link rel="stylesheet" href="${siteUrl}/style.css">
</head>
<body>
    <main>
        <nav class="site-nav" aria-label="主导航">
            <a href="${siteUrl}/index.html">首页</a> · <a href="${siteUrl}/categories.html">分类</a> · <a href="${siteUrl}/pages/submit.html">投稿</a>
        </nav>

        <article class="note-full">
            <h1>${escapeHtml(title)}</h1>
            <time class="meta" datetime="${date}">${date}</time> <span class="tag">${escapeHtml(category)}</span>

${contentHtml}
        </article>

        <hr class="divider">

        <section class="comments">
            <h2>交流讨论</h2>
            <script src="https://giscus.app/client.js"
                    data-repo="xixihi197/my-ai-blog"
                    data-repo-id="R_kgDOTeGGIg"
                    data-category="General"
                    data-category-id="DIC_kwDOTeGGIs4DBlUb"
                    data-mapping="pathname"
                    data-strict="0"
                    data-reactions-enabled="1"
                    data-emit-metadata="0"
                    data-input-position="bottom"
                    data-theme="dark"
                    data-lang="zh-CN"
                    crossorigin="anonymous"
                    async>
            </script>
        </section>

        <p class="note-actions">
            <a href="${editUrl}">编辑笔记</a> ·
            <a href="${deleteUrl}">删除笔记</a> ·
            <a href="${siteUrl}/index.html">返回首页</a>
        </p>
    </main>

    <script>
        (function () {
            const overlay = document.createElement('div');
            overlay.className = 'lightbox-overlay';
            const img = document.createElement('img');
            overlay.appendChild(img);
            document.body.appendChild(overlay);

            overlay.addEventListener('click', function () {
                overlay.classList.remove('active');
            });

            document.querySelectorAll('.note-full img').forEach(function (el) {
                el.addEventListener('click', function () {
                    img.src = el.src;
                    overlay.classList.add('active');
                });
            });
        })();
    </script>
</body>
</html>`;
}

function updateIndexHtml(html, { slug, title, category, date, summary }) {
  const marker = '<section class="note-list" aria-label="笔记列表">';
  const idx = html.indexOf(marker);
  if (idx === -1) throw new Error('index.html 中未找到笔记列表标记');
  const hrIdx = html.indexOf('<hr>', idx + marker.length);
  if (hrIdx === -1) throw new Error('index.html 中未找到 <hr> 分隔线');
  const insertPos = hrIdx + '<hr>'.length;

  const note = `
            <article class="note">
                <h2><a href="notes/${slug}.html">${escapeHtml(title)}</a> <span class="tag">${escapeHtml(category)}</span></h2>
                <time class="meta" datetime="${date}">${date}</time>
                <p class="summary">${escapeHtml(summary)}</p>
            </article>`;

  return html.slice(0, insertPos) + note + html.slice(insertPos);
}

function updateCategoriesHtml(html, { slug, title, category, date }) {
  const marker = '<section class="note-list" aria-label="分类笔记列表">';
  const sectionStart = html.indexOf(marker);
  if (sectionStart === -1) throw new Error('categories.html 中未找到分类列表标记');
  const sectionEnd = html.indexOf('</section>', sectionStart + marker.length);
  if (sectionEnd === -1) throw new Error('categories.html 中未找到 </section>');

  const beforeSection = html.slice(0, sectionStart);
  const sectionContent = html.slice(sectionStart, sectionEnd);
  const afterSection = html.slice(sectionEnd);

  const heading = `<h2>${escapeHtml(category)}</h2>`;
  const headingIdx = sectionContent.indexOf(heading);

  const note = `            <article class="note">
                <h3><a href="notes/${slug}.html">${escapeHtml(title)}</a></h3>
                <time class="meta" datetime="${date}">${date}</time>
            </article>
`;

  let newSectionContent;
  if (headingIdx !== -1) {
    const insertPos = headingIdx + heading.length;
    newSectionContent = sectionContent.slice(0, insertPos) + '\n\n' + note + sectionContent.slice(insertPos);
  } else {
    newSectionContent = sectionContent + `\n            <h2>${escapeHtml(category)}</h2>\n${note}`;
  }

  return beforeSection + newSectionContent + afterSection;
}

function removeFromIndexHtml(html, slug) {
  const regex = new RegExp(`\\s*<article class="note"[^>]*>[\\s\\S]*?<a href="notes/${escapeRegExp(slug)}\\.html"[^>]*>[\\s\\S]*?</article>`, 'g');
  return html.replace(regex, '');
}

function removeFromCategoriesHtml(html, slug) {
  const marker = '<section class="note-list" aria-label="分类笔记列表">';
  const sectionStart = html.indexOf(marker);
  if (sectionStart === -1) return html;
  const sectionEnd = html.indexOf('</section>', sectionStart + marker.length);
  if (sectionEnd === -1) return html;

  const beforeSection = html.slice(0, sectionStart);
  const sectionContent = html.slice(sectionStart, sectionEnd);
  const afterSection = html.slice(sectionEnd);

  const regex = new RegExp(`\\s*<article class="note"[^>]*>[\\s\\S]*?<a href="notes/${escapeRegExp(slug)}\\.html"[^>]*>[\\s\\S]*?</article>\\n?`, 'g');
  const newSectionContent = sectionContent.replace(regex, '');

  return beforeSection + newSectionContent + afterSection;
}

module.exports = {
  REPO,
  TOKEN,
  BRANCH,
  SITE_URL,
  TOKENS_PATH,
  escapeHtml,
  escapeRegExp,
  resolveImagePaths,
  listMissingImages,
  mdToHtml,
  formatDate,
  toSlug,
  ensureImageExtension,
  generateToken,
  githubGet,
  githubPut,
  githubDelete,
  loadTokensJson,
  saveTokensJson,
  buildNoteHtml,
  updateIndexHtml,
  updateCategoriesHtml,
  removeFromIndexHtml,
  removeFromCategoriesHtml,
};
