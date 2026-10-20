import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { z } from 'zod';
import { fail } from './errors.js';

const manifestSchema = z.object({ files: z.array(z.object({
  filename: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*\.(dmg|exe)$/),
  platform: z.enum(['macos-arm64', 'windows-x64']),
  version: z.string().min(1).max(60),
  signing: z.enum(['signed', 'unsigned-validation']),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size_bytes: z.number().int().positive(),
  service_url: z.url(),
}).strict()).max(20) }).strict();

async function publishedFiles(config) {
  if (!config.downloadDirectory) return [];
  let content;
  try {
    content = await readFile(resolve(config.downloadDirectory, 'manifest.json'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  let files;
  try {
    files = manifestSchema.parse(JSON.parse(content)).files;
  } catch {
    fail(503, 'downloads_unavailable', 'Список установщиков повреждён. Обратитесь к администратору платформы.');
  }
  return files.map(file => ({ ...file, url: '/downloads/' + file.filename }));
}

export function installDownloads(app, { config, auth }) {
  app.get('/api/downloads', async (req, res) => res.json({ files: await publishedFiles(config) }));
  app.get('/downloads/:filename', auth, async (req, res) => {
    const file = (await publishedFiles(config)).find(candidate => candidate.filename === req.params.filename);
    if (!file) fail(404, 'download_missing', 'Установщик не опубликован.');
    const root = await realpath(config.downloadDirectory);
    let path;
    try {
      path = await realpath(resolve(root, file.filename));
    } catch (error) {
      if (error.code === 'ENOENT') fail(404, 'download_missing', 'Файл установщика отсутствует.');
      throw error;
    }
    if (!path.startsWith(root + sep)) fail(404, 'download_missing', 'Установщик недоступен.');
    const info = await stat(path);
    if (!info.isFile() || info.size !== file.size_bytes) {
      fail(503, 'download_invalid', 'Установщик повреждён. Обратитесь к администратору платформы.');
    }
    res.download(path, file.filename);
  });
}
