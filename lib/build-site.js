import fs from 'node:fs';
import path from 'node:path';
import {
  DIST_DIR,
  ROOT,
  groupByYear,
  listPosts,
  loadConfig,
  monthDay,
  postStem,
  readPost,
  renderMarkdown,
} from './posts.js';
import { escapeHtml, joinHtml, pageDocument } from './html.js';

function indexBody(posts, siteTitle) {
  const groups = groupByYear(posts);
  const head = `<header class="site-head"><h1 class="site-title">${escapeHtml(siteTitle)}</h1></header>`;

  if (!groups.length) {
    return joinHtml([head, `<p class="empty">还没有文章。</p>`], '\n');
  }

  const sections = groups.map(({ year, posts: items }) => {
    const rows = items.map((p) => {
      const href = `posts/${encodeURIComponent(postStem(p.filename))}/`;
      return `<li><a href="${href}">${escapeHtml(p.title)}</a><span class="date">${escapeHtml(monthDay(p.date))}</span></li>`;
    });
    return joinHtml(
      [
        `<section class="year-block">`,
        `  <h2 class="year">${escapeHtml(year)}</h2>`,
        `  <ul class="list">`,
        ...rows.map((row) => `    ${row}`),
        `  </ul>`,
        `</section>`,
      ],
      '\n',
    );
  });

  return joinHtml([head, ...sections], '\n');
}

function postBody(post) {
  return joinHtml(
    [
      `    <p class="back"><a href="../../">返回</a></p>`,
      `    <article class="article prose">`,
      renderMarkdown(post.body),
      `      <p class="meta">${escapeHtml(post.date)}</p>`,
      `    </article>`,
    ],
    '\n',
  );
}

function copyAssets() {
  fs.copyFileSync(path.join(ROOT, 'site', 'site.css'), path.join(DIST_DIR, 'site.css'));
  fs.cpSync(path.join(ROOT, 'libs'), path.join(DIST_DIR, 'libs'), { recursive: true });
}

export function buildSite() {
  const cfg = loadConfig();
  const siteTitle = cfg.site?.title || '猫咪的博客';

  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_DIR, { recursive: true });
  copyAssets();

  const posts = listPosts();
  fs.writeFileSync(
    path.join(DIST_DIR, 'index.html'),
    pageDocument({
      title: siteTitle,
      body: indexBody(posts, siteTitle),
      cssHref: 'site.css',
      fontsHref: 'libs/fonts/fonts.css',
    }),
    'utf8',
  );

  for (const p of posts) {
    const full = readPost(p.filename);
    const dir = path.join(DIST_DIR, 'posts', postStem(p.filename));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'index.html'),
      pageDocument({
        title: `${full.title} · ${siteTitle}`,
        body: postBody(full),
        cssHref: '../../site.css',
        fontsHref: '../../libs/fonts/fonts.css',
      }),
      'utf8',
    );
  }

  return { pages: 1 + posts.length, out: DIST_DIR };
}
