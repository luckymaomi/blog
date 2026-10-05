import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from '../libs/marked/marked.esm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const POSTS_DIR = path.join(ROOT, 'posts');
export const DIST_DIR = path.join(ROOT, 'dist');
export const CONFIG_PATH = path.join(ROOT, 'config.json');
export const ORDER_PATH = path.join(POSTS_DIR, 'order.json');

const FILE_RE = /^(\d{4})-(\d{2})-(\d{2})-([^/\\]+)\.md$/i;

marked.setOptions({ gfm: true, breaks: false });

export function ensurePostsDir() {
  fs.mkdirSync(POSTS_DIR, { recursive: true });
}

export function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

export function slugify(text) {
  const base = String(text || 'post')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\w\u4e00-\u9fff-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return (base || 'post').slice(0, 60);
}

export function parseFilename(name) {
  const m = String(name).match(FILE_RE);
  if (!m) return null;
  return {
    year: m[1],
    date: `${m[1]}-${m[2]}-${m[3]}`,
    slug: m[4],
    filename: name,
  };
}

/** Strip trailing .md — single owner for post URL/folder stem. */
export function postStem(filename) {
  return String(filename).replace(/\.md$/i, '');
}

function resolvePostFile(filename) {
  const meta = parseFilename(filename);
  if (!meta) throw new Error('文件名须为 YYYY-MM-DD-slug.md');
  const root = path.resolve(POSTS_DIR);
  const full = path.resolve(POSTS_DIR, filename);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (full !== root && !full.startsWith(prefix)) {
    throw new Error('非法文件名');
  }
  return { meta, full };
}

function extractTitle(body, fallback) {
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const h1 = t.match(/^#\s+(.+)$/);
    if (h1) return h1[1].trim();
    return t.replace(/^#+\s*/, '').slice(0, 80) || fallback;
  }
  return fallback;
}

function readOrder() {
  ensurePostsDir();
  if (!fs.existsSync(ORDER_PATH)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(ORDER_PATH, 'utf8'));
    return Array.isArray(data) ? data.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeOrder(order) {
  ensurePostsDir();
  fs.writeFileSync(ORDER_PATH, `${JSON.stringify(order, null, 2)}\n`, 'utf8');
}

function byDateDesc(a, b) {
  // YYYY-MM-DD-slug.md → newer date first; same day keep name desc
  return b.localeCompare(a);
}

function byDateAsc(a, b) {
  const da = parseFilename(a)?.date || '';
  const db = parseFilename(b)?.date || '';
  if (da !== db) return da.localeCompare(db);
  return a.localeCompare(b);
}

function syncOrder(filenames) {
  const set = new Set(filenames);
  const prev = readOrder().filter((name) => set.has(name));
  const missing = filenames.filter((name) => !prev.includes(name)).sort(byDateDesc);
  // 默认倒序：已有手动顺序保留；新文章按日期倒序接在前面（更新的更靠上）
  const next = prev.length ? [...missing, ...prev] : [...filenames].sort(byDateDesc);
  writeOrder(next);
  return next;
}

export function listPosts() {
  ensurePostsDir();
  const files = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith('.md'));
  const order = syncOrder(files);
  const byName = new Map();

  for (const file of files) {
    const meta = parseFilename(file);
    if (!meta) continue;
    const raw = fs.readFileSync(path.join(POSTS_DIR, file), 'utf8');
    byName.set(file, {
      ...meta,
      title: extractTitle(raw, meta.slug),
      body: raw,
      relPath: `posts/${file}`,
    });
  }

  const posts = [];
  for (const name of order) {
    const post = byName.get(name);
    if (post) posts.push(post);
  }
  return posts;
}

export function groupByYear(posts) {
  const map = new Map();
  for (const p of posts) {
    const list = map.get(p.year) || [];
    list.push(p);
    map.set(p.year, list);
  }
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([year, items]) => ({ year, posts: items }));
}

export function readPost(filename) {
  const { meta, full } = resolvePostFile(filename);
  if (!fs.existsSync(full)) throw new Error('文章不存在');
  const body = fs.readFileSync(full, 'utf8');
  return {
    ...meta,
    title: extractTitle(body, meta.slug),
    body,
    html: marked.parse(body),
    relPath: `posts/${filename}`,
  };
}

export function writePost(filename, body) {
  const { full } = resolvePostFile(filename);
  ensurePostsDir();
  const existed = fs.existsSync(full);
  fs.writeFileSync(full, body.replace(/\r\n/g, '\n'), 'utf8');
  if (!existed) {
    const order = readOrder();
    if (!order.includes(filename)) {
      order.unshift(filename);
      writeOrder(order);
    }
  }
  return readPost(filename);
}

export function createPost({ title, date, slug }) {
  const d = date || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error('日期格式应为 YYYY-MM-DD');
  const heading = String(title || slug || 'post').trim().replace(/\s+/g, ' ');
  const s = slugify(slug || heading || 'post');
  const filename = `${d}-${s}.md`;
  const { full } = resolvePostFile(filename);
  if (fs.existsSync(full)) throw new Error('同名文件已存在');
  return writePost(filename, `# ${heading || s}\n\n`);
}

export function renamePost(from, to) {
  const src = resolvePostFile(from);
  const dest = resolvePostFile(to);
  if (!fs.existsSync(src.full)) throw new Error('源文件不存在');
  if (from !== to && fs.existsSync(dest.full)) throw new Error('目标文件已存在');
  if (from !== to) fs.renameSync(src.full, dest.full);
  const order = readOrder().map((name) => (name === from ? to : name));
  writeOrder(order);
  return readPost(to);
}

export function deletePost(filename) {
  const { full } = resolvePostFile(filename);
  if (!fs.existsSync(full)) throw new Error('文章不存在');
  fs.unlinkSync(full);
  writeOrder(readOrder().filter((name) => name !== filename));
  return { ok: true };
}

export function reorderPosts(filenames) {
  if (!Array.isArray(filenames)) throw new Error('order 必须是数组');
  const files = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith('.md'));
  const set = new Set(files);
  const next = [];
  for (const name of filenames) {
    if (typeof name !== 'string' || !set.has(name)) {
      throw new Error(`排序包含无效文件: ${name}`);
    }
    if (!next.includes(name)) next.push(name);
  }
  for (const name of files) {
    if (!next.includes(name)) next.push(name);
  }
  writeOrder(next);
  return listPosts().map(({ body, ...rest }) => rest);
}

export function renderMarkdown(text) {
  return marked.parse(text || '');
}

export function monthDay(dateStr) {
  const parts = String(dateStr).split('-');
  if (parts.length < 3) return dateStr;
  return `${parts[0]}-${Number(parts[1])}/${Number(parts[2])}`;
}

function exportDateLabel(dateStr) {
  const parts = String(dateStr).split('-');
  if (parts.length < 3) return dateStr;
  return `${parts[0]}年${Number(parts[1])}月${Number(parts[2])}日`;
}

/** Merge all posts into one markdown file, oldest first. */
export function exportPostsMarkdown() {
  const cfg = loadConfig();
  const siteTitle = cfg.site?.title || '猫咪的博客';
  const posts = listPosts()
    .slice()
    .sort((a, b) => byDateAsc(a.filename, b.filename));

  const parts = [`# ${siteTitle}`, ''];
  for (const post of posts) {
    parts.push(`## ${exportDateLabel(post.date)} · ${post.title}`, '', post.body.trim(), '');
  }
  return `${parts.join('\n').trim()}\n`;
}

export function exportPostsFilename() {
  return 'maomi-full-blogs.md';
}
