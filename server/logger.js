import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LOG_DIR = path.join(__dirname, '..', 'logs');
const MAX_LOG_SIZE = 5 * 1024 * 1024;
const MAX_LOG_FILES = 10;

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

const currentLevel = LOG_LEVELS.INFO;

let currentLogFile = null;
let logStream = null;

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function getLogFilename() {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  return path.join(LOG_DIR, `app-${date}.log`);
}

function rotateLogFileIfNeeded() {
  const filename = getLogFilename();
  
  if (currentLogFile === filename && logStream) {
    return;
  }

  if (logStream) {
    try {
      logStream.end();
    } catch (e) {
      console.error('Error closing log stream:', e);
    }
  }

  currentLogFile = filename;
  ensureLogDir();

  try {
    if (fs.existsSync(filename)) {
      const stats = fs.statSync(filename);
      if (stats.size >= MAX_LOG_SIZE) {
        rotateOldLogs(filename);
      }
    }
    logStream = fs.createWriteStream(filename, { flags: 'a' });
  } catch (e) {
    console.error('Error creating log stream:', e);
    logStream = null;
  }
}

function rotateOldLogs(currentFile) {
  try {
    const files = fs.readdirSync(LOG_DIR)
      .filter(f => f.startsWith('app-') && f.endsWith('.log'))
      .map(f => ({
        name: f,
        path: path.join(LOG_DIR, f),
        time: fs.statSync(path.join(LOG_DIR, f)).mtime.getTime()
      }))
      .sort((a, b) => b.time - a.time);

    while (files.length >= MAX_LOG_FILES) {
      const oldFile = files.pop();
      try {
        fs.unlinkSync(oldFile.path);
      } catch (e) {
        console.error('Error deleting old log file:', e);
      }
    }

    const timestamp = Date.now();
    const newName = currentFile.replace('.log', `-${timestamp}.log`);
    fs.renameSync(currentFile, newName);
  } catch (e) {
    console.error('Error rotating logs:', e);
  }
}

function formatMessage(level, message, data) {
  const now = new Date();
  const timestamp = now.toISOString();
  let logEntry = {
    timestamp,
    level,
    message,
    pid: process.pid
  };

  if (data !== undefined) {
    if (data instanceof Error) {
      logEntry.error = {
        message: data.message,
        stack: data.stack
      };
    } else if (typeof data === 'object') {
      logEntry.data = data;
    } else {
      logEntry.data = String(data);
    }
  }

  return JSON.stringify(logEntry) + '\n';
}

function writeLog(level, message, data) {
  if (level < currentLevel) {
    return;
  }

  try {
    rotateLogFileIfNeeded();
    
    if (logStream) {
      logStream.write(formatMessage(level, message, data));
    }
  } catch (e) {
    console.error('Error writing log:', e);
  }
}

const logger = {
  debug(message, data) {
    writeLog(LOG_LEVELS.DEBUG, message, data);
  },
  
  info(message, data) {
    writeLog(LOG_LEVELS.INFO, message, data);
  },
  
  warn(message, data) {
    writeLog(LOG_LEVELS.WARN, message, data);
  },
  
  error(message, data) {
    writeLog(LOG_LEVELS.ERROR, message, data);
  },

  getLogs(options = {}) {
    const {
      level,
      startTime,
      endTime,
      limit = 100,
      offset = 0,
      search
    } = options;

    ensureLogDir();
    
    try {
      const files = fs.readdirSync(LOG_DIR)
        .filter(f => f.startsWith('app-') && f.endsWith('.log'))
        .map(f => ({
          name: f,
          path: path.join(LOG_DIR, f),
          time: fs.statSync(path.join(LOG_DIR, f)).mtime.getTime()
        }))
        .sort((a, b) => b.time - a.time);

      let allLogs = [];

      for (const file of files) {
        try {
          const content = fs.readFileSync(file.path, 'utf-8');
          const lines = content.split('\n').filter(line => line.trim());
          
          for (const line of lines) {
            try {
              const entry = JSON.parse(line);
              allLogs.push(entry);
            } catch (e) {
              allLogs.push({
                timestamp: new Date().toISOString(),
                level: 'INFO',
                message: line
              });
            }
          }
        } catch (e) {
          console.error('Error reading log file:', e);
        }
      }

      if (startTime) {
        const start = new Date(startTime).getTime();
        allLogs = allLogs.filter(log => new Date(log.timestamp).getTime() >= start);
      }

      if (endTime) {
        const end = new Date(endTime).getTime();
        allLogs = allLogs.filter(log => new Date(log.timestamp).getTime() <= end);
      }

      if (level) {
        const levels = Array.isArray(level) ? level : [level];
        allLogs = allLogs.filter(log => levels.includes(log.level.toUpperCase()));
      }

      if (search) {
        const searchLower = search.toLowerCase();
        allLogs = allLogs.filter(log => 
          log.message.toLowerCase().includes(searchLower) ||
          (log.data && JSON.stringify(log.data).toLowerCase().includes(searchLower))
        );
      }

      allLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      const total = allLogs.length;
      const logs = allLogs.slice(offset, offset + limit);

      return {
        logs,
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      };
    } catch (e) {
      console.error('Error getting logs:', e);
      return {
        logs: [],
        total: 0,
        limit,
        offset,
        hasMore: false,
        error: e.message
      };
    }
  },

  clearLogs() {
    ensureLogDir();
    try {
      const files = fs.readdirSync(LOG_DIR)
        .filter(f => f.startsWith('app-') && f.endsWith('.log'));
      
      for (const file of files) {
        try {
          fs.unlinkSync(path.join(LOG_DIR, file));
        } catch (e) {
          console.error('Error deleting log file:', e);
        }
      }
      
      return { success: true, message: 'Logs cleared' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  getLogFiles() {
    ensureLogDir();
    try {
      const files = fs.readdirSync(LOG_DIR)
        .filter(f => f.startsWith('app-') && f.endsWith('.log'))
        .map(f => {
          const filePath = path.join(LOG_DIR, f);
          const stats = fs.statSync(filePath);
          return {
            name: f,
            size: stats.size,
            sizeFormatted: formatSize(stats.size),
            created: stats.birthtime.toISOString(),
            modified: stats.mtime.toISOString()
          };
        })
        .sort((a, b) => new Date(b.modified) - new Date(a.modified));
      
      return files;
    } catch (e) {
      console.error('Error getting log files:', e);
      return [];
    }
  }
};

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + sizes[i];
}

export default logger;
