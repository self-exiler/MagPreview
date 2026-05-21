import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_DIR = path.join(__dirname, '..', 'data', 'logs');
const MAX_BUFFER = 500;
const MAX_LOG_AGE = 7 * 24 * 60 * 60 * 1000;
const MAX_FILE_SIZE = 10 * 1024 * 1024;

const levels = { error: 0, warn: 1, info: 2, debug: 3 };
const labels = { error: 'ERROR', warn: 'WARN', info: 'INFO', debug: 'DEBUG' };

let buffer = [];
let logStream = null;
let currentLogDate = null;

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function getLogDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getLogFile() {
  return path.join(LOG_DIR, `${getLogDate()}.log`);
}

function rotateStream() {
  if (logStream) {
    try { logStream.end(); } catch (e) {}
    logStream = null;
  }
  ensureLogDir();
  currentLogDate = getLogDate();
  const logFile = getLogFile();
  if (fs.existsSync(logFile) && fs.statSync(logFile).size > MAX_FILE_SIZE) {
    const base = logFile.replace('.log', '');
    let i = 1;
    while (fs.existsSync(`${base}.${i}.log`)) i++;
    fs.renameSync(logFile, `${base}.${i}.log`);
  }
  logStream = fs.createWriteStream(logFile, { flags: 'a', encoding: 'utf-8' });
}

function formatEntry(level, message, meta) {
  const ts = new Date().toISOString();
  const label = labels[level] || level.toUpperCase();
  let line = `[${ts}] [${label}] ${message}`;
  if (meta && Object.keys(meta).length > 0) {
    line += ` ${JSON.stringify(meta)}`;
  }
  return line;
}

function log(level, message, meta) {
  if (!levels.hasOwnProperty(level)) level = 'info';

  const entry = {
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    timestamp: new Date().toISOString(),
    level,
    message,
    meta: meta || null
  };

  if (buffer.length >= MAX_BUFFER) {
    buffer.shift();
  }
  buffer.push(entry);

  const formatted = formatEntry(level, message, meta);

  const today = getLogDate();
  if (!logStream || currentLogDate !== today) {
    rotateStream();
  }
  try { logStream.write(formatted + '\n'); } catch (e) {}

  const logFn = level === 'error' ? console.error
    : level === 'warn' ? console.warn
    : console.log;
  logFn(formatted);
}

function cleanOldLogs() {
  const now = Date.now();
  try {
    const files = fs.readdirSync(LOG_DIR);
    for (const file of files) {
      const filePath = path.join(LOG_DIR, file);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > MAX_LOG_AGE) {
        try { fs.unlinkSync(filePath); } catch (e) {}
      }
    }
  } catch (e) {}
}

export function initLogger() {
  ensureLogDir();
  cleanOldLogs();
  rotateStream();
  setInterval(cleanOldLogs, 24 * 60 * 60 * 1000);
  log('info', 'Logger initialized', { logDir: LOG_DIR });
}

export function getLogs(options = {}) {
  const { level, search, limit = 100, offset = 0 } = options;
  let filtered = buffer;

  if (level && levels.hasOwnProperty(level)) {
    filtered = filtered.filter(e => e.level === level);
  }

  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(e =>
      e.message.toLowerCase().includes(q) ||
      (e.meta && JSON.stringify(e.meta).toLowerCase().includes(q))
    );
  }

  const total = filtered.length;
  const items = filtered.slice(-offset - limit, total - offset).reverse();

  return { items, total };
}

export function getLogFiles() {
  ensureLogDir();
  try {
    return fs.readdirSync(LOG_DIR)
      .filter(f => f.endsWith('.log'))
      .map(f => {
        const filePath = path.join(LOG_DIR, f);
        const stat = fs.statSync(filePath);
        return { name: f, size: stat.size, mtime: stat.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch (e) {
    return [];
  }
}

export function getLogFileContent(filename) {
  const filePath = path.join(LOG_DIR, filename);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf-8');
}

export function closeLogger() {
  if (logStream) {
    try { logStream.end(); } catch (e) {}
    logStream = null;
  }
}

export default {
  initLogger,
  getLogs,
  getLogFiles,
  getLogFileContent,
  closeLogger
};
