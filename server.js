import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  ROOT,
  createPost,
  deletePost,
  exportPostsFilename,
  exportPostsMarkdown,
  listPosts,
  loadConfig,
  readPost,
  renamePost,
  reorderPosts,
  writePost,
} from './lib/posts.js';
import { buildSite } from './lib/build-site.js';

const execFileAsync = promisify(execFile);
const PORT = Number(process.env.PORT || 3456);
const ADMIN_DIR = path.join(ROOT, 'admin');
const LIBS_DIR = path.join(ROOT, 'libs');
const MAX_BODY = 2 * 1024 * 1024;
const DEV = process.env.DEV === '1';

/** Paths allowed into a push commit — never blind `git add -A`. */
const PUSH_PATHS = [
  'posts',
  'config.json',
  'admin',
  'site',
  'lib',
  'libs',
  'server.js',
  'build.js',
  'build.py',
  'start_admin.py',
  'package.json',
  'package-lock.json',
  '.github',
  'README.md',
];

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
});

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function safeName(name) {
  const value = String(name || '').trim();
  if (!value || value.includes('\0') || value.includes('..') || /[/\\]/.test(value)) {
    throw new Error('非法文件名');
  }
  return value;
}

function contentType(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

/** Resolve a path that must stay inside `root` (Windows-safe). */
function resolveInside(root, relativeParts) {
  const rootResolved = path.resolve(root);
  const target = path.resolve(root, ...relativeParts);
  const prefix = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep;
  if (target !== rootResolved && !target.startsWith(prefix)) {
    return null;
  }
  return target;
}

function serveStatic(res, filePath) {
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    send(res, 404, { error: 'Not found' });
    return;
  }
  res.writeHead(200, { 'Content-Type': contentType(filePath) });
  fs.createReadStream(filePath).pipe(res);
}

async function git(args, extraEnv = {}) {
  const { stdout, stderr } = await execFileAsync('git', args, {
    cwd: ROOT,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, ...extraEnv },
  });
  return `${stdout || ''}${stderr || ''}`.trim();
}

function pagesUrl(cfg) {
  const repo = cfg.github?.repo || cfg.push?.remote || '';
  const match = String(repo).match(/github\.com[/:]([^/]+)\/([^/.]+)/i);
  if (!match) return '';
  return `https://${match[1]}.github.io/${match[2]}/`;
}

async function getPushStatus() {
  const cfg = loadConfig();
  const remote = cfg.push?.remote || '';
  const branch = cfg.push?.branch || '';
  let commit = '';
  let at = '';
  let message = '';
  try {
    commit = await git(['rev-parse', '--short', 'HEAD']);
    at = await git(['log', '-1', '--format=%cI']);
    message = await git(['log', '-1', '--format=%s']);
  } catch {
    // bare repo / no commits
  }
  return {
    remote,
    branch,
    commit,
    at,
    message,
    pages: pagesUrl(cfg),
    pushConfigured: Boolean(remote && branch),
  };
}

async function ensureOrigin(remoteUrl) {
  try {
    await git(['remote', 'get-url', 'origin']);
    await git(['remote', 'set-url', 'origin', remoteUrl]);
  } catch {
    await git(['remote', 'add', 'origin', remoteUrl]);
  }
}

async function pushToRemote(message) {
  const cfg = loadConfig();
  const remoteUrl = cfg.push?.remote;
  const branch = cfg.push?.branch;
  if (!remoteUrl || !branch) {
    throw new Error('推送未配置：请在 config.json 填写 push.remote 与 push.branch');
  }

  buildSite();
  await ensureOrigin(remoteUrl);

  const identity = {
    GIT_AUTHOR_NAME: 'blog',
    GIT_AUTHOR_EMAIL: 'blog@users.noreply.github.com',
    GIT_COMMITTER_NAME: 'blog',
    GIT_COMMITTER_EMAIL: 'blog@users.noreply.github.com',
  };

  await git(['add', '--', ...PUSH_PATHS]);
  const status = await git(['status', '--porcelain', '--', ...PUSH_PATHS]);
  if (status) {
    await git(['commit', '-m', message || '更新文章'], identity);
  }

  await git(['push', '-u', 'origin', `HEAD:${branch}`]);
  return {
    ok: true,
    committed: Boolean(status),
    ...(await getPushStatus()),
  };
}

const reloadClients = new Set();
let reloadTimer = null;

function broadcastReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    for (const res of reloadClients) {
      try {
        res.write('event: reload\ndata: 1\n\n');
      } catch {
        reloadClients.delete(res);
      }
    }
  }, 120);
}

function watchDevFiles() {
  if (!DEV) return;
  for (const dir of [ADMIN_DIR, LIBS_DIR, path.join(ROOT, 'site')]) {
    if (!fs.existsSync(dir)) continue;
    fs.watch(dir, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      if (/\.(css|js|html|woff2?|mjs)$/i.test(filename)) broadcastReload();
    });
  }
}

function postNameFromPath(pathname) {
  return safeName(decodeURIComponent(pathname.slice('/api/posts/'.length)));
}

async function handleApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/config') {
    const cfg = loadConfig();
    return send(res, 200, {
      site: cfg.site,
      github: cfg.github,
      push: cfg.push,
      pushConfigured: Boolean(cfg.push?.remote && cfg.push?.branch),
      pages: pagesUrl(cfg),
    });
  }

  if (req.method === 'GET' && pathname === '/api/posts') {
    return send(
      res,
      200,
      listPosts().map(({ body, ...rest }) => rest),
    );
  }

  if (req.method === 'GET' && pathname === '/api/export') {
    const markdown = exportPostsMarkdown();
    const filename = exportPostsFilename();
    res.writeHead(200, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    });
    res.end(markdown);
    return true;
  }

  if (req.method === 'GET' && pathname.startsWith('/api/posts/')) {
    return send(res, 200, readPost(postNameFromPath(pathname)));
  }

  if (req.method === 'POST' && pathname === '/api/posts') {
    return send(res, 200, createPost(await readJson(req)));
  }

  if (req.method === 'PUT' && pathname.startsWith('/api/posts/')) {
    const body = await readJson(req);
    if (typeof body.body !== 'string') throw new Error('缺少 body');
    return send(res, 200, writePost(postNameFromPath(pathname), body.body));
  }

  if (req.method === 'POST' && pathname === '/api/rename') {
    const body = await readJson(req);
    return send(res, 200, renamePost(safeName(body.from), safeName(body.to)));
  }

  if (req.method === 'POST' && pathname === '/api/reorder') {
    const body = await readJson(req);
    return send(res, 200, reorderPosts(body.order || []));
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/posts/')) {
    return send(res, 200, deletePost(postNameFromPath(pathname)));
  }

  if (req.method === 'POST' && pathname === '/api/build') {
    return send(res, 200, buildSite());
  }

  if (req.method === 'GET' && pathname === '/api/push-status') {
    return send(res, 200, await getPushStatus());
  }

  if (req.method === 'GET' && pathname === '/api/dev/reload') {
    if (!DEV) return send(res, 404, { error: 'Not found' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.write(': ok\n\n');
    reloadClients.add(res);
    req.on('close', () => reloadClients.delete(res));
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/push') {
    const body = await readJson(req);
    return send(res, 200, await pushToRemote(body.message));
  }

  return false;
}

function handleStatic(req, res, pathname) {
  if (req.method !== 'GET') return false;

  if (pathname === '/' || pathname === '/admin' || pathname === '/admin/') {
    serveStatic(res, path.join(ADMIN_DIR, 'index.html'));
    return true;
  }

  if (pathname.startsWith('/libs/')) {
    const local = resolveInside(LIBS_DIR, [pathname.slice('/libs/'.length)]);
    serveStatic(res, local);
    return true;
  }

  if (pathname.startsWith('/admin/')) {
    const local = resolveInside(ADMIN_DIR, [pathname.slice('/admin/'.length)]);
    serveStatic(res, local);
    return true;
  }

  const local = resolveInside(ADMIN_DIR, [pathname.replace(/^\//, '')]);
  if (local && fs.existsSync(local)) {
    serveStatic(res, local);
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;

  try {
    if (pathname.startsWith('/api/')) {
      const done = await handleApi(req, res, pathname);
      if (done !== false) return;
    }
    if (handleStatic(req, res, pathname)) return;
    send(res, 404, { error: 'Not found' });
  } catch (err) {
    send(res, 400, { error: err.message || String(err) });
  }
});

watchDevFiles();
server.listen(PORT, () => {
  console.log(`[blog] admin http://localhost:${PORT}`);
  console.log(`[blog] posts  ${path.join(ROOT, 'posts')}`);
  if (DEV) console.log('[blog] DEV live reload on');
});
