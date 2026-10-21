import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, copyFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const versionFiles = [
  'VERSION', 'macos/TypeTide.xcodeproj/project.pbxproj',
  'windows/CMakeLists.txt', 'windows/src/TypeTide.rc', 'windows/src/TypeTide.manifest',
];

async function assertVersion(root, expected) {
  assert.equal((await readFile(join(root, 'VERSION'), 'utf8')).trim(), expected);
  const escaped = expected.replaceAll('.', '\\.');
  const project = await readFile(join(root, versionFiles[1]), 'utf8');
  const marketingVersions = [...project.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map(match => match[1]);
  assert.ok(marketingVersions.length > 0);
  assert.ok(marketingVersions.every(version => version === expected));
  assert.match(await readFile(join(root, versionFiles[2]), 'utf8'), new RegExp(`project\\(TypeTide VERSION ${escaped} `));
  const resource = await readFile(join(root, versionFiles[3]), 'utf8');
  assert.ok(resource.includes('FILEVERSION ' + expected.replaceAll('.', ',') + ',0'));
  assert.ok(resource.includes('PRODUCTVERSION ' + expected.replaceAll('.', ',') + ',0'));
  assert.match(resource, new RegExp(`"FileVersion", "${escaped}"`));
  assert.match(resource, new RegExp(`"ProductVersion", "${escaped}"`));
  const manifest = await readFile(join(root, versionFiles[4]), 'utf8');
  assert.match(manifest, new RegExp(`<assemblyIdentity version="${escaped}\\.0"[^>]+name="everettjf.ARType"`));
  assert.match(manifest, /name="Microsoft.Windows.Common-Controls"\s+version="6\.0\.0\.0"/);
}

test('all checked-in platform versions agree with the shared VERSION file', async () => {
  await assertVersion(repository, (await readFile(join(repository, 'VERSION'), 'utf8')).trim());
});

test('shared bump and the legacy macOS entry point update both platforms while preserving Windows identities', async () => {
  const root = await mkdtemp(join(tmpdir(), 'artype-version-'));
  try {
    for (const path of [...versionFiles, 'scripts/bump-version.sh', 'macos/scripts/increment-version.sh']) {
      await mkdir(dirname(join(root, path)), {recursive: true});
      await copyFile(join(repository, path), join(root, path));
    }
    for (const [script, version] of [['scripts/bump-version.sh', '2.3.4'], ['macos/scripts/increment-version.sh', '2.3.5']]) {
      const result = spawnSync('bash', [join(root, script), version], {cwd: tmpdir(), encoding: 'utf8'});
      assert.equal(result.status, 0, result.stderr);
      await assertVersion(root, version);
    }
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
