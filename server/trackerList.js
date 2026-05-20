import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import https from 'https';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_DIR = path.join(__dirname, '..', 'data');
const TRACKERS_FILE = path.join(DATA_DIR, 'trackers.json');

const DEFAULT_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://tracker.bittor.pw:1337/announce',
  'udp://public.popcorn-tracker.org:6969/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://tracker.moeking.me:6969/announce',
  'udp://tracker.tiny-vps.com:6969/announce',
  'udp://tracker.theoks.net:6969/announce',
  'udp://p4p.arenabg.com:1337/announce',
  'udp://movies.zsw.ca:6969/announce',
  'udp://retracker.lanta-net.ru:2710/announce',
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.btorrent.xyz'
];

const REMOTE_URL = 'https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_all.txt';

let currentTrackers = [];
let lastUpdated = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadTrackersFromDisk() {
  ensureDataDir();
  if (fs.existsSync(TRACKERS_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(TRACKERS_FILE, 'utf-8'));
      currentTrackers = data.trackers || [];
      lastUpdated = data.lastUpdated || null;
      return;
    } catch (e) {}
  }
  currentTrackers = [...DEFAULT_TRACKERS];
  lastUpdated = null;
}

function saveTrackersToDisk() {
  ensureDataDir();
  const data = {
    trackers: currentTrackers,
    lastUpdated: lastUpdated,
    source: lastUpdated ? 'remote' : 'default'
  };
  fs.writeFileSync(TRACKERS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const options = {
      timeout: 30000,
      headers: { 'User-Agent': 'MagPreview/1.0' }
    };
    if (url.startsWith('https')) {
      options.rejectUnauthorized = false;
    }
    const req = mod.get(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

async function updateTrackersFromRemote() {
  const text = await fetchUrl(REMOTE_URL);
  const trackers = text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && (line.startsWith('udp://') || line.startsWith('http://') || line.startsWith('https://') || line.startsWith('wss://')));

  if (trackers.length === 0) {
    throw new Error('No valid trackers found in remote list');
  }

  const wsTrackers = [
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.btorrent.xyz'
  ];

  currentTrackers = [...trackers, ...wsTrackers.filter(ws => !trackers.includes(ws))];
  lastUpdated = new Date().toISOString();
  saveTrackersToDisk();

  return {
    count: currentTrackers.length,
    lastUpdated: lastUpdated
  };
}

function getTrackers() {
  return currentTrackers;
}

function getTrackerStatus() {
  return {
    count: currentTrackers.length,
    lastUpdated: lastUpdated,
    source: lastUpdated ? 'remote' : 'default',
    trackers: currentTrackers
  };
}

function resetToDefault() {
  currentTrackers = [...DEFAULT_TRACKERS];
  lastUpdated = null;
  saveTrackersToDisk();
  return {
    count: currentTrackers.length,
    lastUpdated: null,
    source: 'default'
  };
}

loadTrackersFromDisk();

export {
  getTrackers,
  getTrackerStatus,
  updateTrackersFromRemote,
  resetToDefault
};
