const {
  TOKEN,
  githubGet,
  githubPut,
  githubDelete,
  loadTokensJson,
  saveTokensJson,
  removeFromIndexHtml,
  removeFromCategoriesHtml,
} = require('../lib/utils');

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

async function deleteDirectory(path) {
  const items = await githubGet(path);
  if (!items) return;
  const files = Array.isArray(items) ? items : [items];
  for (const file of files) {
    if (file.type === 'file') {
      await githubDelete(`${path}/${file.name}`, `删除文件：${path}/${file.name}`, file.sha);
    }
  }
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

  if (!TOKEN) {
    json(res, 500, { success: false, message: '服务器未配置 GITHUB_TOKEN' });
    return;
  }

  try {
    const body = await parseJsonBody(req);
    const slug = (body.slug || '').trim();
    const token = (body.token || '').trim();

    if (!slug || !token) {
      json(res, 400, { success: false, message: '缺少 slug 或 token' });
      return;
    }

    const tokens = await loadTokensJson();
    if (tokens[slug] !== token) {
      json(res, 403, { success: false, message: '删除令牌无效' });
      return;
    }

    const noteFile = await githubGet(`notes/${slug}.html`);
    if (noteFile) {
      await githubDelete(`notes/${slug}.html`, `删除笔记：${slug}`, noteFile.sha);
    }

    const metaFile = await githubGet(`data/notes/${slug}.json`);
    if (metaFile) {
      await githubDelete(`data/notes/${slug}.json`, `删除笔记元数据：${slug}`, metaFile.sha);
    }

    await deleteDirectory(`images/${slug}`);

    delete tokens[slug];
    await saveTokensJson(tokens, `移除编辑 token：${slug}`);

    const indexFile = await githubGet('index.html');
    if (indexFile) {
      let indexHtml = Buffer.from(indexFile.content, 'base64').toString('utf-8');
      indexHtml = removeFromIndexHtml(indexHtml, slug);
      await githubPut('index.html', Buffer.from(indexHtml, 'utf-8').toString('base64'), `首页移除笔记：${slug}`, indexFile.sha);
    }

    const categoriesFile = await githubGet('categories.html');
    if (categoriesFile) {
      let categoriesHtml = Buffer.from(categoriesFile.content, 'base64').toString('utf-8');
      categoriesHtml = removeFromCategoriesHtml(categoriesHtml, slug);
      await githubPut('categories.html', Buffer.from(categoriesHtml, 'utf-8').toString('base64'), `分类移除笔记：${slug}`, categoriesFile.sha);
    }

    json(res, 200, {
      success: true,
      message: '笔记已删除',
      slug,
    });
  } catch (err) {
    console.error('Delete error:', err);
    json(res, 500, { success: false, message: err.message || '服务器内部错误' });
  }
};
