import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  ROOT,
  createPost,
  deletePost,
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
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function safeName(name) {
  if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
    throw new Error('非法文件名');
  }
  return name;
}

function contentType(file) {
  const ext = path.extname(file);
  return (
    {
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
    }[ext] || 'application/octet-stream'
  );
}

function serveStatic(res, filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
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

async function pushToRemote(message) {
  const cfg = loadConfig();
  const remoteUrl = cfg.push?.remote;
  const branch = cfg.push?.branch;
  if (!remoteUrl || !branch) {
    throw new Error('推送未配置：请在 config.json 填写 push.remote 与 push.branch');
  }

  buildSite();

  const identity = {
    GIT_AUTHOR_NAME: 'talk',
    GIT_AUTHOR_EMAIL: 'talk@users.noreply.github.com',
    GIT_COMMITTER_NAME: 'talk',
    GIT_COMMITTER_EMAIL: 'talk@users.noreply.github.com',
  };

  try {
    await git(['remote', 'get-url', 'origin']);
    await git(['remote', 'set-url', 'origin', remoteUrl]);
  } catch {
    await git(['remote', 'add', 'origin', remoteUrl]);
  }

  await git(['add', '-A']);
  const status = await git(['status', '--porcelain']);
  if (status) {
    await git(['commit', '-m', message || '更新文章'], identity);
  }

  await git(['push', '-u', 'origin', `HEAD:${branch}`]);
  return {
    ok: true,
    branch,
    remote: remoteUrl,
    committed: Boolean(status),
    pages: 'https://luckymaomi.github.io/talk/',
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const { pathname } = url;

  try {
    if (req.method === 'GET' && pathname === '/api/config') {
      const cfg = loadConfig();
      return send(res, 200, {
        site: cfg.site,
        github: cfg.github,
        push: cfg.push,
        pushConfigured: Boolean(cfg.push?.remote && cfg.push?.branch),
      });
    }

    if (req.method === 'GET' && pathname === '/api/posts') {
      return send(
        res,
        200,
        listPosts().map(({ body, ...rest }) => rest),
      );
    }

    if (req.method === 'GET' && pathname.startsWith('/api/posts/')) {
      const name = safeName(decodeURIComponent(pathname.slice('/api/posts/'.length)));
      return send(res, 200, readPost(name));
    }

    if (req.method === 'POST' && pathname === '/api/posts') {
      const body = await readJson(req);
      return send(res, 200, createPost(body));
    }

    if (req.method === 'PUT' && pathname.startsWith('/api/posts/')) {
      const name = safeName(decodeURIComponent(pathname.slice('/api/posts/'.length)));
      const body = await readJson(req);
      if (typeof body.body !== 'string') throw new Error('缺少 body');
      return send(res, 200, writePost(name, body.body));
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
      const name = safeName(decodeURIComponent(pathname.slice('/api/posts/'.length)));
      return send(res, 200, deletePost(name));
    }

    if (req.method === 'POST' && pathname === '/api/build') {
      const result = buildSite();
      return send(res, 200, result);
    }

    if (req.method === 'POST' && pathname === '/api/push') {
      const body = await readJson(req);
      const result = await pushToRemote(body.message);
      return send(res, 200, result);
    }

    if (req.method === 'GET' && (pathname === '/' || pathname === '/admin' || pathname === '/admin/')) {
      return serveStatic(res, path.join(ADMIN_DIR, 'index.html'));
    }

    if (req.method === 'GET' && pathname.startsWith('/libs/')) {
      const local = path.join(LIBS_DIR, pathname.slice('/libs/'.length));
      if (local.startsWith(LIBS_DIR)) return serveStatic(res, local);
    }

    if (req.method === 'GET' && pathname.startsWith('/admin/')) {
      return serveStatic(res, path.join(ADMIN_DIR, pathname.slice('/admin/'.length)));
    }

    if (req.method === 'GET') {
      const local = path.join(ADMIN_DIR, pathname.replace(/^\//, ''));
      if (local.startsWith(ADMIN_DIR) && fs.existsSync(local)) {
        return serveStatic(res, local);
      }
    }

    send(res, 404, { error: 'Not found' });
  } catch (err) {
    send(res, 400, { error: err.message || String(err) });
  }
});

server.listen(PORT, () => {
  console.log(`[talk] admin http://localhost:${PORT}`);
  console.log(`[talk] posts  ${path.join(ROOT, 'posts')}`);
});
