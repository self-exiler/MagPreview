import express from 'express';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import multer from 'multer';
import { addMagnet, addTorrentFile, isVideoFile, enforceMaxTorrents } from './torrentManager.js';
import { createTask, getTask, updateTask, removeTask } from './taskManager.js';
import { extractFrames } from './frameExtractor.js';
import { getTrackerStatus, updateTrackersFromRemote, resetToDefault } from './trackerList.js';
import { loadConfig as loadAria2Config, saveConfig as saveAria2Config, pushToAria2, testConnection as testAria2Connection } from './aria2Service.js';
import { initLogger, getLogs, getLogFiles, getLogFileContent } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const CONFIG_PATH = path.join(__dirname, 'config.json');
let PORT = 3000;
try {
  if (fs.existsSync(CONFIG_PATH)) {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    if (config.port && Number.isInteger(config.port)) PORT = config.port;
  }
} catch (e) {}

const TEMP_DIR = path.join(__dirname, '..', 'temp');
const UPLOAD_DIR = path.join(TEMP_DIR, 'uploads');

app.use(express.json());

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});

const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

const uploadedTorrents = new Map();

setInterval(() => {
  const now = Date.now();
  const MAX_AGE = 30 * 60 * 1000;
  for (const [token, data] of uploadedTorrents.entries()) {
    if (now - data.createdAt > MAX_AGE) {
      uploadedTorrents.delete(token);
      try { if (fs.existsSync(data.filePath)) fs.unlinkSync(data.filePath); } catch (e) {}
    }
  }
}, 5 * 60 * 1000);

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

setInterval(() => {
  const now = Date.now();
  const MAX_AGE = 30 * 60 * 1000;
  fs.readdir(TEMP_DIR, (err, files) => {
    if (err) return;
    for (const file of files) {
      if (file === 'uploads') continue;
      const filePath = path.join(TEMP_DIR, file);
      fs.stat(filePath, (err, stats) => {
        if (err) return;
        if (now - stats.mtimeMs > MAX_AGE)
          fs.rm(filePath, { recursive: true, force: true }, () => {});
      });
    }
  });
}, 10 * 60 * 1000);

async function resolveTorrent(magnetUri, token) {
  if (token) {
    const uploaded = uploadedTorrents.get(token);
    if (!uploaded) throw Object.assign(new Error('Uploaded file not found or expired'), { status: 404 });
    enforceMaxTorrents();
    return addTorrentFile(uploaded.filePath);
  }
  if (magnetUri) {
    if (!magnetUri.startsWith('magnet:'))
      throw Object.assign(new Error('Invalid magnet URI format'), { status: 400 });
    enforceMaxTorrents();
    return addMagnet(magnetUri);
  }
  throw Object.assign(new Error('magnetUri or token is required'), { status: 400 });
}

app.post('/api/upload', upload.single('torrent'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const token = uuidv4();
    uploadedTorrents.set(token, { filePath: req.file.path, createdAt: Date.now() });
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

app.post('/api/parse', async (req, res) => {
  try {
    const torrent = await resolveTorrent(req.body.magnetUri, req.body.token);
    const files = torrent.files.map((file, index) => ({
      name: file.name, size: file.length, isVideo: isVideoFile(file.name), index
    }));
    res.json({ infoHash: torrent.infoHash, name: torrent.name, files });
  } catch (err) {
    const status = err.status || (err.message && err.message.includes('timed out') ? 408 : 500);
    res.status(status).json({ error: err.message || 'Failed to parse' });
  }
});

app.post('/api/preview', async (req, res) => {
  try {
    const { fileIndex, count: rawCount, mode } = req.body;
    const torrent = await resolveTorrent(req.body.magnetUri, req.body.token);

    if (fileIndex === undefined || fileIndex === null || isNaN(Number(fileIndex)))
      return res.status(400).json({ error: 'Invalid fileIndex' });

    const count = Math.min(20, Math.max(1, rawCount || 6));
    const captureMode = mode === 'evenly' ? 'evenly' : 'random';
    const taskId = createTask(torrent.infoHash, Number(fileIndex), count);

    res.json({ taskId });

    const timeoutId = setTimeout(() => {
      const task = getTask(taskId);
      if (task && task.status === 'processing')
        updateTask(taskId, { status: 'failed', error: 'Task timed out after 300 seconds' });
    }, 300 * 1000);

    extractFrames(torrent, Number(fileIndex), count, {
      taskId,
      mode: captureMode,
      onProgress: (completed, total) => updateTask(taskId, { completed, total })
    })
      .then((framePaths) => {
        clearTimeout(timeoutId);
        const task = getTask(taskId);
        if (task && task.status === 'processing') {
          const frames = framePaths.map(p => path.basename(p));
          updateTask(taskId, { status: 'completed', frames, completed: frames.length, total: count });
        }
        setTimeout(() => removeTask(taskId), 5 * 60 * 1000);
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        updateTask(taskId, { status: 'failed', error: err.message || 'Frame extraction failed' });
        setTimeout(() => removeTask(taskId), 5 * 60 * 1000);
      });
  } catch (err) {
    const status = err.status || (err.message && err.message.includes('timed out') ? 408 : 500);
    res.status(status).json({ error: err.message || 'Failed to create preview task' });
  }
});

app.get('/api/status/:taskId', (req, res) => {
  const task = getTask(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

app.get('/api/frames/:taskId/:frameIndex', (req, res) => {
  const filePath = path.join(TEMP_DIR, req.params.taskId, `frame_${req.params.frameIndex}.jpg`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Frame not found' });
  res.contentType('image/jpeg');
  fs.createReadStream(filePath).pipe(res);
});

app.get('/api/trackers', (req, res) => {
  res.json(getTrackerStatus());
});

app.post('/api/trackers/update', async (req, res) => {
  try {
    const result = await updateTrackersFromRemote();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Failed to update trackers' });
  }
});

app.post('/api/trackers/reset', (req, res) => {
  res.json({ success: true, ...resetToDefault() });
});

app.get('/api/aria2/config', (req, res) => {
  res.json(loadAria2Config());
});

app.post('/api/aria2/config', (req, res) => {
  res.json({ success: true, config: saveAria2Config(req.body) });
});

app.post('/api/aria2/test', async (req, res) => {
  try {
    const result = await testAria2Connection(req.body);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Connection failed' });
  }
});

app.post('/api/aria2/push', async (req, res) => {
  try {
    const { magnetUri, dir } = req.body;
    if (!magnetUri || typeof magnetUri !== 'string' || !magnetUri.startsWith('magnet:'))
      return res.status(400).json({ error: 'Invalid or missing magnetUri' });
    const result = await pushToAria2(magnetUri, { dir });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Push to Aria2 failed' });
  }
});

initLogger();

app.get('/api/logs', (req, res) => {
  const { level, search, limit, offset } = req.query;
  res.json(getLogs({
    level: level || undefined,
    search: search || undefined,
    limit: limit ? parseInt(limit, 10) : 100,
    offset: offset ? parseInt(offset, 10) : 0
  }));
});

app.get('/api/logs/files', (req, res) => {
  res.json(getLogFiles());
});

let readmeCache = null;
let readmeMtime = null;

app.get('/api/about', (req, res) => {
  const readmePath = path.join(__dirname, '..', 'README.md');
  try {
    const mtime = fs.statSync(readmePath).mtimeMs;
    if (readmeCache === null || mtime !== readmeMtime) {
      readmeCache = fs.readFileSync(readmePath, 'utf-8');
      readmeMtime = mtime;
    }
    res.type('text/markdown').send(readmeCache);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/logs/files/:filename', (req, res) => {
  const content = getLogFileContent(req.params.filename);
  if (content === null) return res.status(404).json({ error: 'Log file not found' });
  res.type('text/plain').send(content);
});

app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h', etag: true }));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
