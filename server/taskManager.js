import { v4 as uuidv4 } from 'uuid';
import { cleanupTask } from './frameExtractor.js';
import { removeTorrent } from './torrentManager.js';

const tasks = new Map();
const TASK_TTL = 30 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [id, t] of tasks) {
    if (now - t.createdAt > TASK_TTL) {
      removeTask(id);
    }
  }
}, 5 * 60 * 1000);

function createTask(infoHash, fileIndex, count) {
  const id = uuidv4();
  const task = {
    id,
    status: 'pending',
    infoHash,
    fileIndex,
    count,
    completed: 0,
    total: count,
    frames: [],
    error: null,
    createdAt: Date.now()
  };
  tasks.set(id, task);
  return id;
}

function getTask(taskId) {
  return tasks.get(taskId) || null;
}

function updateTask(taskId, updates) {
  const task = tasks.get(taskId);
  if (!task) return false;
  Object.assign(task, updates);
  return true;
}

async function removeTask(taskId) {
  const task = tasks.get(taskId);
  if (!task) return;

  cleanupTask(taskId);

  if (task.infoHash) {
    try {
      await removeTorrent(task.infoHash);
    } catch (e) {}
  }

  tasks.delete(taskId);
}

export {
  createTask,
  getTask,
  updateTask,
  removeTask
};
