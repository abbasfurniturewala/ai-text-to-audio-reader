import { parentPort, workerData } from 'node:worker_threads';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { AudiobookJobs } from './audiobook-jobs.mjs';
const jobs = new AudiobookJobs({ ...workerData, onProgress: job => parentPort.postMessage({ type: 'progress', job }) });
async function runtimeInfo() {
  let configuration, capabilities = {};
  try { configuration = JSON.parse((await readFile(path.join(workerData.runtimeRoot, 'runtime.json'), 'utf8')).replace(/^\uFEFF/, '')); } catch { /* CPU export remains available without the optional setup. */ }
  try { capabilities = JSON.parse(await readFile(path.join(workerData.runtimeRoot, 'capabilities.json'), 'utf8')); } catch { /* A new runtime can still be tested with Compare. */ }
  const exists = async name => { try { await access(path.join(workerData.runtimeRoot, configuration[name])); return true; } catch { return false; } };
  const tools = !!configuration && await exists('ffmpeg') && await exists('ffprobe');
  return { tools, kokoroGpu: tools && await exists('ortPython'), capabilities };
}
parentPort.on('message', async ({ id, action, ...input }) => {
  try {
    let result;
    if (action === 'list') result = await jobs.list();
    else if (action === 'runtime') result = await runtimeInfo();
    else if (action === 'create') { result = await jobs.create(input.request, input.output); void jobs.start(result.id).catch(error => parentPort.postMessage({ type: 'error', error: error.message })); }
    else if (action === 'resume') { void jobs.start(input.jobId).catch(error => parentPort.postMessage({ type: 'error', error: error.message })); result = true; }
    else if (action === 'pause') { await jobs.pause(input.jobId); result = true; }
    else if (action === 'sample') result = await jobs.sample(input.request);
    else if (action === 'shutdown') { await jobs.shutdown(); parentPort.postMessage({ id, result: true }); parentPort.close(); return; }
    else throw new Error('Unknown audiobook request.');
    parentPort.postMessage({ id, result });
  } catch (error) { parentPort.postMessage({ id, error: error.message }); }
});
