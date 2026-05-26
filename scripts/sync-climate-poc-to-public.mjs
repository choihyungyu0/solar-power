import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const pocId = 'L1_41110_065203';
const filesToCopy = ['bundle.json', 'panels_4326.geojson'];

const sourceDir = path.join(repoRoot, 'data', 'processed', 'poc', pocId);
const targetDir = path.join(repoRoot, 'apps', 'web', 'public', 'data', 'climate-poc', pocId);

async function assertReadableFile(filePath) {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      throw new Error('Path is not a file');
    }
  } catch (error) {
    throw new Error(`Missing climate POC source file: ${path.relative(repoRoot, filePath)}`, {
      cause: error,
    });
  }
}

for (const fileName of filesToCopy) {
  await assertReadableFile(path.join(sourceDir, fileName));
}

await mkdir(targetDir, { recursive: true });

for (const fileName of filesToCopy) {
  await copyFile(path.join(sourceDir, fileName), path.join(targetDir, fileName));
}

console.log(`Synced climate POC ${pocId}.`);
console.log(`Target: ${path.relative(repoRoot, targetDir)}`);
console.log(`Files: ${filesToCopy.join(', ')}`);
