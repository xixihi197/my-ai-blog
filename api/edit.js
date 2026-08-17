const {
  TOKEN,
  SITE_URL,
  mdToHtml,
  githubGet,
  githubPut,
  loadTokensJson,
  buildNoteHtml,
  updateIndexHtml,
  updateCategoriesHtml,
  removeFromIndexHtml,
  removeFromCategoriesHtml,
} = require('../lib/utils');

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res, status, data) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.statusCode = status;
  res.end(JSON.stringify(data));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf-8');
        resolve(text ? JSON.parse(text) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

async function getNoteMeta(slug) {
  const file = await githubGet(`data/notes/${slug}.json`);
  if (!file) return null;
  const content = Buffer.from(file.content, 'base64').toString('utf-8');
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function saveNoteMeta(slug, meta, message) {
  const content = Buffer.from(JSON.stringify(meta, null, 2), 'utf-8').toString('base64');
  const file = await githubGet(`data/notes/${slug}.json`);
  await githubPut(`data/notes/${slug}.json`, content, message, file?.sha);
}

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (!TOKEN) {
    json(res, 500, { success: false, message: '服务器未配置 GITHUB_TOKEN' });
    return;
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const slug = url.searchParams.get('slug');
    const token = url.searchParams.get('token');

    if (!slug || !token) {
      json(res, 400, { success: false, message: '缺少 slug 或 token' });
      return;
    }

    const tokens = await loadTokensJson();
    if (tokens[slug] !== token) {
      json(res, 403, { success: false, message: '编辑令牌无效' });
      return;
    }

    if (req.method === 'GET') {
      const meta = await getNoteMeta(slug);
      if (!meta) {
        json(res, 404, { success: false, message: '笔记不存在' });
        return;
      }
      json(res, 200, {
        success: true,
        slug,
        title: meta.title,
        category: meta.category,
        author: meta.author,
        summary: meta.summary,
        content: meta.content,
        date: meta.date,
      });
      return;
    }

    if (req.method === 'POST') {
      const body = await parseJsonBody(req);

      const title = (body.title || '').trim();
      const category = (body.category || '').trim();
      const author = (body.author || '').trim();
      const summary = (body.summary || '').trim();
      const content = (body.content || '').trim();

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

      const meta = await getNoteMeta(slug);
      if (!meta) {
        json(res, 404, { success: false, message: '笔记不存在' });
        return;
      }

      const date = meta.date;
      const contentHtml = mdToHtml(content);
      const noteHtml = buildNoteHtml({ title, category, date, contentHtml, siteUrl: SITE_URL, slug, editToken: token });

      const noteFile = await githubGet(`notes/${slug}.html`);
      await githubPut(`notes/${slug}.html`, Buffer.from(noteHtml, 'utf-8').toString('base64'), `编辑笔记：${title}`, noteFile?.sha);

      const newMeta = { ...meta, title, category, author, summary, content };
      await saveNoteMeta(slug, newMeta, `更新笔记元数据：${slug}`);

      const indexFile = await githubGet('index.html');
      if (!indexFile) throw new Error('无法读取 index.html');
      let indexHtml = Buffer.from(indexFile.content, 'base64').toString('utf-8');
      indexHtml = removeFromIndexHtml(indexHtml, slug);
      indexHtml = updateIndexHtml(indexHtml, { slug, title, category, date, summary });
      await githubPut('index.html', Buffer.from(indexHtml, 'utf-8').toString('base64'), `首页更新笔记：${title}`, indexFile.sha);

      const categoriesFile = await githubGet('categories.html');
      if (!categoriesFile) throw new Error('无法读取 categories.html');
      let categoriesHtml = Buffer.from(categoriesFile.content, 'base64').toString('utf-8');
      categoriesHtml = removeFromCategoriesHtml(categoriesHtml, slug);
      categoriesHtml = updateCategoriesHtml(categoriesHtml, { slug, title, category, date });
      await githubPut('categories.html', Buffer.from(categoriesHtml, 'utf-8').toString('base64'), `分类更新笔记：${title}`, categoriesFile.sha);

      json(res, 200, {
        success: true,
        url: `${SITE_URL}/notes/${slug}.html`,
        slug,
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    json(res, 405, { success: false, message: '仅支持 GET 或 POST 请求' });
  } catch (err) {
    console.error('Edit error:', err);
    json(res, 500, { success: false, message: err.message || '服务器内部错误' });
  }
};
