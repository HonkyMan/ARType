import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, copyFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function command(cwd, executable, args) {
  return spawnSync(executable, args, {cwd, encoding: 'utf8', env: {...process.env, GIT_CONFIG_NOSYSTEM: '1'}});
}
function mustRun(cwd, executable, args) {
  const result = command(cwd, executable, args);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'artype-package-'));
  const repo = join(root, 'repository');
  await mkdir(repo);
  const files = {
    VERSION: '9.8.7\n', LICENSE: 'Test MIT notice\n', 'README.md': 'Fixture\n',
    '.gitignore': '.env*\n!.env.example\nbuild/\n',
    '.env.example': 'EXAMPLE_ONLY=true\n',
    'compose.yaml': 'services: {}\n', 'compose.local.yaml': 'services: {}\n',
    'server/src/index.js': 'console.log("fixture");\n', 'server/public/index.html': '<main>fixture</main>\n',
    'server/package.json': '{"type":"module","scripts":{"check":"node scripts/check.mjs"}}\n',
    'server/package-lock.json': '{}\n', 'server/Dockerfile': 'FROM node:24\n',
    'server/.dockerignore': '.env*\n', 'server/scripts/check.mjs': 'console.log("fixture check");\n',
    'docs/OPERATIONS.md': 'Fixture operations\n', 'docs/ACCEPTANCE.md': 'Fixture acceptance\n',
    'docs/ARCHITECTURE.md': 'Fixture architecture\n', 'docs/ARCHIVE.md': 'Historical content\n',
    'deployment/setup.sh': '#!/bin/sh\n', 'deployment/configure.mjs': '// fixture\n',
    'deployment/backup.sh': '#!/bin/sh\n', 'deployment/restore.sh': '#!/bin/sh\n',
    'deployment/Caddyfile': '# fixture\n', 'deployment/publish-downloads.mjs': '// fixture\n',
  };
  try {
    for (const [path, content] of Object.entries(files)) {
      const target = join(repo, path);
      await mkdir(join(target, '..'), {recursive: true});
      await writeFile(target, content);
    }
    await mkdir(join(repo, 'scripts'));
    await copyFile(join(repository, 'scripts/package-artype-server.sh'), join(repo, 'scripts/package-artype-server.sh'));
    try {
      await copyFile(join(repository, 'scripts/package-artype-pilot.mjs'), join(repo, 'scripts/package-artype-pilot.mjs'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    mustRun(repo, 'git', ['init', '-q']);
    mustRun(repo, 'git', ['add', '.']);
    mustRun(repo, 'git', ['-c', 'user.name=Packaging test', '-c', 'user.email=test@example.invalid',
      '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'Fixture']);
    await writeFile(join(repo, '.env'), 'SECRET_MUST_NOT_SHIP=private-value\n');
    await writeFile(join(repo, 'google-client.json'), '{"client_secret":"private-value"}\n');
    await run({root, repo});
  } finally {
    await rm(root, {recursive: true, force: true});
  }
}

async function unpack(root, archive) {
  const destination = await mkdtemp(join(root, 'unpacked-'));
  mustRun(root, 'tar', ['-xzf', archive, '-C', destination]);
  return join(destination, 'ARType-server');
}

test('server package contains committed version and check entry point, excludes local secrets, and is reproducible', async () => {
  await fixture(async ({root, repo}) => {
    const first = join(root, 'first');
    const second = join(root, 'second');
    mustRun(repo, 'bash', ['scripts/package-artype-server.sh', first]);
    mustRun(repo, 'bash', ['scripts/package-artype-server.sh', second]);
    const filename = 'ARType-server-9.8.7.tar.gz';
    const archive = join(first, filename);
    const contents = mustRun(repo, 'tar', ['-tzf', archive]);
    assert.match(contents, /^ARType-server\/VERSION$/m);
    assert.match(contents, /^ARType-server\/server\/scripts\/check.mjs$/m);
    assert.doesNotMatch(contents, /(?:^|\/)\.env$|google-client\.json|node_modules/);
    assert.equal(digest(await readFile(archive)), digest(await readFile(join(second, filename))));
    assert.match(await readFile(archive + '.sha256', 'utf8'), new RegExp(`^${digest(await readFile(archive))}  ${filename.replaceAll('.', '\\.')}`));
    const payload = await unpack(root, archive);
    const manifest = JSON.parse(await readFile(join(payload, 'PACKAGE.json'), 'utf8'));
    assert.equal(manifest.source_commit, mustRun(repo, 'git', ['rev-parse', 'HEAD']).trim());
    assert.equal(manifest.version, '9.8.7');
    assert.deepEqual(JSON.parse(await readFile(join(payload, 'releases/manifest.json'), 'utf8')), {files: []});
  });
});

test('server packaging refuses modified, staged and new release inputs instead of silently archiving old HEAD', async () => {
  await fixture(async ({root, repo}) => {
    for (const path of ['VERSION', 'server/src/index.js', 'server/public/new-module.js', 'server/scripts/check.mjs']) {
      const original = await readFile(join(repo, path)).catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      await writeFile(join(repo, path), 'uncommitted\n');
      const result = command(repo, 'bash', ['scripts/package-artype-server.sh', join(root, 'out')]);
      assert.notEqual(result.status, 0, `Packaged stale input: ${path}`);
      assert.match(result.stderr, /commit|dirty|uncommitted/i);
      if (original) await writeFile(join(repo, path), original);
      else await rm(join(repo, path));
    }
    await writeFile(join(repo, 'VERSION'), '1.0.0\n');
    mustRun(repo, 'git', ['add', 'VERSION']);
    assert.notEqual(command(repo, 'bash', ['scripts/package-artype-server.sh', join(root, 'out')]).status, 0);
  });
});

test('tracked secret filenames in source payload are refused rather than shipped', async () => {
  await fixture(async ({root, repo}) => {
    await writeFile(join(repo, 'server/src/.env'), 'DO_NOT_SHIP=secret\n');
    mustRun(repo, 'git', ['add', '-f', 'server/src/.env']);
    mustRun(repo, 'git', ['-c', 'user.name=Packaging test', '-c', 'user.email=test@example.invalid',
      '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'Accidental secret fixture']);
    const result = command(repo, 'bash', ['scripts/package-artype-server.sh', join(root, 'out')]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /secret|forbidden|sensitive/i);
  });
});

test('pilot package embeds only explicitly supplied installers with matching manifest bytes and hashes', async () => {
  await fixture(async ({root, repo}) => {
    const macos = join(root, 'ARType-test.dmg');
    const windows = join(root, 'ARType-test.exe');
    await writeFile(macos, 'Mac installer fixture');
    await writeFile(windows, 'Windows installer fixture');
    const out = join(root, 'pilot');
    const args = ['scripts/package-artype-pilot.mjs', '--out', out, '--macos', macos,
      '--windows', windows, '--service-url', 'http://127.0.0.1:8080', '--signing', 'unsigned-validation'];
    mustRun(repo, process.execPath, args);
    const payload = await unpack(root, join(out, 'ARType-pilot-9.8.7.tar.gz'));
    const {files} = JSON.parse(await readFile(join(payload, 'releases/manifest.json'), 'utf8'));
    assert.deepEqual(files.map(file => file.platform), ['macos-arm64', 'windows-x64']);
    for (const file of files) {
      const bytes = await readFile(join(payload, 'releases', file.filename));
      assert.equal(file.sha256, digest(bytes));
      assert.equal(file.size_bytes, bytes.length);
      assert.equal(file.service_url, 'http://127.0.0.1:8080');
      assert.equal(file.signing, 'unsigned-validation');
      assert.equal(file.version, '9.8.7');
    }
    const second = join(root, 'pilot-again');
    mustRun(repo, process.execPath, args.map(value => value === out ? second : value));
    assert.equal(
      digest(await readFile(join(out, 'ARType-pilot-9.8.7.tar.gz'))),
      digest(await readFile(join(second, 'ARType-pilot-9.8.7.tar.gz'))),
    );
    const invalid = args.map(value => value === 'http://127.0.0.1:8080' ? 'ftp://localhost' : value);
    assert.notEqual(command(repo, process.execPath, invalid).status, 0);
    const mislabeled = args.map(value => value === 'unsigned-validation' ? 'signed' : value);
    assert.notEqual(command(repo, process.execPath, mislabeled).status, 0);
  });
});

test('legacy macOS build paths forward explicit corporate arguments without version or Git side effects', async () => {
  const root = await mkdtemp(join(tmpdir(), 'artype-forwarder-'));
  try {
    await mkdir(join(root, 'macos/scripts'), {recursive: true});
    await mkdir(join(root, 'scripts'));
    await writeFile(join(root, 'scripts/build-artype-macos.sh'), '#!/bin/sh\nprintf "%s\\n" "$@"\n', {mode: 0o755});
    for (const filename of ['build-release.sh', 'go.sh']) {
      const path = join('macos/scripts', filename);
      await copyFile(join(repository, path), join(root, path));
      assert.equal(mustRun(root, 'bash', [path, 'https://translate.example.com', '--validation']),
        'https://translate.example.com\n--validation\n');
    }
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('macOS validation rejects non-HTTP loopback and empty URL delimiters before invoking build tools', () => {
  for (const origin of ['ftp://127.0.0.1', 'http://127.0.0.1:8080?', 'http://127.0.0.1:8080#']) {
    const result = command(repository, 'bash', ['scripts/build-artype-macos.sh', origin, '--validation']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /HTTPS required|Expected server origin/);
  }
});
