import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONFIG_PATH = path.join(__dirname, '..', 'data', 'aria2.json');

const DEFAULT_CONFIG = {
  host: 'localhost',
  port: 6800,
  token: '',
  dir: ''
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      return { ...DEFAULT_CONFIG, ...data };
    }
  } catch (e) {}
  return { ...DEFAULT_CONFIG };
}

function saveConfig(config) {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const merged = { ...DEFAULT_CONFIG, ...config };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

function getRpcUrl(config) {
  const host = config.host || 'localhost';
  const port = config.port || 6800;
  return `http://${host}:${port}/jsonrpc`;
}

async function pushToAria2(magnetUri, options = {}) {
  const config = loadConfig();
  const rpcUrl = getRpcUrl(config);

  const params = [];
  if (config.token) {
    params.push(`token:${config.token}`);
  }
  params.push([magnetUri]);

  const dirOption = options.dir || config.dir;
  if (dirOption) {
    params.push({ dir: dirOption });
  }

  const body = {
    jsonrpc: '2.0',
    id: '1',
    method: 'aria2.addUri',
    params: params
  };

  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Aria2 HTTP error: ${response.status}`);
  }

  const result = await response.json();

  if (result.error) {
    throw new Error(`Aria2 RPC error: ${result.error.message || JSON.stringify(result.error)}`);
  }

  return {
    gid: result.result,
    rpcUrl
  };
}

async function testConnection(config) {
  const testConfig = config || loadConfig();
  const rpcUrl = getRpcUrl(testConfig);

  const params = [];
  if (testConfig.token) {
    params.push(`token:${testConfig.token}`);
  }

  const body = {
    jsonrpc: '2.0',
    id: '1',
    method: 'aria2.getVersion',
    params: params
  };

  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000)
  });

  const result = await response.json();

  if (result.error) {
    throw new Error(result.error.message || 'Connection failed');
  }

  return {
    version: result.result?.version || 'unknown',
    rpcUrl
  };
}

export {
  loadConfig,
  saveConfig,
  pushToAria2,
  testConnection
};
