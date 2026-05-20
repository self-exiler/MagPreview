import WebTorrent from 'webtorrent';
import { getTrackers } from './trackerList.js';

const client = new WebTorrent({
  maxConns: 100,
  dht: true,
  tracker: true
});

const VIDEO_EXTENSIONS = new Set([
  'mp4', 'mkv', 'avi', 'wmv', 'flv', 'mov', 'ts', 'rmvb', 'mp4v', 'm4v', 'webm', 'm2ts'
]);

let serverPort = null;

const server = client.createServer();
server.server.listen(0, () => {
  serverPort = server.server.address().port;
  console.log(`WebTorrent server listening on port ${serverPort}`);
});

function getServerPort() {
  return serverPort;
}

function isVideoFile(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  return VIDEO_EXTENSIONS.has(ext);
}

function augmentMagnetUri(magnetUri) {
  if (!magnetUri.includes('&tr=') && !magnetUri.includes('&tr=')) {
    const trackerList = getTrackers();
    const trackers = trackerList.map(t => `&tr=${encodeURIComponent(t)}`).join('');
    return magnetUri + trackers;
  }
  return magnetUri;
}

async function addTorrent(torrentSource) {
  let sourceKey;
  let augmentedSource = torrentSource;
  
  if (typeof torrentSource === 'string' && torrentSource.startsWith('magnet:')) {
    sourceKey = augmentMagnetUri(torrentSource);
    augmentedSource = sourceKey;
  } else {
    // For torrent files/buffers, we'll use infoHash as key once available
    sourceKey = null;
  }

  const existing = sourceKey ? await client.get(sourceKey) : null;
  if (existing) {
    if (existing.metadata) {
      return existing;
    }
    return new Promise((resolve, reject) => {
      const onMeta = () => {
        existing.removeListener('error', onError);
        resolve(existing);
      };
      const onError = (err) => {
        existing.removeListener('metadata', onMeta);
        reject(err);
      };
      existing.once('metadata', onMeta);
      existing.once('error', onError);
    });
  }

  return new Promise((resolve, reject) => {
    let timeoutId = setTimeout(() => {
      cleanup();
      try { 
        if (torrent.infoHash) {
          client.remove(torrent.infoHash); 
        } else if (sourceKey) {
          client.remove(sourceKey);
        }
      } catch (e) {}
      reject(new Error('Metadata fetch timed out after 120 seconds'));
    }, 120000);

    const torrent = client.add(augmentedSource, { deselect: true });

    function onMetadata() {
      cleanup();
      resolve(torrent);
    }

    function onError(err) {
      cleanup();
      try { 
        if (torrent.infoHash) {
          client.remove(torrent.infoHash); 
        } else if (sourceKey) {
          client.remove(sourceKey);
        }
      } catch (e) {}
      reject(err);
    }

    function cleanup() {
      clearTimeout(timeoutId);
      torrent.removeListener('metadata', onMetadata);
      torrent.removeListener('error', onError);
    }

    torrent.once('metadata', onMetadata);
    torrent.once('error', onError);
  });
}

async function addMagnet(magnetUri) {
  return addTorrent(magnetUri);
}

async function addTorrentFile(torrentBufferOrPath) {
  return addTorrent(torrentBufferOrPath);
}

function removeTorrent(infoHash) {
  const torrent = client.get(infoHash);
  if (torrent) {
    return new Promise((resolve, reject) => {
      client.remove(infoHash, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
  return Promise.resolve();
}

function getTorrent(infoHash) {
  return client.get(infoHash);
}

function destroyClient() {
  return new Promise((resolve, reject) => {
    client.destroy((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export {
  addMagnet,
  addTorrentFile,
  removeTorrent,
  getTorrent,
  destroyClient,
  isVideoFile,
  getServerPort
};
