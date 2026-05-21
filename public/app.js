let parseResult = null;
const pollingMap = {};
let lbImages = [];
let lbIndex = 0;
let currentToken = null;
let logAutoRefreshTimer = null;

function toast(msg, type) {
  const area = document.getElementById('toastArea');
  const el = document.createElement('div');
  el.className = 'toast ' + (type || 'info');
  el.textContent = msg;
  area.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toastIn .25s reverse forwards';
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 250);
  }, 3500);
}

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

function switchPage(name) {
  if (logAutoRefreshTimer) {
    clearInterval(logAutoRefreshTimer);
    logAutoRefreshTimer = null;
    const btn = document.getElementById('logAutoRefreshBtn');
    if (btn) btn.innerHTML = '&#9654; 自动刷新';
  }

  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navItem = document.querySelector(`.nav-item[data-page="${name}"]`);
  if (navItem) navItem.classList.add('active');

  document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
  const section = document.getElementById('page-' + name);
  if (section) section.classList.add('active');

  if (name === 'trackers') loadTrackerStatus();
  if (name === 'aria2') loadAria2Config();
  if (name === 'logs') { loadLogs(); loadLogFiles(); }
  if (name === 'about') loadAboutPage();
}

function fmtSize(b) {
  if (!b) return '0 B';
  const u = ['B','KB','MB','GB','TB'];
  const i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), u.length - 1);
  return (b / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + u[i];
}

function handleFileSelect(event) {
  const file = event.target.files[0];
  if (file) document.getElementById('selectedFileName').textContent = file.name;
}

async function doParse() {
  const btn = document.getElementById('parseBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>解析中...';
  hide(document.getElementById('fileCard'));
  hide(document.getElementById('configCard'));
  hide(document.getElementById('resultCard'));
  parseResult = null;
  currentToken = null;

  try {
    const fileInput = document.getElementById('torrentFile');
    const file = fileInput.files[0];
    const magnetUri = document.getElementById('magnetInput').value.trim();

    if (file) {
      const formData = new FormData();
      formData.append('torrent', file);
      const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData });
      if (!uploadRes.ok) {
        const err = await uploadRes.json();
        throw new Error(err.error || '上传失败');
      }
      const uploadData = await uploadRes.json();
      currentToken = uploadData.token;

      var parseRes = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: currentToken })
      });
    } else if (magnetUri) {
      if (!magnetUri.startsWith('magnet:')) throw new Error('无效的磁力链接格式');
      var parseRes = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ magnetUri })
      });
    } else {
      toast('请输入磁力链接或选择种子文件', 'warning');
      return;
    }

    if (!parseRes.ok) {
      const err = await parseRes.json();
      throw new Error(err.error || '解析失败');
    }
    const d = await parseRes.json();
    parseResult = d;
    renderFiles(d);
    toast('解析成功：' + d.name, 'success');
    switchPage('main');
  } catch (e) {
    toast(e.message || '解析失败', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '解析';
  }
}

function renderFiles(data) {
  document.getElementById('torrentName').textContent = data.name;
  const tbody = document.getElementById('fileTableBody');
  tbody.innerHTML = '';
  data.files.forEach((f, i) => {
    const tr = document.createElement('tr');
    tr.className = f.isVideo ? 'video-row' : 'non-video';
    const td0 = document.createElement('td');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.dataset.idx = i;
    if (!f.isVideo) cb.disabled = true;
    cb.addEventListener('change', onCheckChange);
    td0.appendChild(cb);
    const td1 = document.createElement('td');
    td1.style.wordBreak = 'break-all';
    td1.textContent = f.name;
    const td2 = document.createElement('td');
    td2.textContent = fmtSize(f.size);
    const td3 = document.createElement('td');
    const tag = document.createElement('span');
    tag.className = 'tag ' + (f.isVideo ? 'tag-video' : 'tag-other');
    tag.textContent = f.isVideo ? '视频' : '其他';
    td3.appendChild(tag);
    tr.append(td0, td1, td2, td3);
    tbody.appendChild(tr);
  });
  show(document.getElementById('fileCard'));
}

function onCheckChange() {
  const checked = document.querySelectorAll('#fileTableBody input[type="checkbox"]:checked:not(:disabled)');
  checked.length ? show(document.getElementById('configCard')) : hide(document.getElementById('configCard'));
}

function selectVideos() {
  if (!parseResult) return;
  document.querySelectorAll('#fileTableBody input[type="checkbox"]:not(:disabled)').forEach(c => c.checked = true);
  onCheckChange();
}

function deselectAll() {
  if (!parseResult) return;
  document.querySelectorAll('#fileTableBody input[type="checkbox"]').forEach(c => c.checked = false);
  onCheckChange();
}

function doPreview() {
  if (!parseResult) return;
  const count = Math.min(20, Math.max(1, parseInt(document.getElementById('frameCount').value, 10) || 6));
  document.getElementById('frameCount').value = count;
  const mode = document.getElementById('captureMode').value;
  const uri = document.getElementById('magnetInput').value.trim();
  const cbs = document.querySelectorAll('#fileTableBody input[type="checkbox"]:checked');
  const files = [];
  cbs.forEach(c => files.push(parseResult.files[parseInt(c.dataset.idx, 10)]));
  if (!files.length) { toast('请至少选择一个视频', 'warning'); return; }
  const btn = document.getElementById('previewBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>提交中...';
  hide(document.getElementById('resultCard'));
  const list = document.getElementById('previewList');
  list.innerHTML = '';
  show(document.getElementById('resultCard'));
  files.forEach(f => list.appendChild(buildPreviewCard(currentToken, uri, f, count, mode)));
  btn.disabled = false;
  btn.textContent = '生成预览';
}

function buildPreviewCard(token, uri, file, count, mode) {
  const item = document.createElement('div');
  item.className = 'preview-item';
  const title = document.createElement('div');
  title.className = 'preview-item-title';
  title.textContent = file.name;

  const pr = document.createElement('div');
  pr.className = 'prog-row';
  const lbl = document.createElement('div');
  lbl.className = 'prog-label';
  lbl.textContent = '等待中...';
  const trk = document.createElement('div');
  trk.className = 'prog-track';
  const fill = document.createElement('div');
  fill.className = 'prog-fill';
  fill.style.width = '0%';
  trk.appendChild(fill);
  pr.append(lbl, trk);

  const grid = document.createElement('div');
  grid.className = 'frames-grid';
  item.append(title, pr, grid);

  const body = { fileIndex: file.index, count, mode };
  if (token) body.token = token;
  else body.magnetUri = uri;

  fetch('/api/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
    .then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.error); }); return r.json(); })
    .then(d => startPoll(d.taskId, lbl, fill, grid, count))
    .catch(e => { lbl.textContent = '错误：' + e.message; lbl.style.color = '#b91c1c'; toast(file.name + '：' + e.message, 'error'); });

  return item;
}

function startPoll(taskId, lbl, fill, grid, total) {
  const t = setInterval(() => {
    fetch('/api/status/' + taskId)
      .then(r => { if (!r.ok) throw new Error('查询失败'); return r.json(); })
      .then(d => {
        if (d.error) { clearInterval(t); delete pollingMap[taskId]; lbl.textContent = '错误：' + d.error; lbl.style.color = '#b91c1c'; return; }
        const pct = total > 0 ? Math.round((d.completed / total) * 100) : 0;
        fill.style.width = pct + '%';
        lbl.textContent = '进度：' + (d.completed || 0) + ' / ' + total + '（' + pct + '%）';
        if (d.frames) {
          d.frames.forEach(n => {
            const idx = n.replace('frame_', '').replace('.jpg', '');
            const id = 'fi-' + taskId + '-' + idx;
            if (!document.getElementById(id)) {
              const img = document.createElement('img');
              img.id = id; img.className = 'frame-thumb';
              img.src = '/api/frames/' + taskId + '/' + idx;
              img.alt = '帧 ' + idx; img.loading = 'lazy';
              img.onclick = function () { openLb(this.src); };
              grid.appendChild(img);
            }
          });
        }
        if (d.status === 'completed') { clearInterval(t); delete pollingMap[taskId]; lbl.textContent = '完成！' + (d.completed || 0) + ' 帧'; lbl.style.color = '#15803d'; toast('预览完成', 'success'); }
        else if (d.status === 'failed') { clearInterval(t); delete pollingMap[taskId]; lbl.textContent = '失败'; lbl.style.color = '#b91c1c'; }
      })
      .catch(() => { clearInterval(t); delete pollingMap[taskId]; lbl.textContent = '查询失败'; lbl.style.color = '#b91c1c'; });
  }, 2000);
  pollingMap[taskId] = t;
}

function loadTrackerStatus() {
  fetch('/api/trackers').then(r => r.json()).then(d => {
    document.getElementById('trackerCount').textContent = d.count;
    document.getElementById('trackerSource').textContent = d.source === 'remote' ? '远程列表' : '内置默认';
    document.getElementById('trackerLastUpdated').textContent = d.lastUpdated ? new Date(d.lastUpdated).toLocaleString('zh-CN') : '从未更新';
    const sc = document.getElementById('trackerScroll');
    sc.innerHTML = '';
    if (!d.trackers.length) { sc.innerHTML = '<div class="empty-state">暂无 Tracker 数据</div>'; return; }
    d.trackers.forEach(t => {
      const div = document.createElement('div');
      div.className = 'tracker-item';
      div.textContent = t;
      sc.appendChild(div);
    });
  });
}

function doUpdateTrackers() {
  const btn = document.getElementById('updateTrackersBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>更新中...';
  fetch('/api/trackers/update', { method: 'POST' }).then(r => r.json())
    .then(d => { if (d.success) { toast('Tracker 更新成功，共 ' + d.count + ' 个', 'success'); loadTrackerStatus(); } else { toast('更新失败：' + (d.error || ''), 'error'); } })
    .catch(e => toast('更新失败：' + e.message, 'error'))
    .finally(() => { btn.disabled = false; btn.textContent = '从远程更新'; });
}

function doResetTrackers() {
  fetch('/api/trackers/reset', { method: 'POST' }).then(r => r.json())
    .then(d => { if (d.success) { toast('已恢复默认 Tracker', 'success'); loadTrackerStatus(); } })
    .catch(e => toast('重置失败', 'error'));
}

function loadAria2Config() {
  fetch('/api/aria2/config').then(r => r.json()).then(d => {
    document.getElementById('aria2Host').value = d.host || 'localhost';
    document.getElementById('aria2Port').value = d.port || 6800;
    document.getElementById('aria2Token').value = d.token || '';
    document.getElementById('aria2Dir').value = d.dir || '';
  });
}

function doSaveAria2() {
  const cfg = {
    host: document.getElementById('aria2Host').value.trim() || 'localhost',
    port: parseInt(document.getElementById('aria2Port').value, 10) || 6800,
    token: document.getElementById('aria2Token').value.trim(),
    dir: document.getElementById('aria2Dir').value.trim()
  };
  fetch('/api/aria2/config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg)
  }).then(r => r.json())
    .then(d => toast(d.success ? 'Aria2 配置已保存' : '保存失败', d.success ? 'success' : 'error'))
    .catch(() => toast('保存失败', 'error'));
}

function doTestAria2() {
  const btn = document.getElementById('testAria2Btn');
  const el = document.getElementById('aria2TestResult');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>测试...';
  el.textContent = ''; el.className = 'test-result';
  const cfg = {
    host: document.getElementById('aria2Host').value.trim() || 'localhost',
    port: parseInt(document.getElementById('aria2Port').value, 10) || 6800,
    token: document.getElementById('aria2Token').value.trim()
  };
  fetch('/api/aria2/test', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg)
  }).then(r => r.json())
    .then(d => {
      if (d.success) { el.textContent = '连接成功！Aria2 版本：' + (d.version || '?'); el.className = 'test-result ok'; toast('Aria2 连接成功', 'success'); }
      else { el.textContent = '连接失败：' + (d.error || '未知错误'); el.className = 'test-result fail'; toast('Aria2 连接失败', 'error'); }
    })
    .catch(e => { el.textContent = '请求失败：' + e.message; el.className = 'test-result fail'; })
    .finally(() => { btn.disabled = false; btn.textContent = '测试连接'; });
}

function doAria2Push() {
  if (!parseResult) { toast('请先在主页解析磁力链接', 'warning'); return; }
  const uri = document.getElementById('magnetInput').value.trim();
  if (!uri) { toast('磁力链接为空', 'warning'); return; }
  const btn = document.getElementById('aria2PushBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner spinner-white"></span>推送...';
  fetch('/api/aria2/push', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ magnetUri: uri })
  }).then(r => r.json())
    .then(d => { if (d.success) { toast('已推送到 Aria2（GID: ' + d.gid + '）', 'success'); } else { toast('推送失败：' + (d.error || ''), 'error'); } })
    .catch(e => toast('推送失败：' + e.message, 'error'))
    .finally(() => { btn.disabled = false; btn.innerHTML = '\u25B6 推送当前链接'; });
}

function lbCloseOnBg(e) { if (e.target === document.getElementById('lbOverlay')) lbClose(); }
function lbClose() { document.getElementById('lbOverlay').classList.remove('active'); document.body.style.overflow = ''; }
function lbCollect() { lbImages = []; document.querySelectorAll('.frame-thumb').forEach(i => lbImages.push(i.src)); }
function openLb(src) { lbCollect(); lbIndex = lbImages.indexOf(src); if (lbIndex < 0) lbIndex = 0; document.getElementById('lbImg').src = src; updateLbCounter(); document.getElementById('lbOverlay').classList.add('active'); document.body.style.overflow = 'hidden'; }
function lbNav(d) { if (!lbImages.length) return; lbIndex = (lbIndex + d + lbImages.length) % lbImages.length; document.getElementById('lbImg').src = lbImages[lbIndex]; updateLbCounter(); }
function updateLbCounter() { const el = document.getElementById('lbCounter'); el.textContent = lbImages.length > 1 ? (lbIndex + 1) + ' / ' + lbImages.length : ''; }

document.addEventListener('keydown', e => {
  const lb = document.getElementById('lbOverlay');
  if (!lb.classList.contains('active')) return;
  if (e.key === 'Escape') lbClose();
  if (e.key === 'ArrowLeft') lbNav(-1);
  if (e.key === 'ArrowRight') lbNav(1);
});

function loadLogs() {
  const level = document.getElementById('logLevelFilter').value;
  const search = document.getElementById('logSearchInput').value.trim();
  const params = new URLSearchParams({ limit: 200 });
  if (level) params.set('level', level);
  if (search) params.set('search', search);

  fetch('/api/logs?' + params.toString())
    .then(r => r.json())
    .then(d => {
      const container = document.getElementById('logContainer');
      if (!d.items || !d.items.length) {
        container.innerHTML = '<div class="log-empty">暂无日志</div>';
        return;
      }
      container.innerHTML = '';
      d.items.forEach(entry => {
        const div = document.createElement('div');
        div.className = 'log-entry';
        const time = document.createElement('span');
        time.className = 'log-time';
        time.textContent = entry.timestamp.slice(11, 19);
        const lvl = document.createElement('span');
        lvl.className = 'log-level LEVEL_' + entry.level.toUpperCase();
        lvl.textContent = entry.level.toUpperCase();
        const msg = document.createElement('span');
        msg.className = 'log-msg';
        msg.textContent = entry.message;
        if (entry.meta) msg.textContent += ' ' + JSON.stringify(entry.meta);
        div.append(time, lvl, msg);
        container.appendChild(div);
      });
      container.scrollTop = 0;
    })
    .catch(() => { document.getElementById('logContainer').innerHTML = '<div class="log-empty">加载失败</div>'; });
}

function toggleAutoRefresh() {
  const btn = document.getElementById('logAutoRefreshBtn');
  if (logAutoRefreshTimer) {
    clearInterval(logAutoRefreshTimer);
    logAutoRefreshTimer = null;
    btn.innerHTML = '&#9654; 自动刷新';
  } else {
    loadLogs();
    logAutoRefreshTimer = setInterval(loadLogs, 3000);
    btn.innerHTML = '&#9646; 停止刷新';
  }
}

function clearLogFilter() {
  document.getElementById('logLevelFilter').value = '';
  document.getElementById('logSearchInput').value = '';
  loadLogs();
}

function loadLogFiles() {
  fetch('/api/logs/files').then(r => r.json()).then(files => {
    const container = document.getElementById('logFilesContainer');
    if (!files || !files.length) {
      container.innerHTML = '<div class="empty-state">暂无日志文件</div>';
      return;
    }
    container.innerHTML = '';
    files.forEach(f => {
      const div = document.createElement('div');
      div.className = 'log-file-item';
      const info = document.createElement('div');
      info.style.flex = '1';
      const nameSpan = document.createElement('div');
      nameSpan.style.fontWeight = '500';
      nameSpan.style.fontSize = '.875rem';
      nameSpan.textContent = f.name;
      const metaSpan = document.createElement('div');
      metaSpan.style.fontSize = '.75rem';
      metaSpan.style.color = 'var(--text-muted)';
      metaSpan.textContent = new Date(f.mtime).toLocaleString('zh-CN') + ' - ' + fmtSize(f.size);
      info.append(nameSpan, metaSpan);
      const btn = document.createElement('button');
      btn.className = 'win-btn win-btn-ghost win-btn-sm';
      btn.textContent = '查看';
      btn.onclick = () => openLogFile(f.name);
      div.append(info, btn);
      container.appendChild(div);
    });
  }).catch(() => { document.getElementById('logFilesContainer').innerHTML = '<div class="empty-state">加载失败</div>'; });
}

function openLogFile(filename) {
  document.getElementById('logFileModalTitle').textContent = filename;
  const contentEl = document.getElementById('logFileModalContent');
  contentEl.textContent = '加载中...';
  document.getElementById('logFileModal').style.display = 'flex';
  fetch('/api/logs/files/' + encodeURIComponent(filename))
    .then(r => { if (!r.ok) throw new Error('Not found'); return r.text(); })
    .then(content => { contentEl.textContent = content; })
    .catch(() => { contentEl.textContent = '加载失败'; });
}

function closeLogFileModal(e) {
  if (e && e.target !== document.getElementById('logFileModal')) return;
  document.getElementById('logFileModal').style.display = 'none';
}

function renderMarkdown(md) {
  const lines = md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .split('\n');
  const out = [];
  let inCodeBlock = false;
  let codeContent = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('```')) {
      if (inCodeBlock) {
        out.push('<pre><code>' + codeContent.join('\n') + '</code></pre>');
        codeContent = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeContent.push(escapeHtml(line));
      continue;
    }

    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('|---') || trimmed.startsWith('| ---')) continue;

    if (trimmed.startsWith('|')) {
      const cells = trimmed.split('|').slice(1, -1);
      out.push('<tr>' + cells.map(c => '<td>' + inlineFormat(c.trim()) + '</td>').join('') + '</tr>');
      continue;
    }

    const hMatch = trimmed.match(/^(#{1,3})\s/);
    if (hMatch) {
      const level = hMatch[1].length;
      out.push(`<h${level}>${inlineFormat(trimmed.slice(level).trim())}</h${level}>`);
      continue;
    }

    if (/^-{3,}$/.test(trimmed)) { out.push('<hr>'); continue; }
    if (/^[*\-+]\s/.test(trimmed)) { out.push('<li>' + inlineFormat(trimmed.replace(/^[*\-+]\s*/, '')) + '</li>'); continue; }

    out.push('<p>' + inlineFormat(trimmed) + '</p>');
  }

  if (inCodeBlock) out.push('<pre><code>' + codeContent.join('\n') + '</code></pre>');

  let result = out.join('\n');
  result = result.replace(/(<li>.*<\/li>\n?)+/g, m => '<ul>' + m + '</ul>');
  result = result.replace(/(<tr>.*<\/tr>\n?)+/g, m => '<table>' + m + '</table>');
  return result;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inlineFormat(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

function loadAboutPage() {
  const container = document.getElementById('aboutContent');
  if (!container) return;
  container.innerHTML = '<div class="empty-state">加载中...</div>';
  fetch('/api/about')
    .then(r => { if (!r.ok) throw new Error('加载失败'); return r.text(); })
    .then(md => { container.innerHTML = renderMarkdown(md); })
    .catch(e => { container.innerHTML = '<div class="empty-state">加载失败：' + e.message + '</div>'; });
}
