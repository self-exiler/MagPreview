import express from 'express';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import multer from 'multer';
import { addMagnet, addTorrentFile, isVideoFile } from './torrentManager.js';
import { createTask, getTask, updateTask, removeTask } from './taskManager.js';
import { extractFrames } from './frameExtractor.js';
import { getTrackerStatus, updateTrackersFromRemote, resetToDefault } from './trackerList.js';
import { loadConfig as loadAria2Config, saveConfig as saveAria2Config, pushToAria2, testConnection as testAria2Connection } from './aria2Service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 3000;

const TEMP_DIR = path.join(__dirname, '..', 'temp');
const UPLOAD_DIR = path.join(TEMP_DIR, 'uploads');

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    cb(null, uuidv4() + path.extname(file.originalname));
  }
});

const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }); // Limit to 10MB

// Store uploaded torrent file paths for a short time
const uploadedTorrents = new Map(); // key: token, value: { filePath, createdAt }

// Cleanup old uploaded files every 5 minutes
setInterval(() => {
  const now = Date.now();
  const MAX_AGE = 30 * 60 * 1000; // 30 minutes
  for (const [token, data] of uploadedTorrents.entries()) {
    if (now - data.createdAt > MAX_AGE) {
      uploadedTorrents.delete(token);
      try {
        if (fs.existsSync(data.filePath)) {
          fs.unlinkSync(data.filePath);
        }
      } catch (e) {
        // ignore cleanup errors
      }
    }
  }
}, 5 * 60 * 1000);

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

setInterval(() => {
  const now = Date.now();
  const MAX_AGE = 30 * 60 * 1000;

  fs.readdir(TEMP_DIR, (err, files) => {
    if (err) return;
    files.forEach((file) => {
      const filePath = path.join(TEMP_DIR, file);
      fs.stat(filePath, (err, stats) => {
        if (err) return;
        if (now - stats.mtimeMs > MAX_AGE) {
          fs.rm(filePath, { recursive: true, force: true }, () => {});
        }
      });
    });
  });
}, 10 * 60 * 1000);

// Upload torrent file
app.post('/api/upload', upload.single('torrent'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const token = uuidv4();
    uploadedTorrents.set(token, {
      filePath: req.file.path,
      createdAt: Date.now()
    });

    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

// Parse uploaded torrent file (by token) or magnet
app.post('/api/parse', async (req, res) => {
  try {
    let torrent;
    const { magnetUri, token } = req.body;

    if (token) {
      const uploaded = uploadedTorrents.get(token);
      if (!uploaded) {
        return res.status(404).json({ error: 'Uploaded file not found or expired' });
      }
      torrent = await addTorrentFile(uploaded.filePath);
    } else if (magnetUri) {
      if (!magnetUri.startsWith('magnet:')) {
        return res.status(400).json({ error: 'Invalid magnet URI format' });
      }
      torrent = await addMagnet(magnetUri);
    } else {
      return res.status(400).json({ error: 'magnetUri or token is required' });
    }

    const files = torrent.files.map((file, index) => ({
      name: file.name,
      size: file.length,
      isVideo: isVideoFile(file.name),
      index
    }));

    res.json({
      infoHash: torrent.infoHash,
      name: torrent.name,
      files
    });
  } catch (err) {
    if (err.message && err.message.includes('timed out')) {
      return res.status(408).json({ error: err.message });
    }
    res.status(500).json({ error: err.message || 'Failed to parse' });
  }
});

app.post('/api/preview', async (req, res) => {
  try {
    const { magnetUri, token, fileIndex, count: rawCount, mode } = req.body;

    let torrent;
    if (token) {
      const uploaded = uploadedTorrents.get(token);
      if (!uploaded) {
        return res.status(404).json({ error: 'Uploaded file not found or expired' });
      }
      torrent = await addTorrentFile(uploaded.filePath);
    } else if (magnetUri) {
      if (!magnetUri.startsWith('magnet:')) {
        return res.status(400).json({ error: 'Invalid magnet URI format' });
      }
      torrent = await addMagnet(magnetUri);
    } else {
      return res.status(400).json({ error: 'magnetUri or token is required' });
    }

    if (fileIndex === undefined || fileIndex === null || isNaN(Number(fileIndex))) {
      return res.status(400).json({ error: 'Invalid fileIndex' });
    }

    const count = Math.min(20, Math.max(1, rawCount || 6));
    const captureMode = (mode === 'evenly') ? 'evenly' : 'random';

    const taskId = createTask(torrent.infoHash, Number(fileIndex), count);
    updateTask(taskId, { status: 'processing', torrent });

    res.json({ taskId });

    const timeoutId = setTimeout(() => {
      const task = getTask(taskId);
      if (task && task.status === 'processing') {
        updateTask(taskId, { status: 'failed', error: 'Task timed out after 300 seconds' });
      }
    }, 300 * 1000);

    extractFrames(torrent, Number(fileIndex), count, {
      taskId,
      mode: captureMode,
      onProgress: (completed, total, frameIdx) => {
        const task = getTask(taskId);
        if (!task) return;
        const frameName = `frame_${frameIdx}.jpg`;
        if (!task.frames.includes(frameName)) {
          task.frames.push(frameName);
        }
        updateTask(taskId, { completed, total });
      }
    })
      .then((framePaths) => {
        clearTimeout(timeoutId);
        const task = getTask(taskId);
        if (task && task.status === 'processing') {
          const frames = framePaths.map((p) => path.basename(p));
          updateTask(taskId, { status: 'completed', frames, completed: frames.length, total: count });
        }
        setTimeout(() => {
          removeTask(taskId);
        }, 5 * 60 * 1000);
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        updateTask(taskId, { status: 'failed', error: err.message || 'Frame extraction failed' });
        setTimeout(() => {
          removeTask(taskId);
        }, 5 * 60 * 1000);
      });
  } catch (err) {
    if (err.message && err.message.includes('timed out')) {
      return res.status(408).json({ error: err.message });
    }
    res.status(500).json({ error: err.message || 'Failed to create preview task' });
  }
});

app.get('/api/status/:taskId', (req, res) => {
  const task = getTask(req.params.taskId);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  const { torrent, ...rest } = task;
  res.json(rest);
});

app.get('/api/frames/:taskId/:frameIndex', (req, res) => {
  const { taskId, frameIndex } = req.params;
  const filePath = path.join(TEMP_DIR, taskId, `frame_${frameIndex}.jpg`);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Frame not found' });
  }

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
  const result = resetToDefault();
  res.json({ success: true, ...result });
});

app.get('/api/aria2/config', (req, res) => {
  const config = loadAria2Config();
  res.json(config);
});

app.post('/api/aria2/config', (req, res) => {
  const config = saveAria2Config(req.body);
  res.json({ success: true, config });
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

    if (!magnetUri || typeof magnetUri !== 'string' || !magnetUri.startsWith('magnet:')) {
      return res.status(400).json({ error: 'Invalid or missing magnetUri' });
    }

    const result = await pushToAria2(magnetUri, { dir });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Push to Aria2 failed' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
