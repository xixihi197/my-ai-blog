const Busboy = require('busboy');
const path = require('path');
const {
  TOKEN,
  SITE_URL,
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
  loadTokensJson,
  saveTokensJson,
  buildNoteHtml,
  updateIndexHtml,
  updateCategoriesHtml,
} = require('../lib/utils');

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
      defParamCharset: 'utf8',
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

    const imageMap = {};
    const usedNames = new Set();
    for (const file of files) {
      const originalName = path.basename(file.filename).replace(/\\/g, '/');
      let safeName = ensureImageExtension(originalName, file.mimeType)
        .replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '')
        .trim();
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

      const imagePath = `images/${slug}/${safeName}`;
      imageMap[originalName] = `../${imagePath}`;
      await githubPut(imagePath, file.buffer.toString('base64'), `投稿图片：${originalName}（${title}）`);
    }

    // 将正文里的 ![alt](filename) 替换为上传后的实际路径，再渲染 Markdown
    const processedContent = resolveImagePaths(content, imageMap);
    const missingImages = listMissingImages(content, imageMap);

    const contentHtml = mdToHtml(processedContent);
    const editToken = generateToken();
    const noteHtml = buildNoteHtml({ title, category, date, contentHtml, siteUrl: SITE_URL, slug, editToken });
    await githubPut(`notes/${slug}.html`, Buffer.from(noteHtml, 'utf-8').toString('base64'), `投稿笔记：${title}`);

    const noteMeta = {
      title,
      category,
      author,
      summary,
      content: processedContent,
      date,
      images: Object.values(imageMap),
    };
    await githubPut(
      `data/notes/${slug}.json`,
      Buffer.from(JSON.stringify(noteMeta, null, 2), 'utf-8').toString('base64'),
      `记录笔记元数据：${slug}`
    );

    const tokens = await loadTokensJson();
    tokens[slug] = editToken;
    await saveTokensJson(tokens, `记录编辑 token：${slug}`);

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
      editUrl: `${SITE_URL}/pages/edit.html?slug=${encodeURIComponent(slug)}&token=${editToken}`,
      slug,
      createdAt: date,
      warnings: missingImages.length > 0
        ? [`以下图片在 Markdown 中有引用但未上传，将无法正常显示：${missingImages.join('、')}`]
        : undefined,
    });
  } catch (err) {
    console.error('Submit error:', err);
    json(res, 500, { success: false, message: err.message || '服务器内部错误' });
  }
};
