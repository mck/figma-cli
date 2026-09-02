/**
 * Sidecar Mode: drive Figma Desktop over CDP without touching the installed
 * app and without macOS App Management.
 *
 * Flow: copy /Applications/Figma.app to ~/.figma-bridge/<name>.app, patch
 * THE COPY's app.asar so --remote-debugging-port is honored, ad-hoc re-sign
 * the copy, launch it, connect over CDP. Auto-discovers an already-running
 * patched copy by probing the debug port before creating anything.
 *
 * Safe Mode (plugin) is unchanged and remains the fallback.
 */

import { execFileSync } from 'child_process';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { getCdpPort } from '../figma-patch.js';

export const DEFAULT_SIDECAR_NAME = 'FigmaDebug';
export const BRIDGE_DIR_NAME = '.figma-bridge';
export const INSTALLED_APP = '/Applications/Figma.app';
export const INSTALLED_ASAR = '/Applications/Figma.app/Contents/Resources/app.asar';

const BLOCK_STRING = Buffer.from('removeSwitch("remote-debugging-port")');
const PATCH_STRING = Buffer.from('removeSwitch("remote-debugXing-port")');

export function defaultIo(overrides = {}) {
  return {
    platform: process.platform,
    homedir: homedir(),
    existsSync,
    readFileSync,
    writeFileSync,
    mkdirSync,
    rmSync,
    execFileSync,
    fetch: globalThis.fetch.bind(globalThis),
    getCdpPort,
    now: () => Date.now(),
    ...overrides,
  };
}

export function bridgeDir(io = defaultIo()) {
  return join(io.homedir, BRIDGE_DIR_NAME);
}

export function sidecarAppPath(name = DEFAULT_SIDECAR_NAME, io = defaultIo()) {
  const safe = sanitizeName(name);
  return join(bridgeDir(io), `${safe}.app`);
}

export function sidecarAsarPath(appPath) {
  return join(appPath, 'Contents', 'Resources', 'app.asar');
}

export function sidecarBinaryPath(appPath) {
  return join(appPath, 'Contents', 'MacOS', 'Figma');
}

export function sanitizeName(name) {
  const trimmed = String(name || DEFAULT_SIDECAR_NAME).trim() || DEFAULT_SIDECAR_NAME;
  if (trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) {
    throw new Error(`Invalid sidecar name: ${name}`);
  }
  return trimmed;
}

export function assertNotInstalledPath(targetPath) {
  const resolved = String(targetPath);
  if (
    resolved === INSTALLED_APP ||
    resolved === INSTALLED_ASAR ||
    resolved.startsWith(`${INSTALLED_APP}/`)
  ) {
    throw new Error('Sidecar refuses to write the installed Figma app');
  }
}

/**
 * @returns {boolean|null} true=patched, false=unpatched, null=unknown/unreadable
 */
export function isAsarPatched(asarPath, io = defaultIo()) {
  if (!asarPath || !io.existsSync(asarPath)) return null;
  try {
    const content = io.readFileSync(asarPath);
    if (content.includes(PATCH_STRING)) return true;
    if (content.includes(BLOCK_STRING)) return false;
    return null;
  } catch {
    return null;
  }
}

/**
 * Patch a COPY's app.asar in place. Never accepts the installed app path.
 */
export function patchAsarFile(asarPath, io = defaultIo()) {
  assertNotInstalledPath(asarPath);
  if (!io.existsSync(asarPath)) {
    throw new Error(`Sidecar asar not found: ${asarPath}`);
  }
  const content = Buffer.from(io.readFileSync(asarPath));
  if (content.includes(PATCH_STRING)) return { patched: true, already: true };
  const blockIndex = content.indexOf(BLOCK_STRING);
  if (blockIndex < 0) {
    throw new Error('Could not find the remote-debugging block string. Figma version may be incompatible.');
  }
  PATCH_STRING.copy(content, blockIndex);
  io.writeFileSync(asarPath, content);
  return { patched: true, already: false };
}

export function readAppVersion(appPath, io = defaultIo()) {
  const plist = join(appPath, 'Contents', 'Info.plist');
  if (!io.existsSync(plist)) return null;
  try {
    const raw = io.execFileSync('defaults', ['read', join(appPath, 'Contents', 'Info'), 'CFBundleShortVersionString'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return String(raw).trim() || null;
  } catch {
    try {
      const text = io.readFileSync(plist, 'utf8');
      const m = String(text).match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/);
      return m ? m[1] : null;
    } catch {
      return null;
    }
  }
}

export function sidecarNeedsRefresh(srcApp, destApp, io = defaultIo()) {
  if (!io.existsSync(destApp)) return true;
  const srcVer = readAppVersion(srcApp, io);
  const destVer = readAppVersion(destApp, io);
  if (srcVer && destVer && srcVer !== destVer) return true;
  const patched = isAsarPatched(sidecarAsarPath(destApp), io);
  return patched !== true;
}

export function copyInstalledApp(srcApp, destApp, io = defaultIo()) {
  assertNotInstalledPath(destApp);
  if (srcApp === destApp) {
    throw new Error('Refusing to copy Figma onto itself');
  }
  if (!io.existsSync(srcApp)) {
    throw new Error(`Installed Figma not found at ${srcApp}`);
  }
  io.mkdirSync(dirname(destApp), { recursive: true });
  if (io.existsSync(destApp)) {
    io.rmSync(destApp, { recursive: true, force: true });
  }
  io.execFileSync('ditto', [srcApp, destApp], { stdio: 'pipe' });
}

export function adHocSign(appPath, io = defaultIo()) {
  assertNotInstalledPath(appPath);
  io.execFileSync('codesign', ['--force', '--deep', '-s', '-', appPath], { stdio: 'pipe' });
}

export function launchSidecar(appPath, port, io = defaultIo()) {
  assertNotInstalledPath(appPath);
  io.execFileSync(
    'open',
    ['-n', '-a', appPath, '--args', `--remote-debugging-port=${port}`],
    { stdio: 'pipe' }
  );
}

/**
 * Probe the CDP debug port. Distinguishes "nothing listening" from a live
 * Figma (desktop or browser tab) session.
 */
export async function probeDebugPort(port, io = defaultIo()) {
  const url = `http://127.0.0.1:${port}`;
  try {
    const versionRes = await io.fetch(`${url}/json/version`, {
      signal: AbortSignal.timeout(800),
    });
    if (!versionRes.ok) return { up: false, hasFigma: false };
    let version = {};
    try { version = await versionRes.json(); } catch { version = {}; }
    let pages = [];
    try {
      const pagesRes = await io.fetch(`${url}/json`, { signal: AbortSignal.timeout(800) });
      pages = await pagesRes.json();
    } catch {
      pages = [];
    }
    const list = Array.isArray(pages) ? pages : [];
    const hasFigma = list.some((p) => p && p.url && String(p.url).includes('figma.com'));
    return {
      up: true,
      hasFigma,
      browser: version.Browser || version.browser || null,
      pages: list,
    };
  } catch {
    return { up: false, hasFigma: false, pages: [] };
  }
}

/**
 * Copy / patch / sign / launch as needed. If the debug port already speaks
 * Figma, reuse that session and do not create another copy.
 */
export async function ensureSidecar(options = {}, io = defaultIo()) {
  if ((options.platform || io.platform) !== 'darwin') {
    throw new Error('Sidecar Mode is macOS-only. Use Safe Mode: figma-cli connect --safe');
  }

  const name = sanitizeName(options.name || DEFAULT_SIDECAR_NAME);
  const port = options.port || io.getCdpPort();
  const srcApp = options.sourceApp || INSTALLED_APP;
  const destApp = options.destApp || sidecarAppPath(name, io);
  const writes = [];

  const probe = await probeDebugPort(port, io);
  if (probe.up && probe.hasFigma) {
    return {
      action: 'reused',
      appPath: destApp,
      port,
      copied: false,
      patched: false,
      signed: false,
      launched: false,
      writes,
      probe,
    };
  }
  if (probe.up && !probe.hasFigma) {
    throw new Error(
      `CDP port ${port} is in use but is not Figma. Pass --port to pick a free port, or stop the other debug session.`
    );
  }

  assertNotInstalledPath(destApp);
  io.mkdirSync(bridgeDir(io), { recursive: true });

  let copied = false;
  let patched = false;
  let signed = false;

  const needsCopy = !io.existsSync(destApp) || sidecarNeedsRefresh(srcApp, destApp, io);
  if (needsCopy) {
    const destExists = io.existsSync(destApp);
    const srcVer = readAppVersion(srcApp, io);
    const destVer = destExists ? readAppVersion(destApp, io) : null;
    const versionDrift = !!(srcVer && destVer && srcVer !== destVer);

    if (!destExists || versionDrift) {
      copyInstalledApp(srcApp, destApp, io);
      copied = true;
      writes.push({ op: 'copy', path: destApp });
    }

    const asarPath = sidecarAsarPath(destApp);
    if (isAsarPatched(asarPath, io) !== true) {
      const result = patchAsarFile(asarPath, io);
      patched = !result.already;
      writes.push({ op: 'patch', path: asarPath });
    }

    adHocSign(destApp, io);
    signed = true;
    writes.push({ op: 'sign', path: destApp });
  } else if (isAsarPatched(sidecarAsarPath(destApp), io) !== true) {
    const asarPath = sidecarAsarPath(destApp);
    patchAsarFile(asarPath, io);
    patched = true;
    adHocSign(destApp, io);
    signed = true;
    writes.push({ op: 'patch', path: asarPath }, { op: 'sign', path: destApp });
  }

  launchSidecar(destApp, port, io);
  writes.push({ op: 'launch', path: destApp, port });

  return {
    action: copied ? 'created' : 'launched',
    appPath: destApp,
    port,
    copied,
    patched,
    signed,
    launched: true,
    writes,
    probe: { up: false, hasFigma: false },
  };
}

export async function waitForSidecar(port, { timeoutMs = 20000, intervalMs = 500 } = {}, io = defaultIo()) {
  const maxIters = Math.max(1, Math.ceil(timeoutMs / intervalMs));
  for (let i = 0; i < maxIters; i++) {
    const probe = await probeDebugPort(port, io);
    if (probe.up && probe.hasFigma) return probe;
    if (i < maxIters - 1) await new Promise((r) => setTimeout(r, intervalMs));
  }
  const last = await probeDebugPort(port, io);
  if (last.up && last.hasFigma) return last;
  throw new Error(
    `Sidecar Figma did not expose CDP on port ${port} in time. Open a design file in the sidecar app, or fall back to Safe Mode: figma-cli connect --safe`
  );
}
