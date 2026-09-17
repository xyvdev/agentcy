/**
 * needle-worker.js
 * Background Web Worker for Cactus Compute Needle inside AgentCy.
 * 
 * Runs Needle 3 WASM and 2-bit weights off the main UI thread.
 * Handles:
 * - Model download with progressive percentage reporting
 * - Persistent caching in CacheStorage
 * - On-device tool calling with calibrated confidence gating
 * - On-device text embeddings for local semantic search
 */

/* global importScripts, createNeedle, self, caches, Response */

const CACHE_NAME = 'agentcy-needle-v1';
const LOCAL_WEIGHTS_URL = '/needle/needle3.cact';
const REMOTE_WEIGHTS_URL = 'https://huggingface.co/Cactus-Compute/needle3/resolve/main/needle3.cact';
const WASM_URL = '/needle/needle.wasm';

let Module = null;
let isReady = false;
let currentTools = [];

function allocateString(mod, str) {
  if (!str) return 0;
  const bytes = new TextEncoder().encode(str + '\0');
  const ptr = mod._malloc(bytes.length);
  mod.HEAPU8.set(bytes, ptr);
  return ptr;
}

// Post typed message helper
function send(type, payload = {}) {
  self.postMessage({ type, ...payload });
}

// Download and cache model with progressive reporting
async function loadWeightsBuffer() {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(LOCAL_WEIGHTS_URL);

  if (cachedResponse) {
    send('STATUS', { status: 'loading_cache', percent: 100 });
    return await cachedResponse.arrayBuffer();
  }

  // Stream fetch with progress reporting
  send('PROGRESS', { percent: 0 });
  send('STATUS', { status: 'downloading', percent: 0 });

  // Try local asset first, fall back to Hugging Face CDN (avoids Cloudflare Pages 25MB file limit and SPA 200 fallback)
  let response = null;
  try {
    const localRes = await fetch(LOCAL_WEIGHTS_URL);
    const ct = localRes ? (localRes.headers.get('content-type') || '') : '';
    const cl = Number(localRes.headers.get('content-length')) || 0;
    if (localRes.ok && !ct.includes('text/html') && cl > 20000000) {
      response = localRes;
    }
  } catch (e) {
    // Local asset fetch error, fallback to CDN
  }

  if (!response) {
    console.log('[NeedleWorker] Streaming model weights from Hugging Face CDN...');
    response = await fetch(REMOTE_WEIGHTS_URL);
  }

  if (!response || !response.ok) {
    throw new Error(`Failed to fetch Needle model weights: ${response ? response.status : 'network error'}`);
  }

  const contentLength = Number(response.headers.get('Content-Length')) || 35335380;
  const reader = response.body.getReader();
  const chunks = [];
  let receivedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    receivedBytes += value.length;
    const percent = Math.min(99, Math.round((receivedBytes / contentLength) * 100));
    send('PROGRESS', { percent });
  }

  const allChunks = new Uint8Array(receivedBytes);
  let position = 0;
  for (const chunk of chunks) {
    allChunks.set(chunk, position);
    position += chunk.length;
  }

  // Cache permanently in CacheStorage
  try {
    const cacheResponse = new Response(allChunks.buffer, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(receivedBytes)
      }
    });
    await cache.put(LOCAL_WEIGHTS_URL, cacheResponse);
  } catch (cacheErr) {
    console.warn('[NeedleWorker] CacheStorage save warning:', cacheErr);
  }

  send('PROGRESS', { percent: 100 });
  return allChunks.buffer;
}

async function initEngine(tools = [], systemPrompt = "date: 2026-09-17; locale: en-US; device: phone") {
  try {
    send('PROGRESS', { percent: 0 });
    send('STATUS', { status: 'initializing' });

    // Load Emscripten glue script
    if (typeof createNeedle !== 'function') {
      importScripts('/needle/needle.js');
    }

    // Concurrently fetch WASM binary and model weights to maximize speed and bypass path rewrites
    const [wasmBinary, weightsBuffer] = await Promise.all([
      fetch(WASM_URL).then(async (res) => {
        if (!res.ok) throw new Error(`Failed to fetch WASM binary: ${res.status}`);
        return await res.arrayBuffer();
      }),
      loadWeightsBuffer()
    ]);

    Module = await createNeedle({
      wasmBinary
    });

    send('STATUS', { status: 'loading_weights' });

    const weightsView = new Uint8Array(weightsBuffer);
    const weightsPtr = Module._malloc(weightsView.length);
    Module.HEAPU8.set(weightsView, weightsPtr);

    const loadRet = Module._needle_load(weightsPtr, BigInt(weightsView.length));
    if (loadRet < 0) {
      throw new Error(`_needle_load returned error code: ${loadRet}`);
    }

    currentTools = tools;
    const sysPtr = allocateString(Module, systemPrompt);
    const toolsPtr = allocateString(Module, JSON.stringify(tools));

    Module._needle_init(sysPtr, toolsPtr, 0);
    Module._free(sysPtr);
    Module._free(toolsPtr);

    isReady = true;
    send('READY', { toolsCount: tools.length });
  } catch (err) {
    isReady = false;
    send('ERROR', { error: err.message || String(err) });
  }
}

function completeTurn(id, text, maxNewTokens = 128) {
  if (!isReady || !Module) {
    send('EVALUATE_RESULT', { id, error: 'Engine not ready' });
    return;
  }

  const startTime = performance.now();
  const inPtr = allocateString(Module, text);
  const outCap = 16384;
  const outPtr = Module._malloc(outCap);

  try {
    Module._needle_complete(inPtr, maxNewTokens, outPtr, outCap);
    const resultStr = Module.UTF8ToString(outPtr);
    const latencyMs = Math.round(performance.now() - startTime);

    let parsed;
    try {
      parsed = JSON.parse(resultStr);
    } catch (e) {
      parsed = { type: 'error', raw: resultStr };
    }

    send('EVALUATE_RESULT', { id, data: parsed, latencyMs });
  } finally {
    Module._free(inPtr);
    Module._free(outPtr);
  }
}

function embedText(id, text) {
  if (!isReady || !Module) {
    send('EMBED_RESULT', { id, error: 'Engine not ready' });
    return;
  }

  const dim = Module._needle_embed(0, 0, 0);
  const outFloatPtr = Module._malloc(dim * 4);
  const inPtr = allocateString(Module, text);

  try {
    Module._needle_embed(inPtr, outFloatPtr, dim);
    const floatView = new Float32Array(Module.HEAPU8.buffer, outFloatPtr, dim);
    const vector = Array.from(floatView);
    send('EMBED_RESULT', { id, vector });
  } finally {
    Module._free(inPtr);
    Module._free(outFloatPtr);
  }
}

self.onmessage = async (event) => {
  const { type, id, payload } = event.data;

  switch (type) {
    case 'INIT':
      await initEngine(payload?.tools || [], payload?.system);
      break;

    case 'COMPLETE':
      completeTurn(id, payload?.text, payload?.maxNewTokens);
      break;

    case 'EMBED':
      embedText(id, payload?.text);
      break;

    case 'RESET':
      if (Module && Module._needle_reset) {
        Module._needle_reset();
      }
      send('RESET_DONE');
      break;

    default:
      console.warn('[NeedleWorker] Unknown message type:', type);
  }
};
