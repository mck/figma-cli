import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import {
  DEFAULT_SIDECAR_NAME,
  INSTALLED_APP,
  INSTALLED_ASAR,
  adHocSign,
  assertNotInstalledPath,
  copyInstalledApp,
  ensureSidecar,
  isAsarPatched,
  launchSidecar,
  patchAsarFile,
  probeDebugPort,
  sanitizeName,
  sidecarAppPath,
  sidecarAsarPath,
  sidecarNeedsRefresh,
} from '../src/lib/sidecar.js';

const BLOCK = Buffer.from('removeSwitch("remote-debugging-port")');
const PATCH = Buffer.from('removeSwitch("remote-debugXing-port")');

function makeAsar(patched) {
  const prefix = Buffer.from('xxxx');
  const mid = patched ? PATCH : BLOCK;
  const suffix = Buffer.from('yyyy');
  return Buffer.concat([prefix, mid, suffix]);
}

function mockIo(opts = {}) {
  const files = new Map(opts.files || []);
  const dirs = new Set(opts.dirs || []);
  const calls = [];
  const io = {
    platform: 'darwin',
    homedir: '/Users/test',
    getCdpPort: () => 9222,
    now: () => 0,
    existsSync(p) {
      return files.has(p) || dirs.has(p);
    },
    readFileSync(p, enc) {
      if (!files.has(p)) throw new Error(`ENOENT ${p}`);
      const v = files.get(p);
      if (enc === 'utf8') return Buffer.isBuffer(v) ? v.toString('utf8') : String(v);
      return Buffer.isBuffer(v) ? v : Buffer.from(v);
    },
    writeFileSync(p, data) {
      calls.push(['writeFileSync', p]);
      files.set(p, Buffer.isBuffer(data) ? data : Buffer.from(data));
    },
    mkdirSync(p) {
      calls.push(['mkdirSync', p]);
      dirs.add(p);
    },
    rmSync(p) {
      calls.push(['rmSync', p]);
      files.delete(p);
      dirs.delete(p);
      for (const k of [...files.keys()]) if (k.startsWith(p + '/')) files.delete(k);
    },
    execFileSync(cmd, args) {
      calls.push(['execFileSync', cmd, [...args]]);
      if (cmd === 'defaults') return opts.version || '99.0.0';
      if (cmd === 'ditto') {
        const dest = args[1];
        dirs.add(dest);
        files.set(`${dest}/Contents/Resources/app.asar`, Buffer.from(files.get(opts.srcAsar) || makeAsar(false)));
        files.set(`${dest}/Contents/Info.plist`, Buffer.from(
          '<key>CFBundleShortVersionString</key><string>99.0.0</string>'
        ));
      }
      return '';
    },
    fetch: opts.fetch || (async () => { throw new Error('ECONNREFUSED'); }),
    files,
    dirs,
    calls,
  };
  return io;
}

describe('sidecar paths', () => {
  it('places the copy under ~/.figma-bridge/<name>.app', () => {
    const io = mockIo();
    assert.equal(sidecarAppPath('FigmaDebug', io), '/Users/test/.figma-bridge/FigmaDebug.app');
    assert.equal(sidecarAppPath(undefined, io), '/Users/test/.figma-bridge/FigmaDebug.app');
    assert.equal(DEFAULT_SIDECAR_NAME, 'FigmaDebug');
  });

  it('rejects path traversal in the sidecar name', () => {
    assert.throws(() => sanitizeName('../Figma'), /Invalid sidecar name/);
    assert.throws(() => sanitizeName('foo/bar'), /Invalid sidecar name/);
  });

  it('refuses the installed Figma app path', () => {
    assert.throws(() => assertNotInstalledPath(INSTALLED_APP), /installed Figma/);
    assert.throws(() => assertNotInstalledPath(INSTALLED_ASAR), /installed Figma/);
    assert.throws(() => assertNotInstalledPath(`${INSTALLED_APP}/Contents/Resources/app.asar`), /installed Figma/);
  });
});

describe('asar patch', () => {
  it('detects patched, unpatched, and missing asars', () => {
    const io = mockIo({
      files: [
        ['/tmp/unpatched.asar', makeAsar(false)],
        ['/tmp/patched.asar', makeAsar(true)],
      ],
    });
    assert.equal(isAsarPatched('/tmp/unpatched.asar', io), false);
    assert.equal(isAsarPatched('/tmp/patched.asar', io), true);
    assert.equal(isAsarPatched('/tmp/missing.asar', io), null);
  });

  it('patches the copy in place and never the installed app', () => {
    const dest = '/Users/test/.figma-bridge/FigmaDebug.app/Contents/Resources/app.asar';
    const io = mockIo({ files: [[dest, makeAsar(false)]] });
    const result = patchAsarFile(dest, io);
    assert.equal(result.patched, true);
    assert.equal(result.already, false);
    assert.equal(isAsarPatched(dest, io), true);
    assert.deepEqual(io.calls.filter((c) => c[0] === 'writeFileSync').map((c) => c[1]), [dest]);
    assert.throws(() => patchAsarFile(INSTALLED_ASAR, io), /installed Figma/);
  });

  it('is a no-op when the copy is already patched', () => {
    const dest = '/Users/test/.figma-bridge/FigmaDebug.app/Contents/Resources/app.asar';
    const io = mockIo({ files: [[dest, makeAsar(true)]] });
    const result = patchAsarFile(dest, io);
    assert.equal(result.already, true);
    assert.equal(io.calls.filter((c) => c[0] === 'writeFileSync').length, 0);
  });
});

describe('copy, sign, launch', () => {
  it('copies with ditto onto the sidecar path, not the installed app', () => {
    const io = mockIo({
      files: [[INSTALLED_APP, Buffer.from('app')]],
      dirs: [INSTALLED_APP],
    });
    io.files.set(INSTALLED_APP, Buffer.from('app'));
    copyInstalledApp(INSTALLED_APP, '/Users/test/.figma-bridge/FigmaDebug.app', io);
    const ditto = io.calls.find((c) => c[0] === 'execFileSync' && c[1] === 'ditto');
    assert.ok(ditto);
    assert.deepEqual(ditto[2], [INSTALLED_APP, '/Users/test/.figma-bridge/FigmaDebug.app']);
    assert.throws(
      () => copyInstalledApp(INSTALLED_APP, INSTALLED_APP, io),
      /itself|installed/
    );
  });

  it('ad-hoc signs with codesign --force --deep -s -', () => {
    const io = mockIo();
    const dest = '/Users/test/.figma-bridge/FigmaDebug.app';
    adHocSign(dest, io);
    const sign = io.calls.find((c) => c[0] === 'execFileSync' && c[1] === 'codesign');
    assert.deepEqual(sign[2], ['--force', '--deep', '-s', '-', dest]);
    assert.throws(() => adHocSign(INSTALLED_APP, io), /installed Figma/);
  });

  it('launches the sidecar copy with open -n, never open -a Figma', () => {
    const io = mockIo();
    const dest = '/Users/test/.figma-bridge/FigmaDebug.app';
    launchSidecar(dest, 9222, io);
    const open = io.calls.find((c) => c[0] === 'execFileSync' && c[1] === 'open');
    assert.deepEqual(open[2], ['-n', '-a', dest, '--args', '--remote-debugging-port=9222']);
    assert.ok(!open[2].includes('Figma') || open[2].includes(dest));
    assert.equal(open[2].includes('Figma') && !String(open[2][2]).includes('.figma-bridge'), false);
  });
});

describe('probeDebugPort', () => {
  it('returns up:false when nothing listens', async () => {
    const io = mockIo();
    const probe = await probeDebugPort(9222, io);
    assert.equal(probe.up, false);
    assert.equal(probe.hasFigma, false);
  });

  it('detects a live Figma session on the debug port', async () => {
    const io = mockIo({
      fetch: async (url) => {
        if (String(url).endsWith('/json/version')) {
          return { ok: true, json: async () => ({ Browser: 'Chrome/120 Electron' }) };
        }
        return {
          ok: true,
          json: async () => [{ url: 'https://www.figma.com/design/abc/File', title: 'File' }],
        };
      },
    });
    const probe = await probeDebugPort(9222, io);
    assert.equal(probe.up, true);
    assert.equal(probe.hasFigma, true);
  });
});

describe('ensureSidecar', () => {
  it('reuses an already-running patched copy and does not copy or sign', async () => {
    const io = mockIo({
      fetch: async (url) => {
        if (String(url).endsWith('/json/version')) {
          return { ok: true, json: async () => ({ Browser: 'Chrome/120' }) };
        }
        return {
          ok: true,
          json: async () => [{ url: 'https://www.figma.com/design/abc/File' }],
        };
      },
    });
    const result = await ensureSidecar({ name: 'FigmaDebug' }, io);
    assert.equal(result.action, 'reused');
    assert.equal(result.copied, false);
    assert.equal(result.launched, false);
    assert.equal(io.calls.filter((c) => c[0] === 'execFileSync').length, 0);
    assert.equal(io.calls.filter((c) => c[0] === 'writeFileSync').length, 0);
  });

  it('copies, patches, signs, and launches when nothing is listening', async () => {
    const srcAsar = `${INSTALLED_APP}/Contents/Resources/app.asar`;
    const io = mockIo({
      srcAsar,
      files: [
        [INSTALLED_APP, Buffer.from('app')],
        [srcAsar, makeAsar(false)],
        [`${INSTALLED_APP}/Contents/Info.plist`, Buffer.from(
          '<key>CFBundleShortVersionString</key><string>99.0.0</string>'
        )],
      ],
      dirs: [INSTALLED_APP],
    });
    const result = await ensureSidecar({ name: 'FigmaDebug' }, io);
    assert.equal(result.action, 'created');
    assert.equal(result.copied, true);
    assert.equal(result.patched, true);
    assert.equal(result.signed, true);
    assert.equal(result.launched, true);
    const cmds = io.calls.filter((c) => c[0] === 'execFileSync').map((c) => c[1]);
    assert.ok(cmds.includes('ditto'));
    assert.ok(cmds.includes('codesign'));
    assert.ok(cmds.includes('open'));
    const writes = io.calls.filter((c) => c[0] === 'writeFileSync').map((c) => c[1]);
    assert.ok(writes.every((p) => !String(p).startsWith(INSTALLED_APP)));
    assert.ok(writes.every((p) => String(p).includes('.figma-bridge')));
    const asar = sidecarAsarPath(result.appPath);
    assert.equal(isAsarPatched(asar, io), true);
  });

  it('is macOS-only', async () => {
    const io = mockIo();
    io.platform = 'linux';
    await assert.rejects(() => ensureSidecar({}, io), /macOS-only/);
  });

  it('refuses to create when the debug port is taken by a non-Figma process', async () => {
    const io = mockIo({
      fetch: async (url) => {
        if (String(url).endsWith('/json/version')) {
          return { ok: true, json: async () => ({ Browser: 'Chrome/120' }) };
        }
        return { ok: true, json: async () => [{ url: 'https://example.com' }] };
      },
    });
    await assert.rejects(() => ensureSidecar({}, io), /not Figma/);
  });
});

describe('sidecarNeedsRefresh', () => {
  it('needs a copy when the dest app is missing', () => {
    const io = mockIo({ dirs: [INSTALLED_APP], files: [[INSTALLED_APP, Buffer.from('x')]] });
    assert.equal(sidecarNeedsRefresh(INSTALLED_APP, '/Users/test/.figma-bridge/FigmaDebug.app', io), true);
  });
});
