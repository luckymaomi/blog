const listEl = document.getElementById('post-list');
const emptyEl = document.getElementById('empty');
const shellEl = document.getElementById('editor-shell');
const editor = document.getElementById('editor');
const preview = document.getElementById('preview');
const liveTitle = document.getElementById('live-title');
const liveFile = document.getElementById('live-file');
const editState = document.getElementById('edit-state');
const btnNew = document.getElementById('btn-new');
const btnPush = document.getElementById('btn-push');
const pushRemote = document.getElementById('push-remote');
const pushBranch = document.getElementById('push-branch');
const pushCommit = document.getElementById('push-commit');
const pushAt = document.getElementById('push-at');

let posts = [];
let current = null;
let dirty = false;
let saveTimer = null;
let previewTimer = null;
let saveGeneration = 0;
let lastSavedBody = '';
let dragFrom = null;

const ICON_EDIT =
  '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M4 17.3V20h2.7l10-10.1-2.7-2.7L4 17.3zM19.8 7.9c.3-.3.3-.8 0-1.1l-2.6-2.6a.8.8 0 0 0-1.1 0l-1.5 1.5 3.7 3.7 1.5-1.5z"/></svg>';
const ICON_DEL =
  '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v9h-2V9zm4 0h2v9h-2V9zM7 9h2v9H7V9zm-1 12h12a1 1 0 0 0 1-1V8H5v12a1 1 0 0 0 1 1z"/></svg>';

function setState(text, kind = '') {
  if (!editState) return;
  editState.textContent = text;
  editState.className = `edit-state ${kind}`.trim();
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败 ${res.status}`);
  return data;
}

function extractTitle(body) {
  const lines = String(body || '').split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const h1 = t.match(/^#\s+(.+)$/);
    return (h1 ? h1[1] : t.replace(/^#+\s*/, '')).slice(0, 80);
  }
  return '未命名';
}

function groupPosts(items) {
  const map = new Map();
  for (const p of items) {
    const list = map.get(p.year) || [];
    list.push(p);
    map.set(p.year, list);
  }
  return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

function formatPushTime(iso) {
  if (!iso) return '尚未推送';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function refreshPushMeta() {
  try {
    const data = await api('/api/push-status');
    pushRemote.textContent = data.remote || '未配置';
    pushBranch.textContent = data.branch || '未配置';
    pushCommit.textContent = data.commit || '—';
    pushAt.textContent = formatPushTime(data.at);
  } catch {
    pushRemote.textContent = '读取失败';
  }
}

async function renameFile(post) {
  const next = prompt(
    '文件名（与正文标题无关，格式 YYYY-MM-DD-名称.md）',
    post.filename,
  );
  if (next == null) return;
  const name = next.trim();
  if (!name || name === post.filename) return;
  try {
    saveGeneration += 1;
    const updated = await api('/api/rename', {
      method: 'POST',
      body: JSON.stringify({ from: post.filename, to: name }),
    });
    if (current === post.filename) {
      current = updated.filename;
      liveFile.textContent = updated.filename;
    }
    await refreshList(current);
  } catch (e) {
    alert(e.message);
  }
}

async function deletePost(filename, title) {
  const label = title || filename;
  if (!confirm(`确认删除「${label}」？\n删除后无法恢复。`)) return;
  try {
    await api(`/api/posts/${encodeURIComponent(filename)}`, { method: 'DELETE' });
    if (current === filename) {
      current = null;
      dirty = false;
      editor.value = '';
      preview.innerHTML = '';
      liveTitle.textContent = '';
      liveFile.textContent = '';
      shellEl.classList.add('hidden');
      emptyEl.classList.remove('hidden');
    }
    await refreshList();
  } catch (e) {
    setState(e.message, 'error');
  }
}

function renderList() {
  listEl.innerHTML = '';
  const groups = groupPosts(posts);
  if (!groups.length) {
    const tip = document.createElement('p');
    tip.className = 'muted-tip';
    tip.textContent = '还没有文章';
    listEl.appendChild(tip);
    return;
  }

  for (const [year, items] of groups) {
    const label = document.createElement('div');
    label.className = 'year-label';
    label.textContent = year;
    listEl.appendChild(label);

    for (const post of items) {
      const row = document.createElement('div');
      row.className = `post-row${current === post.filename ? ' active' : ''}`;
      row.draggable = true;
      row.dataset.filename = post.filename;

      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'icon-btn icon-edit';
      edit.title = '编辑文件名';
      edit.setAttribute('aria-label', `编辑文件名 ${post.filename}`);
      edit.innerHTML = ICON_EDIT;
      edit.addEventListener('click', (e) => {
        e.stopPropagation();
        renameFile(post);
      });

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'icon-btn icon-del';
      del.title = '删除';
      del.setAttribute('aria-label', `删除 ${post.title}`);
      del.innerHTML = ICON_DEL;
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        deletePost(post.filename, post.title);
      });

      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'post-main';
      main.innerHTML = '<span class="t"></span><span class="f"></span><span class="d"></span>';
      main.querySelector('.t').textContent = post.title;
      main.querySelector('.f').textContent = post.filename;
      main.querySelector('.d').textContent = post.date;
      main.addEventListener('click', () => openPost(post.filename));

      row.addEventListener('dragstart', (e) => {
        if (e.target.closest('.icon-btn')) {
          e.preventDefault();
          return;
        }
        dragFrom = post.filename;
        row.classList.add('dragging');
      });
      row.addEventListener('dragend', () => {
        dragFrom = null;
        row.classList.remove('dragging');
      });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        row.classList.add('drag-over');
      });
      row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
      row.addEventListener('drop', async (e) => {
        e.preventDefault();
        row.classList.remove('drag-over');
        const to = post.filename;
        if (!dragFrom || dragFrom === to) return;
        const order = posts.map((p) => p.filename);
        const fromIdx = order.indexOf(dragFrom);
        const toIdx = order.indexOf(to);
        if (fromIdx < 0 || toIdx < 0) return;
        order.splice(fromIdx, 1);
        order.splice(toIdx, 0, dragFrom);
        try {
          posts = await api('/api/reorder', {
            method: 'POST',
            body: JSON.stringify({ order }),
          });
          renderList();
          setState('已排序', 'saved');
        } catch (err) {
          setState(err.message, 'error');
        }
      });

      row.appendChild(edit);
      row.appendChild(main);
      row.appendChild(del);
      listEl.appendChild(row);
    }
  }
}

async function refreshList(selectFile) {
  posts = await api('/api/posts');
  if (selectFile) current = selectFile;
  renderList();
}

async function openPost(filename) {
  if (dirty && current) await saveNow();
  saveGeneration += 1;
  const post = await api(`/api/posts/${encodeURIComponent(filename)}`);
  current = post.filename;
  dirty = false;
  lastSavedBody = post.body;
  editor.value = post.body;
  liveTitle.textContent = post.title;
  liveFile.textContent = post.filename;
  preview.innerHTML = post.html;
  emptyEl.classList.add('hidden');
  shellEl.classList.remove('hidden');
  renderList();
  setState('已保存', 'saved');
}

function refreshPreview() {
  preview.innerHTML = marked.parse(editor.value || '');
  liveTitle.textContent = extractTitle(editor.value);
}

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    try {
      refreshPreview();
    } catch (e) {
      setState(e.message, 'error');
    }
  }, 180);
}

function scheduleSave() {
  dirty = true;
  setState('正在编辑', 'editing');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveNow().catch((e) => setState(e.message, 'error'));
  }, 3000);
}

async function saveNow() {
  if (!current) return;
  clearTimeout(saveTimer);
  const filename = current;
  const body = editor.value;
  const generation = ++saveGeneration;
  setState('正在保存', 'saving');

  await api(`/api/posts/${encodeURIComponent(filename)}`, {
    method: 'PUT',
    body: JSON.stringify({ body }),
  });

  // Ignore stale responses after switch/rename/newer save.
  if (generation !== saveGeneration || current !== filename) return;

  lastSavedBody = body;
  dirty = false;
  await refreshList(current);
  if (current !== filename) return;
  liveTitle.textContent = extractTitle(body);
  liveFile.textContent = current;
  setState('已保存', 'saved');
}

btnNew.addEventListener('click', async () => {
  try {
    const title = prompt('标题', '新文章');
    if (title == null) return;
    const post = await api('/api/posts', {
      method: 'POST',
      body: JSON.stringify({ title }),
    });
    await refreshList(post.filename);
    await openPost(post.filename);
  } catch (e) {
    setState(e.message, 'error');
  }
});

btnPush.addEventListener('click', async () => {
  try {
    if (dirty && current) await saveNow();
    setState('正在推送', 'saving');
    btnPush.disabled = true;
    await api('/api/push', {
      method: 'POST',
      body: JSON.stringify({ message: '更新文章' }),
    });
    setState('已推送', 'saved');
    await refreshPushMeta();
  } catch (e) {
    setState(e.message, 'error');
  } finally {
    btnPush.disabled = false;
  }
});

editor.addEventListener('input', () => {
  schedulePreview();
  scheduleSave();
});

window.addEventListener('beforeunload', (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

function connectDevReload() {
  if (!window.EventSource) return;
  let openedOnce = false;
  const es = new EventSource('/api/dev/reload');
  es.addEventListener('reload', () => {
    location.reload();
  });
  es.onopen = () => {
    if (openedOnce) location.reload();
    openedOnce = true;
  };
}

refreshList().catch((e) => setState(e.message, 'error'));
refreshPushMeta();
connectDevReload();
