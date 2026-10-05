import fs from 'node:fs';
import path from 'node:path';
import {
  DIST_DIR,
  ROOT,
  escapeHtml,
  groupByYear,
  listPosts,
  loadConfig,
  monthDay,
  readPost,
  renderMarkdown,
} from './posts.js';

function pageShell({ title, body, cssHref, fontsHref }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="${fontsHref}" />
  <link rel="stylesheet" href="${cssHref}" />
</head>
<body>
  <div class="wrap">
    ${body}
  </div>
</body>
</html>
`;
}

function renderIndex(posts, siteTitle) {
  const groups = groupByYear(posts);
  let html = `<header class="site-head"><h1 class="site-title">${escapeHtml(siteTitle)}</h1></header>`;
  if (!groups.length) {
    html += `<p class="empty">还没有文章。</p>`;
  } else {
    for (const { year, posts: items } of groups) {
      html += `<section class="year-block"><h2 class="year">${escapeHtml(year)}</h2><ul class="list">`;
      for (const p of items) {
        const href = `posts/${encodeURIComponent(p.filename.replace(/\.md$/, ''))}/`;
        html += `<li><a href="${href}">${escapeHtml(p.title)}</a><span class="date">${escapeHtml(monthDay(p.date))}</span></li>`;
      }
      html += `</ul></section>`;
    }
  }
  return pageShell({
    title: siteTitle,
    body: html,
    cssHref: 'site.css',
    fontsHref: 'libs/fonts/fonts.css',
  });
}

function renderPost(post, siteTitle) {
  const htmlBody = renderMarkdown(post.body);
  const body = `
    <p class="back"><a href="../../">返回</a></p>
    <article class="article prose">
      ${htmlBody}
      <p class="meta">${escapeHtml(post.date)}</p>
    </article>
  `;
  return pageShell({
    title: `${post.title} · ${siteTitle}`,
    body,
    cssHref: '../../site.css',
    fontsHref: '../../libs/fonts/fonts.css',
  });
}

function copyAssets() {
  const siteCss = path.join(ROOT, 'site', 'site.css');
  fs.copyFileSync(siteCss, path.join(DIST_DIR, 'site.css'));

  const srcLibs = path.join(ROOT, 'libs');
  const destLibs = path.join(DIST_DIR, 'libs');
  fs.cpSync(srcLibs, destLibs, { recursive: true });
}

export function buildSite() {
  const cfg = loadConfig();
  const siteTitle = cfg.site?.title || 'Talk';
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_DIR, { recursive: true });
  copyAssets();

  const posts = listPosts();
  fs.writeFileSync(path.join(DIST_DIR, 'index.html'), renderIndex(posts, siteTitle), 'utf8');

  for (const p of posts) {
    const full = readPost(p.filename);
    const dir = path.join(DIST_DIR, 'posts', p.filename.replace(/\.md$/, ''));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), renderPost(full, siteTitle), 'utf8');
  }

  return { pages: 1 + posts.length, out: DIST_DIR };
}
