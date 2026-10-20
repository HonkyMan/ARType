#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream, createWriteStream} from 'node:fs';
import {copyFile, lstat, mkdir, mkdtemp, rename, rm, writeFile} from 'node:fs/promises';
import {basename, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGzip} from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const prefix = 'ARType-server/';
const payload = [
  'VERSION', 'LICENSE', 'README.md', '.env.example', 'compose.yaml', 'compose.local.yaml',
  'docs/WORKSPACES.md', 'docs/OPERATIONS.md', 'docs/ACCEPTANCE.md', 'docs/ARCHITECTURE.md', 'docs/ARCHIVE.md', 'docs/ROLES.md',
  'server/src', 'server/public', 'server/package.json', 'server/package-lock.json',
  'server/Dockerfile', 'server/.dockerignore', 'server/scripts/check.mjs',
  'deployment/Caddyfile', 'deployment/setup.sh', 'deployment/configure.mjs',
  'deployment/backup.sh', 'deployment/restore.sh', 'deployment/publish-downloads.mjs',
];
const releaseInputs = [...payload, 'scripts/package-artype-server.sh', 'scripts/package-artype-pilot.mjs'];
const usage = `Usage:
  scripts/package-artype-server.sh [OUTPUT_DIRECTORY]
  node scripts/package-artype-pilot.mjs [--out DIRECTORY]
    [--macos FILE.dmg] [--windows FILE.exe]
    [--service-url ORIGIN --signing signed|unsigned-validation]

Uses committed HEAD and refuses uncommitted release inputs. Installers are
optional; their service URL and signing state must be supplied explicitly.
The packager records these declarations and hashes, but does not sign or
inspect the embedded native configuration. Requires Node 24+ and Git.`;

function git(args, encoding = 'utf8') {
  return execFileSync('git', args, {cwd: root, encoding, maxBuffer: 64 * 1024 * 1024});
}

function assertClean() {
  const dirty = git(['status', '--porcelain=v1', '--untracked-files=all', '--', ...releaseInputs]);
  if (dirty) throw new Error('Uncommitted release inputs: commit the reviewed files before packaging HEAD.\n' + dirty.trimEnd());
}

function sourceTree(commit) {
  const entries = git(['ls-tree', '-rz', commit, '--', ...payload]).split('\0').filter(Boolean);
  for (const entry of entries) {
    const [metadata, path] = entry.split('\t');
    if (!/^100(?:644|755) blob /.test(metadata)) {
      throw new Error(`Only regular tracked files may be packaged: ${path}`);
    }
    const segments = path.split('/');
    const name = basename(path);
    const secretName = segments.some(part => /^\.env(?:\.|$)/i.test(part)) ||
      /^(?:\.npmrc|id_(?:rsa|ed25519)|credentials.*\.json|client_secret.*\.json|google-client.*\.json)$/i.test(name) ||
      /\.(?:pem|key|p12|pfx)$/i.test(name);
    if (secretName && path !== '.env.example') throw new Error(`Forbidden sensitive filename in release payload: ${path}`);
  }
  // Required paths must exist at HEAD, even if a local ignored file happens to exist.
  for (const path of payload) git(['cat-file', '-e', `${commit}:${path}`]);
}

function serviceOrigin(value, signing) {
  const url = new URL(value);
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  const localHTTP = signing === 'unsigned-validation' && local && url.protocol === 'http:';
  if ((url.protocol !== 'https:' && !localHTTP) || url.username || url.password ||
      url.href.includes('?') || url.href.includes('#') || url.pathname !== '/') {
    throw new Error('Service URL must be an HTTPS origin; unsigned validation also permits HTTP loopback.');
  }
  if (signing === 'signed' && local) throw new Error('Signed distribution requires a public HTTPS service origin.');
  return url.origin;
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

// Git supplies deterministic committed entries. Remove its end blocks before
// appending generated metadata and explicitly supplied binaries.
function tarBody(archive) {
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) return archive.subarray(0, offset);
    const size = Number.parseInt(header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim(), 8);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('Invalid Git archive entry size');
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error('Git archive has no end marker');
}

function tarHeader(path, size, timestamp, directory = false) {
  const header = Buffer.alloc(512);
  let name = path;
  let parent = '';
  if (Buffer.byteLength(name) > 100) {
    const split = path.lastIndexOf('/');
    name = path.slice(split + 1);
    parent = path.slice(0, split);
  }
  if (Buffer.byteLength(name) > 100 || Buffer.byteLength(parent) > 155) throw new Error('Archive path is too long');
  const field = (value, offset, length) => {
    if (Buffer.byteLength(value) > length) throw new Error('Archive metadata is too large');
    header.write(value, offset, length, 'utf8');
  };
  const octal = (value, offset, length) => field(value.toString(8).padStart(length - 1, '0') + '\0', offset, length);
  field(name, 0, 100);
  octal(directory ? 0o755 : 0o644, 100, 8);
  octal(0, 108, 8);
  octal(0, 116, 8);
  octal(size, 124, 12);
  octal(timestamp, 136, 12);
  header.fill(32, 148, 156);
  field(directory ? '5' : '0', 156, 1);
  field('ustar\0', 257, 6);
  field('00', 263, 2);
  field(parent, 345, 155);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  field(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return header;
}

async function main() {
  const {values} = parseArgs({options: {
    out: {type: 'string', default: join(root, 'build/artype')},
    macos: {type: 'string'}, windows: {type: 'string'},
    'service-url': {type: 'string'}, signing: {type: 'string'},
    'server-only': {type: 'boolean', default: false},
    help: {type: 'boolean', short: 'h'},
  }});
  if (values.help) { console.log(usage); return; }
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Packaging requires Node 24 or newer.');
  const installers = !!(values.macos || values.windows);
  if (values['server-only'] && (installers || values.signing || values['service-url'])) throw new Error(usage);
  if (installers && (!values['service-url'] || !['signed', 'unsigned-validation'].includes(values.signing))) throw new Error(usage);
  if (!installers && (values.signing || values['service-url'])) throw new Error('Installer metadata requires an installer file.');
  const origin = installers ? serviceOrigin(values['service-url'], values.signing) : null;
  assertClean();
  const commit = git(['rev-parse', 'HEAD']).trim();
  const version = git(['show', `${commit}:VERSION`]).trim();
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version)) throw new Error('VERSION must contain a release version.');
  sourceTree(commit);
  const timestamp = Number(git(['show', '-s', '--format=%ct', commit]).trim());
  const source = tarBody(git(['-c', 'tar.umask=0022', 'archive', '--format=tar', `--prefix=${prefix}`, commit, ...payload], null));
  const out = resolve(values.out);
  await mkdir(out, {recursive: true});
  const temporary = await mkdtemp(join(out, '.artype-package-'));
  try {
    const files = [];
    for (const [option, platform, extension] of [['macos', 'macos-arm64', '.dmg'], ['windows', 'windows-x64', '.exe']]) {
      if (!values[option]) continue;
      const input = resolve(values[option]);
      const filename = basename(input);
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(filename) || !filename.endsWith(extension)) {
        throw new Error(`Invalid ${platform} installer filename`);
      }
      if (!(await lstat(input)).isFile()) throw new Error('Installer inputs must be regular files.');
      const staged = join(temporary, filename);
      await copyFile(input, staged);
      files.push({
        filename, platform, version, signing: values.signing,
        sha256: await sha256(staged), size_bytes: (await lstat(staged)).size, service_url: origin,
      });
    }
    const kind = values['server-only'] ? 'server' : 'pilot';
    const metadata = {
      kind, version, source_commit: commit, source_date: new Date(timestamp * 1000).toISOString(),
      installers: files,
    };
    const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
    const generated = [
      {path: prefix + 'PACKAGE.json', data: json(metadata)},
      {path: prefix + 'releases/', data: Buffer.alloc(0), directory: true},
      {path: prefix + 'releases/manifest.json', data: json({files})},
      ...files.map(file => ({path: prefix + 'releases/' + file.filename, file: join(temporary, file.filename), size: file.size_bytes})),
    ];
    async function* contents() {
      yield source;
      for (const entry of generated) {
        const size = entry.size ?? entry.data.length;
        yield tarHeader(entry.path, size, timestamp, entry.directory);
        if (entry.file) yield* createReadStream(entry.file);
        else yield entry.data;
        const padding = (512 - size % 512) % 512;
        if (padding) yield Buffer.alloc(padding);
      }
      yield Buffer.alloc(1024);
    }
    const filename = `ARType-${kind}-${version}.tar.gz`;
    const stagedArchive = join(temporary, filename);
    await pipeline(Readable.from(contents()), createGzip({level: 9}), createWriteStream(stagedArchive, {flags: 'wx'}));
    assertClean();
    if (git(['rev-parse', 'HEAD']).trim() !== commit) throw new Error('HEAD changed while packaging; rerun from the reviewed commit.');
    const checksum = await sha256(stagedArchive);
    await writeFile(stagedArchive + '.sha256', `${checksum}  ${filename}\n`);
    await rename(stagedArchive, join(out, filename));
    await rename(stagedArchive + '.sha256', join(out, filename + '.sha256'));
    console.log(join(out, filename));
  } finally {
    await rm(temporary, {recursive: true, force: true});
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
