/**
 * Production-browser benchmark for B1.
 *
 * This intentionally uses only Node built-ins and the browser's DevTools
 * protocol. It exercises the built app through its real UI, so a "full" run
 * includes the same scene, WebCodecs encoder, audio path, muxer, progress UI,
 * and download a viewer gets.
 *
 * Examples:
 *   node tools/run-browser-benchmark.mjs --quality=1080p30
 *   node tools/run-browser-benchmark.mjs --quality=1080p30 --genre=rock
 *   node tools/run-browser-benchmark.mjs --quality=1080p60 --cpu-throttle=4 --hardware-concurrency=4
 *   node tools/run-browser-benchmark.mjs --mode=low-power --probe-only
 *   node tools/run-browser-benchmark.mjs --mode=swiftshader --probe-only
 *
 * Start the production server (`npm start`) before running this script.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...value] = arg.replace(/^--/, '').split('=');
    return [key, value.length > 0 ? value.join('=') : 'true'];
  }),
);

const mode = args.get('mode') ?? 'native';
const quality = args.get('quality') ?? '1080p30';
const seed = args.get('seed') ?? 'B1BENCH1';
const serverUrl = args.get('url') ?? 'http://127.0.0.1:5000/';
const probeOnly = args.get('probe-only') === 'true';
const audio = args.get('audio') !== 'false';
const genre = args.get('genre') ?? 'dnb';
const cpuThrottle = Number(args.get('cpu-throttle') ?? '1');
const hardwareConcurrency = Number(args.get('hardware-concurrency') ?? '0');
const outputRoot = resolve(args.get('output-dir') ?? join(tmpdir(), 'canicarrera-b1-output'));
const browserPath = resolveBrowser(args.get('browser'));

async function main() {
  if (!['native', 'low-power', 'swiftshader'].includes(mode)) {
    throw new Error(`Unknown mode ${mode}; use native, low-power, or swiftshader.`);
  }
  if (!/^1080p(?:30|60)$/.test(quality) && !probeOnly) {
    throw new Error(`Full B1 runs accept 1080p30 or 1080p60, not ${quality}.`);
  }
  if (!(cpuThrottle >= 1)) throw new Error('cpu-throttle must be at least 1.');
  if (!['dnb', 'kids', 'rock'].includes(genre)) {
    throw new Error(`Unknown genre ${genre}; use dnb, kids, or rock.`);
  }

  const runName = [
    mode,
    probeOnly ? 'probe' : quality,
    genre,
    cpuThrottle > 1 ? `cpu${cpuThrottle}` : 'cpu1',
  ].join('-');
  const profileDir = await mkdtemp(join(tmpdir(), 'canicarrera-browser-benchmark-'));
  const downloadDir = join(outputRoot, `${runName}-${Date.now()}`);
  await mkdir(downloadDir, { recursive: true });
  const port = await freePort();

  let browserProcess;
  let browser;
  let page;
  const startedAt = Date.now();

  try {
    await assertServer(serverUrl);
    browserProcess = launchBrowser(browserPath, port, profileDir, mode);
    const version = await waitForJson(`http://127.0.0.1:${port}/json/version`, 30_000);
    browser = await Cdp.connect(version.webSocketDebuggerUrl);
    await browser.call('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: downloadDir,
      eventsEnabled: true,
    });

  const gpuInfo = compactGpuInfo(await browser.call('SystemInfo.getInfo'));
  const { targetId } = await browser.call('Target.createTarget', { url: 'about:blank' });
  const target = await waitForTarget(port, targetId);
  page = await Cdp.connect(target.webSocketDebuggerUrl);
  await Promise.all([
    page.call('Page.enable'),
    page.call('Runtime.enable'),
    page.call('Performance.enable'),
    page.call('HeapProfiler.enable'),
  ]);
  await page.call('Emulation.setCPUThrottlingRate', { rate: cpuThrottle });
  if (hardwareConcurrency > 0) {
    await page.call('Emulation.setHardwareConcurrencyOverride', {
      hardwareConcurrency,
    }).catch(() => undefined);
  }
  await page.call('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const url = new URL(serverUrl);
  url.searchParams.set('c', seed);
  await page.call('Page.navigate', { url: url.href });
  const bootStart = Date.now();
  await waitFor(
    page,
    `Boolean(window.__canicarrera?.sim && window.__canicarrera?.isRunning)`,
    mode === 'swiftshader' ? 300_000 : 120_000,
    'production app and capability probe',
  );
  const bootMs = Date.now() - bootStart;
  const genreControl = await selectGenre(page, genre);
  const before = await collectPageState(page);

  let exportResult = null;
  if (!probeOnly) {
    exportResult = await runUiExport(page, {
      quality,
      audio,
      genreControl,
      downloadDir,
      seed: before.seed,
      timeoutMs: cpuThrottle > 1 ? 1_200_000 : 900_000,
    });
  }

  await page.call('HeapProfiler.collectGarbage').catch(() => undefined);
  await delay(500);
  const after = await collectPageState(page);
  const performanceMetrics = metricsMap(await page.call('Performance.getMetrics'));

  const result = {
    run: {
      mode,
      quality: probeOnly ? null : quality,
      probeOnly,
      audio: probeOnly ? null : audio,
      genre,
      cpuThrottle,
      hardwareConcurrency: hardwareConcurrency || null,
      seed: before.seed,
      serverUrl,
      browser: basename(browserPath),
      browserVersion: version.Browser,
      protocolVersion: version['Protocol-Version'],
      wallMs: Date.now() - startedAt,
      bootMs,
    },
    gpu: gpuInfo,
    capability: before.capability,
    before,
    after,
    performance: pickPerformanceMetrics(performanceMetrics),
    export: exportResult,
  };

    process.stdout.write(`\nBENCHMARK_RESULT ${JSON.stringify(result)}\n`);
  } finally {
    await page?.close().catch(() => undefined);
    if (browser) {
      await browser.call('Browser.close').catch(() => undefined);
      await browser.close().catch(() => undefined);
    }
    if (browserProcess && browserProcess.exitCode === null) browserProcess.kill();
    await delay(500);
    await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function resolveBrowser(explicit) {
  const candidates = [
    explicit,
    process.env.CANICARRERA_BROWSER,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/microsoft-edge',
    '/usr/bin/google-chrome',
  ].filter(Boolean);
  const candidate = candidates.find((path) => {
    try {
      return Boolean(path && statSyncSafe(path));
    } catch {
      return false;
    }
  });
  if (!candidate) {
    throw new Error('No Chromium browser found. Pass --browser=PATH or set CANICARRERA_BROWSER.');
  }
  return candidate;
}

function statSyncSafe(path) {
  // Dynamic import would make browser discovery async for no gain. This tiny
  // probe uses the same Node built-in without adding a package dependency.
  return process.getBuiltinModule('node:fs').statSync(path).isFile();
}

function launchBrowser(path, debuggingPort, userDataDir, renderMode) {
  const browserArgs = [
    '--headless=new',
    `--remote-debugging-port=${debuggingPort}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--enable-precise-memory-info',
    '--force-device-scale-factor=1',
    '--window-size=1280,720',
    'about:blank',
  ];
  if (renderMode === 'swiftshader') {
    browserArgs.unshift(
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    );
  } else if (renderMode === 'low-power') {
    // Chromium's GPU workaround list exposes this test switch. On switchable
    // Windows systems it makes ANGLE's default device the integrated/low-power
    // GPU, which gives B1 a repeatable iGPU proxy on a dual-GPU laptop.
    browserArgs.unshift('--force_low_power_gpu');
  }
  const child = spawn(path, browserArgs, {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });
  child.stderr.on('data', (chunk) => {
    const line = String(chunk).trim();
    if (/ERROR|FATAL/i.test(line)) process.stderr.write(`[browser] ${line}\n`);
  });
  return child;
}

async function assertServer(url) {
  const health = new URL('/api/health', url);
  const response = await fetch(health);
  if (!response.ok) throw new Error(`Production server health returned ${response.status}.`);
  const body = await response.json();
  if (!body.ok) throw new Error('Production server health did not report ok.');
}

async function runUiExport(cdp, options) {
  process.stdout.write(`Starting ${options.quality} production UI export...\n`);
  await waitFor(
    cdp,
    `Array.from(document.querySelectorAll('button')).some((button) => /skip to the end|saltar al final/i.test(button.title || button.textContent || ''))`,
    30_000,
    'race skip control',
  );
  await evaluate(cdp, `(() => {
    const button = Array.from(document.querySelectorAll('button')).find((item) =>
      /skip to the end|saltar al final/i.test(item.title || item.textContent || '')
    );
    button?.click();
    return Boolean(button);
  })()`);

  await waitFor(
    cdp,
    `Array.from(document.querySelectorAll('button')).some((button) => /^(export mp4|exportar mp4)$/i.test((button.textContent || '').trim()))`,
    10_000,
    'results export button',
  );
  await evaluate(cdp, `(() => {
    const button = Array.from(document.querySelectorAll('button')).find((item) =>
      /^(export mp4|exportar mp4)$/i.test((item.textContent || '').trim())
    );
    button?.click();
    return Boolean(button);
  })()`);
  await delay(150);

  await evaluate(cdp, `(() => {
    const button = Array.from(document.querySelectorAll('button')).find((item) =>
      /advanced options|opciones avanzadas/i.test(item.textContent || '')
    );
    if (!button) return false;
    if (button.getAttribute('aria-expanded') !== 'true') button.click();
    return true;
  })()`);
  await delay(100);

  const selected = await evaluate(cdp, `(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const qualityButton = buttons.find((item) =>
      (item.textContent || '').trim().startsWith(${JSON.stringify(options.quality)})
    );
    const presetButton = buttons.find((item) =>
      /^(estándar|standard)/i.test((item.textContent || '').trim())
    );
    qualityButton?.click();
    presetButton?.click();
    return {
      quality: Boolean(qualityButton),
      preset: Boolean(presetButton),
      buttons: buttons.map((item) => (item.textContent || '').trim()).filter(Boolean),
    };
  })()`);
  if (!selected.quality || !selected.preset) {
    throw new Error(
      `Could not select ${options.quality} / Standard from the real export panel: ${JSON.stringify(selected)}`,
    );
  }
  await delay(200);

  const audioState = await evaluate(cdp, `(() => {
    const checkbox = document.querySelector('input[type="checkbox"]');
    if (!checkbox) return null;
    if (checkbox.checked !== ${options.audio}) checkbox.click();
    return { checked: checkbox.checked, disabled: checkbox.disabled };
  })()`);
  const panelBefore = await evaluate(cdp, `(() => {
    const start = Array.from(document.querySelectorAll('button')).find((item) =>
      /exportar mp4|export mp4/i.test(item.textContent || '') &&
      (item.textContent || '').includes(${JSON.stringify(options.quality)})
    );
    return {
      startText: start?.textContent?.trim() ?? null,
      disabled: start?.disabled ?? null,
      panelText: start?.closest('.slab')?.innerText ?? null,
    };
  })()`);
  if (!panelBefore.startText || panelBefore.disabled) {
    throw new Error(`The ${options.quality} export control is missing or disabled.`);
  }

  const clickWall = Date.now();
  await evaluate(cdp, `(() => {
    const start = Array.from(document.querySelectorAll('button')).find((item) =>
      /exportar mp4|export mp4/i.test(item.textContent || '') &&
      (item.textContent || '').includes(${JSON.stringify(options.quality)})
    );
    start?.click();
    return Boolean(start);
  })()`);

  let lastReport = 0;
  await waitFor(
    cdp,
    `/video listo|video ready/i.test(document.body.innerText)`,
    options.timeoutMs,
    `${options.quality} export completion`,
    async (elapsed) => {
      if (elapsed - lastReport < 15_000) return;
      lastReport = elapsed;
      const progress = await evaluate(cdp, `(() => {
        const text = document.querySelector('.slab')?.innerText ?? '';
        return text.split('\\n').filter(Boolean).slice(0, 6).join(' | ');
      })()`);
      process.stdout.write(`  ${Math.round(elapsed / 1000)}s: ${progress}\n`);
    },
  );
  const doneWallMs = Date.now() - clickWall;
  const doneText = await evaluate(cdp, `(() => {
    const panel = Array.from(document.querySelectorAll('.slab')).find((item) =>
      /video listo|video ready/i.test(item.innerText || '')
    );
    return panel?.innerText ?? document.body.innerText;
  })()`);
  const filePath = await waitForDownload(options.downloadDir, options.seed, options.quality, 60_000);
  const file = await stat(filePath);
  return {
    selected: panelBefore.startText,
    genreControl: options.genreControl,
    panelBefore: panelBefore.panelText,
    audioControl: audioState,
    doneText,
    wallMs: doneWallMs,
    file: {
      path: filePath,
      name: basename(filePath),
      bytes: file.size,
      sha256: await sha256(filePath),
    },
  };
}

async function selectGenre(cdp, genre) {
  const opened = await evaluate(cdp, `(() => {
    const button = Array.from(document.querySelectorAll('button')).find((item) =>
      /^(mix|mezcla)$/i.test(item.getAttribute('aria-label') || '')
    );
    if (!button) return false;
    if (button.getAttribute('aria-expanded') !== 'true') button.click();
    return true;
  })()`);
  if (!opened) throw new Error('Could not open the real audio settings panel.');
  await delay(100);

  const current = await evaluate(cdp, `document.querySelector('select')?.value ?? null`);
  if (current === genre) {
    await evaluate(cdp, `(() => {
      const select = document.querySelector('select');
      if (!select) return false;
      select.value = select.value === 'dnb' ? 'kids' : 'dnb';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await delay(50);
  }

  const selected = await evaluate(cdp, `(() => {
    const select = document.querySelector('select');
    if (!select) return null;
    select.value = ${JSON.stringify(genre)};
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return { requested: ${JSON.stringify(genre)}, selected: select.value };
  })()`);
  await delay(150);
  const persisted = await evaluate(cdp, `(() => {
    const select = document.querySelector('select');
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem('canicarrera.audio.v1') || 'null'); } catch {}
    return { selected: select?.value ?? null, storedGenre: stored?.genre ?? null };
  })()`);
  if (!selected || persisted.selected !== genre || persisted.storedGenre !== genre) {
    throw new Error(`Genre selection did not persist: ${JSON.stringify({ selected, persisted })}`);
  }
  return { ...selected, ...persisted };
}

async function collectPageState(cdp) {
  return evaluate(cdp, `(() => {
    const scene = window.__canicarrera;
    const gl = scene?.renderer?.getContext?.();
    const debug = gl?.getExtension?.('WEBGL_debug_renderer_info');
    const capabilityRaw = localStorage.getItem('canicarrera.capability.v4');
    const info = scene?.renderer?.info;
    return {
      url: location.href,
      seed: scene?.spec?.seed ?? null,
      phase: scene?.sim?.phase ?? null,
      hidden: document.hidden,
      visibilityState: document.visibilityState,
      hasFocus: document.hasFocus(),
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      screen: { width: screen.width, height: screen.height },
      userAgent: navigator.userAgent,
      deviceMemory: navigator.deviceMemory ?? null,
      hardwareConcurrency: navigator.hardwareConcurrency,
      webgl: gl ? {
        vendor: gl.getParameter(gl.VENDOR),
        renderer: gl.getParameter(gl.RENDERER),
        unmaskedVendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null,
        unmaskedRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
        version: gl.getParameter(gl.VERSION),
        shadingLanguage: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
        contextLost: gl.isContextLost(),
      } : null,
      rendererInfo: info ? {
        memory: { ...info.memory },
        programs: info.programs?.length ?? null,
        render: { ...info.render },
      } : null,
      drawingBuffer: scene?.renderer ? {
        width: scene.renderer.domElement.width,
        height: scene.renderer.domElement.height,
        pixelRatio: scene.renderer.getPixelRatio(),
      } : null,
      jsHeap: performance.memory ? {
        used: performance.memory.usedJSHeapSize,
        total: performance.memory.totalJSHeapSize,
        limit: performance.memory.jsHeapSizeLimit,
      } : null,
      capability: capabilityRaw ? JSON.parse(capabilityRaw) : null,
    };
  })()`);
}

function compactGpuInfo(info) {
  const gpu = info.gpu ?? {};
  return {
    devices: (gpu.devices ?? []).map((device) => ({
      vendorId: device.vendorId,
      deviceId: device.deviceId,
      vendorString: device.vendorString,
      deviceString: device.deviceString,
      driverVendor: device.driverVendor,
      driverVersion: device.driverVersion,
    })),
    auxAttributes: gpu.auxAttributes,
    featureStatus: gpu.featureStatus,
    videoEncoding: gpu.videoEncoding,
  };
}

function metricsMap(payload) {
  return Object.fromEntries((payload.metrics ?? []).map((metric) => [metric.name, metric.value]));
}

function pickPerformanceMetrics(metrics) {
  const names = [
    'Timestamp',
    'Documents',
    'Frames',
    'JSEventListeners',
    'Nodes',
    'LayoutCount',
    'RecalcStyleCount',
    'JSHeapUsedSize',
    'JSHeapTotalSize',
    'ScriptDuration',
    'TaskDuration',
  ];
  return Object.fromEntries(names.filter((name) => name in metrics).map((name) => [name, metrics[name]]));
}

async function evaluate(cdp, expression) {
  const payload = await cdp.call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (payload.exceptionDetails) {
    throw new Error(payload.exceptionDetails.exception?.description ?? payload.exceptionDetails.text);
  }
  return payload.result.value;
}

async function waitFor(cdp, expression, timeoutMs, label, onPoll) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      if (await evaluate(cdp, expression)) return;
    } catch (error) {
      lastError = error;
    }
    await onPoll?.(Date.now() - started);
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}.`);
}

async function waitForDownload(directory, wantedSeed, wantedQuality, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const names = await readdir(directory);
    const name = names.find(
      (candidate) =>
        candidate.endsWith('.mp4') &&
        candidate.includes(wantedSeed) &&
        candidate.includes(wantedQuality),
    );
    if (name) {
      const path = join(directory, name);
      const first = (await stat(path)).size;
      await delay(500);
      const second = (await stat(path)).size;
      if (first === second && second > 0) return path;
    }
    await delay(200);
  }
  throw new Error(`Browser did not finish a ${wantedQuality} MP4 download.`);
}

async function sha256(path) {
  const hash = createHash('sha256');
  await new Promise((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolvePromise);
  });
  return hash.digest('hex').toUpperCase();
}

async function freePort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const portNumber = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolvePromise(portNumber)));
    });
  });
}

async function waitForJson(url, timeoutMs) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`DevTools endpoint did not start: ${lastError?.message ?? 'timeout'}`);
}

async function waitForTarget(portNumber, targetId) {
  const started = Date.now();
  while (Date.now() - started < 10_000) {
    const response = await fetch(`http://127.0.0.1:${portNumber}/json/list`);
    const targets = await response.json();
    const target = targets.find((item) => item.id === targetId);
    if (target?.webSocketDebuggerUrl) return target;
    await delay(100);
  }
  throw new Error(`DevTools target ${targetId} did not appear.`);
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

class Cdp {
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolvePromise, reject) => {
      socket.addEventListener('open', resolvePromise, { once: true });
      socket.addEventListener('error', () => reject(new Error(`Could not connect to ${url}`)), {
        once: true,
      });
    });
    return new Cdp(socket);
  }

  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${message.error.message} (${message.error.code})`));
      else pending.resolve(message.result ?? {});
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('DevTools connection closed.'));
      this.pending.clear();
    });
  }

  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    this.socket.close();
    await delay(50);
  }
}

await main();
