const Busboy = require('busboy');

const REPO = process.env.GITHUB_REPO || 'xixihi197/my-ai-blog';
const TOKEN = process.env.GITHUB_TOKEN;
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const SITE_URL = (process.env.SITE_URL || 'https://xixihi197.github.io/my-ai-blog').replace(/\/$/, '');

const MAX_FILES = 5;
const MAX_SIZE = 2 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX = 5;

// 简易内存频率限制（按 IP）
const rateLimit = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const requests = rateLimit.get(ip) || [];
  const recent = requests.filter((t) => t > windowStart);
  if (recent.length >= RATE_LIMIT_MAX) return false;
  recent.push(now);
  rateLimit.set(ip, recent);
  return true;
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res, status, data) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.statusCode = status;
  res.end(JSON.stringify(data));
}

function parseForm(req) {
  return new Promise((resolve, reject) => {
    const fields = {};
    const files = [];
    let tooLarge = false;

    const bb = Busboy({
      headers: req.headers,
      limits: { files: MAX_FILES, fileSize: MAX_SIZE },
    });

    bb.on('file', (name, file, info) => {
      const chunks = [];
      let size = 0;
      let limitReached = false;

      file.on('data', (chunk) => {
        size += chunk.length;
        chunks.push(chunk);
      });

      file.on('limit', () => {
        limitReached = true;
        tooLarge = true;
      });

      file.on('end', () => {
        files.push({
          name,
          filename: info.filename,
          mimeType: info.mimeType,
          buffer: Buffer.concat(chunks),
          size,
          limitReached,
        });
      });
    });

    bb.on('field', (name, value) => {
      fields[name] = value;
    });

    bb.on('filesLimit', () => {
      tooLarge = true;
    });

    bb.on('error', reject);

    bb.on('close', () => {
      resolve({ fields, files, tooLarge });
    });

    req.pipe(bb);
  });
}

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

// 轻量级 Markdown → HTML，支持段落、标题、列表、代码、加粗/斜体、链接、图片
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
    return escapeHtml(text)
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/_([^_]+)_/g, '<em>$1</em>');
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

function buildNoteHtml({ title, category, date, contentHtml }) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)} · 研习录</title>
    <link rel="stylesheet" href="../style.css">
</head>
<body>
    <main>
        <nav class="site-nav" aria-label="主导航">
            <a href="../index.html">首页</a> · <a href="../categories.html">分类</a> · <a href="../pages/submit.html">投稿</a>
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

        <p><a href="../index.html">返回首页</a></p>
    </main>
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

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    json(res, 405, { success: false, message: '仅支持 POST 请求' });
    return;
  }

  const clientIp = getClientIp(req);
  if (!checkRateLimit(clientIp)) {
    json(res, 429, { success: false, message: '请求过于频繁，请 15 分钟后再试' });
    return;
  }

  if (!TOKEN) {
    json(res, 500, { success: false, message: '服务器未配置 GITHUB_TOKEN' });
    return;
  }

  try {
    const { fields, files, tooLarge } = await parseForm(req);

    if (tooLarge) {
      json(res, 400, {
        success: false,
        message: '图片数量或大小超出限制（最多 5 张，每张 ≤ 2MB）',
      });
      return;
    }

    const title = (fields.title || '').trim();
    const category = (fields.category || '').trim();
    const author = (fields.author || '').trim();
    const summary = (fields.summary || '').trim();
    const content = (fields.content || '').trim();

    if (!title || title.length > 120) {
      json(res, 400, { success: false, message: '标题必填，且不超过 120 字' });
      return;
    }
    if (!category || category.length > 40) {
      json(res, 400, { success: false, message: '分类必填，且不超过 40 字' });
      return;
    }
    if (!author || author.length > 40) {
      json(res, 400, { success: false, message: '作者昵称必填，且不超过 40 字' });
      return;
    }
    if (!summary || summary.length > 300) {
      json(res, 400, { success: false, message: '摘要必填，且不超过 300 字' });
      return;
    }
    if (!content || content.length > 50000) {
      json(res, 400, { success: false, message: '正文必填，且不超过 50000 字' });
      return;
    }

    for (const file of files) {
      if (!ALLOWED_TYPES.includes(file.mimeType)) {
        json(res, 400, { success: false, message: `不支持的图片格式：${file.filename}` });
        return;
      }
      if (file.size > MAX_SIZE || file.limitReached) {
        json(res, 400, { success: false, message: `图片超过 2MB：${file.filename}` });
        return;
      }
    }

    const date = formatDate(new Date());
    const slug = toSlug(title);

    const existingNote = await githubGet(`notes/${slug}.html`);
    if (existingNote) {
      json(res, 409, { success: false, message: `已存在相同标题的笔记（slug: ${slug}）` });
      return;
    }

    // 上传图片，并建立文件名 → 实际路径映射
    const imageMap = {};
    const usedNames = new Set();
    for (const file of files) {
      let safeName = ensureImageExtension(file.filename, file.mimeType)
        .replace(/[^a-zA-Z0-9一-龥._-]/g, '')
        .toLowerCase();
      if (!safeName) safeName = 'image';
      if (usedNames.has(safeName)) {
        const base = safeName.replace(/\.[^.]+$/, '');
        const ext = safeName.match(/\.[^.]+$/)?.[0] || '';
        let counter = 2;
        let candidate = `${base}-${counter}${ext}`;
        while (usedNames.has(candidate)) {
          counter += 1;
          candidate = `${base}-${counter}${ext}`;
        }
        safeName = candidate;
      }
      usedNames.add(safeName);

      const path = `images/${slug}/${safeName}`;
      imageMap[file.filename] = `../${path}`;
      await githubPut(path, file.buffer.toString('base64'), `投稿图片：${file.filename}（${title}）`);
    }

    // 将正文里的 ![alt](filename) 替换为上传后的实际路径，再渲染 Markdown
    let processedContent = content;
    for (const [filename, url] of Object.entries(imageMap)) {
      const regex = new RegExp(`!\\[([^\\]]*)\\]\\(${escapeRegExp(filename)}\\)`, 'g');
      processedContent = processedContent.replace(regex, `![$1](${url})`);
    }

    const contentHtml = mdToHtml(processedContent);
    const noteHtml = buildNoteHtml({ title, category, date, contentHtml });
    await githubPut(`notes/${slug}.html`, Buffer.from(noteHtml, 'utf-8').toString('base64'), `投稿笔记：${title}`);

    const indexFile = await githubGet('index.html');
    if (!indexFile) throw new Error('无法读取 index.html');
    const indexHtml = Buffer.from(indexFile.content, 'base64').toString('utf-8');
    const newIndexHtml = updateIndexHtml(indexHtml, { slug, title, category, date, summary });
    await githubPut('index.html', Buffer.from(newIndexHtml, 'utf-8').toString('base64'), `首页添加笔记：${title}`, indexFile.sha);

    const categoriesFile = await githubGet('categories.html');
    if (!categoriesFile) throw new Error('无法读取 categories.html');
    const categoriesHtml = Buffer.from(categoriesFile.content, 'base64').toString('utf-8');
    const newCategoriesHtml = updateCategoriesHtml(categoriesHtml, { slug, title, category, date });
    await githubPut('categories.html', Buffer.from(newCategoriesHtml, 'utf-8').toString('base64'), `分类添加笔记：${title}`, categoriesFile.sha);

    json(res, 200, {
      success: true,
      url: `${SITE_URL}/notes/${slug}.html`,
      slug,
      createdAt: date,
    });
  } catch (err) {
    console.error('Submit error:', err);
    json(res, 500, { success: false, message: err.message || '服务器内部错误' });
  }
};
