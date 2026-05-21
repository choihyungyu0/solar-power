import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
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

await mkdir(targetRoot, { recursive: true });
await rm(targetDir, { recursive: true, force: true });
await cp(sourceDir, targetDir, { recursive: true });
await cp(sourceMeta, targetMeta);

const copiedFiles = await readdir(targetDir);
const geoJsonCount = copiedFiles.filter((file) => file.toLowerCase().endsWith('.geojson')).length;

console.log(`Synced ${geoJsonCount.toLocaleString('ko-KR')} GeoJSON files plus index.json.`);
console.log(`Target: ${path.relative(repoRoot, targetDir)}`);
console.log(`Meta: ${path.relative(repoRoot, targetMeta)}`);
