import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import ffprobePath from 'ffprobe-static';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { getServerPort } from './torrentManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath.path);

const TEMP_DIR = path.join(__dirname, '..', 'temp');
const CONCURRENCY = 3;

function getVideoDuration(httpUrl) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('getVideoDuration timeout')), 120000);
    ffmpeg.ffprobe(httpUrl, (err, metadata) => {
      clearTimeout(timeout);
      if (err) return reject(err);
      const duration = parseFloat(metadata.format.duration);
      if (isNaN(duration) || duration <= 0) return reject(new Error('Invalid video duration'));
      resolve(duration);
    });
  });
}

function extractSingleFrame(httpUrl, timestamp, outputPath) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('extractSingleFrame timeout')), 120000);
    ffmpeg(httpUrl)
      .seekInput(timestamp)
      .frames(1)
      .outputOptions('-q:v 2')
      .noAudio()
      .output(outputPath)
      .on('end', () => {
        clearTimeout(timeout);
        resolve(outputPath);
      })
      .on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      })
      .run();
  });
}

async function extractFrames(torrent, fileIndex, count, options = {}) {
  const { onProgress, taskId: providedTaskId } = options;
  const file = torrent.files[fileIndex];

  file.select();

  const port = getServerPort();
  if (!port) throw new Error('WebTorrent server is not ready');

  const normalizedPath = file.path.replace(/\\/g, '/');
  const encodedPath = normalizedPath.split('/').map(encodeURIComponent).join('/');
  const httpUrl = `http://localhost:${port}/webtorrent/${torrent.infoHash}/${encodedPath}`;

  const duration = await getVideoDuration(httpUrl);

  const mode = options.mode || 'random';
  const timestamps = [];
  if (mode === 'evenly') {
    for (let i = 0; i < count; i++) {
      timestamps.push(duration / (count + 1) * (i + 1));
    }
  } else {
    for (let i = 0; i < count; i++) {
      timestamps.push(Math.random() * duration);
    }
    timestamps.sort((a, b) => a - b);
  }

  const taskId = providedTaskId || uuidv4();
  const taskDir = path.join(TEMP_DIR, taskId);
  fs.mkdirSync(taskDir, { recursive: true });

  const total = timestamps.length;
  const framePaths = [];
  const failedFrames = [];
  let completed = 0;

  const jobs = timestamps.map((ts, i) => ({
    ts, i,
    outputPath: path.join(taskDir, `frame_${i}.jpg`)
  }));

  async function worker() {
    while (jobs.length > 0) {
      const job = jobs.shift();
      try {
        await extractSingleFrame(httpUrl, job.ts, job.outputPath);
        framePaths.push(job.outputPath);
      } catch (err) {
        failedFrames.push({ index: job.i, timestamp: job.ts, error: err.message });
      }
      completed++;
      if (onProgress) onProgress(completed, total, job.i);
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, total) }, () => worker());
  await Promise.all(workers);

  if (failedFrames.length > 0 && framePaths.length === 0) {
    throw new Error(`All ${total} frames failed: ${failedFrames[0].error}`);
  }

  return framePaths;
}

function cleanupTask(taskId) {
  const taskDir = path.join(TEMP_DIR, taskId);
  fs.rm(taskDir, { recursive: true, force: true }, () => {});
}

export {
  extractFrames,
  getVideoDuration,
  extractSingleFrame,
  cleanupTask,
};
