const listEl = document.getElementById('post-list');
const emptyEl = document.getElementById('empty');
const shellEl = document.getElementById('editor-shell');
const editor = document.getElementById('editor');
const preview = document.getElementById('preview');
const filenameInput = document.getElementById('filename');
const liveTitle = document.getElementById('live-title');
const saveState = document.getElementById('save-state');
const btnNew = document.getElementById('btn-new');
const btnSave = document.getElementById('btn-save');
const btnDelete = document.getElementById('btn-delete');
const btnPush = document.getElementById('btn-push');

let posts = [];
let current = null;
let dirty = false;
let saveTimer = null;
let previewTimer = null;
let lastSavedBody = '';
let dragFrom = null;

function setState(text, kind = '') {
  saveState.textContent = text;
  saveState.className = `save-state ${kind}`.trim();
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
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `post-item${current === post.filename ? ' active' : ''}`;
      btn.draggable = true;
      btn.dataset.filename = post.filename;
      btn.innerHTML = `<span class="t"></span><span class="d"></span>`;
      btn.querySelector('.t').textContent = post.title;
      btn.querySelector('.d').textContent = post.date;

      btn.addEventListener('click', () => openPost(post.filename));
      btn.addEventListener('dragstart', () => {
        dragFrom = post.filename;
        btn.classList.add('dragging');
      });
      btn.addEventListener('dragend', () => {
        dragFrom = null;
        btn.classList.remove('dragging');
      });
      btn.addEventListener('dragover', (e) => {
        e.preventDefault();
        btn.classList.add('drag-over');
      });
      btn.addEventListener('dragleave', () => btn.classList.remove('drag-over'));
      btn.addEventListener('drop', async (e) => {
        e.preventDefault();
        btn.classList.remove('drag-over');
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

      listEl.appendChild(btn);
    }
  }
}

async function refreshList(selectFile) {
  posts = await api('/api/posts');
  if (selectFile) current = selectFile;
  renderList();
}

async function openPost(filename) {
  if (dirty && current) await saveNow(true);
  const post = await api(`/api/posts/${encodeURIComponent(filename)}`);
  current = post.filename;
  dirty = false;
  lastSavedBody = post.body;
  filenameInput.value = post.filename;
  editor.value = post.body;
  liveTitle.textContent = post.title;
  preview.innerHTML = post.html;
  emptyEl.classList.add('hidden');
  shellEl.classList.remove('hidden');
  renderList();
  setState('已同步', 'saved');
}

async function refreshPreview() {
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
  setState('待保存…', 'saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveNow().catch((e) => setState(e.message, 'error'));
  }, 3000);
}

async function saveNow() {
  if (!current) return;
  clearTimeout(saveTimer);
  const body = editor.value;
  const nextName = filenameInput.value.trim();
  setState('保存中…', 'saving');

  if (nextName && nextName !== current) {
    await api('/api/rename', {
      method: 'POST',
      body: JSON.stringify({ from: current, to: nextName }),
    });
    current = nextName;
  }

  await api(`/api/posts/${encodeURIComponent(current)}`, {
    method: 'PUT',
    body: JSON.stringify({ body }),
  });
  lastSavedBody = body;
  dirty = false;
  await refreshList(current);
  liveTitle.textContent = extractTitle(body);
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

btnSave.addEventListener('click', () => {
  saveNow().catch((e) => setState(e.message, 'error'));
});

btnDelete.addEventListener('click', async () => {
  if (!current) return;
  if (!confirm(`删除 ${current}？`)) return;
  try {
    await api(`/api/posts/${encodeURIComponent(current)}`, { method: 'DELETE' });
    current = null;
    dirty = false;
    editor.value = '';
    preview.innerHTML = '';
    shellEl.classList.add('hidden');
    emptyEl.classList.remove('hidden');
    await refreshList();
    setState('已删除', 'saved');
  } catch (e) {
    setState(e.message, 'error');
  }
});

btnPush.addEventListener('click', async () => {
  try {
    if (dirty && current) await saveNow();
    setState('推送中…', 'saving');
    btnPush.disabled = true;
    const result = await api('/api/push', {
      method: 'POST',
      body: JSON.stringify({ message: '更新文章' }),
    });
    setState(result.committed ? '已推送' : '已推送（无新提交）', 'saved');
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

filenameInput.addEventListener('change', () => {
  dirty = true;
  scheduleSave();
});

window.addEventListener('beforeunload', (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

refreshList().catch((e) => setState(e.message, 'error'));
