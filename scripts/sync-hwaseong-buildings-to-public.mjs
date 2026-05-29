import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const sourceDir = path.join(repoRoot, 'data', 'processed', 'hwaseong_buildings_v1_by_admdong');
const sourceMeta = path.join(repoRoot, 'data', 'processed', 'hwaseong_buildings_v1_meta.json');
const targetRoot = path.join(repoRoot, 'apps', 'web', 'public', 'data', 'buildings');
const targetDir = path.join(targetRoot, 'hwaseong_buildings_v1_by_admdong');
const targetMeta = path.join(targetRoot, 'hwaseong_buildings_v1_meta.json');

async function assertReadablePath(targetPath, label) {
  try {
    await stat(targetPath);
  } catch {
    throw new Error(`${label}을 찾지 못했습니다: ${path.relative(repoRoot, targetPath)}`);
  }
}

await assertReadablePath(sourceDir, '행정동 분할 건물 데이터 폴더');
await assertReadablePath(path.join(sourceDir, 'index.json'), '행정동 분할 건물 index.json');
await assertReadablePath(sourceMeta, '화성시 건물 메타데이터');

async function copyFileIfChanged(sourcePath, targetPath) {
  const sourceStats = await stat(sourcePath);

  try {
    const targetStats = await stat(targetPath);

    if (targetStats.size === sourceStats.size) {
      return;
    }
  } catch {
    // Missing target files are copied below.
  }

  await copyFile(sourcePath, targetPath);
}

async function syncDirectory(sourcePath, targetPath) {
  await mkdir(targetPath, { recursive: true });

  const entries = await readdir(sourcePath, { withFileTypes: true });

  for (const entry of entries) {
    const nextSourcePath = path.join(sourcePath, entry.name);
    const nextTargetPath = path.join(targetPath, entry.name);

    if (entry.isDirectory()) {
      await syncDirectory(nextSourcePath, nextTargetPath);
      continue;
    }

    await copyFileIfChanged(nextSourcePath, nextTargetPath);
  }
}

await mkdir(targetRoot, { recursive: true });
await syncDirectory(sourceDir, targetDir);
await copyFileIfChanged(sourceMeta, targetMeta);

const copiedFiles = await readdir(sourceDir);
const geoJsonCount = copiedFiles.filter((file) => file.toLowerCase().endsWith('.geojson')).length;

console.log(`Synced ${geoJsonCount.toLocaleString('ko-KR')} GeoJSON files plus index.json.`);
console.log(`Target: ${path.relative(repoRoot, targetDir)}`);
console.log(`Meta: ${path.relative(repoRoot, targetMeta)}`);
