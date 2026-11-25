import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { build } from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const ENTRY_FILE = path.join(ROOT_DIR, 'server', 'vercelHandler.ts');
const OUT_FILE = path.join(ROOT_DIR, 'api', '_server.mjs');

async function buildVercelServerlessBundle() {
  if (!fs.existsSync(ENTRY_FILE)) {
    throw new Error(`Missing serverless entry file: ${ENTRY_FILE}`);
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });

  const result = await build({
    entryPoints: [ENTRY_FILE],
    outfile: OUT_FILE,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    packages: 'external',
    external: ['vite'],
    sourcemap: false,
    minify: false,
    metafile: true,
    logLevel: 'info',
    banner: {
      js: [
        '// Auto-generated deployable Vercel Serverless ESM bundle for MoraJaws.',
        '// Source: server/vercelHandler.ts -> server.ts -> server/**/*.ts',
        "import { createRequire as __moraCreateRequire } from 'node:module';",
        'const require = __moraCreateRequire(import.meta.url);'
      ].join('\n')
    }
  });

  if (result.errors && result.errors.length > 0) {
    throw new Error(`esbuild reported ${result.errors.length} error(s)`);
  }

  const bundleText = fs.readFileSync(OUT_FILE, 'utf8');

  // Verify zero unresolved local .ts imports remain in the output JavaScript bundle
  const localTsImportRegex = /(?:from|import)\s*['"](\.\.?\/[^'"]+\.ts)['"]/g;
  const leftoverTsImports = [...bundleText.matchAll(localTsImportRegex)].map(m => m[1]);
  if (leftoverTsImports.length > 0) {
    throw new Error(
      `Bundle verification failed: found unresolved local .ts imports in ${OUT_FILE}: ${leftoverTsImports.join(', ')}`
    );
  }

  const sizeKb = (Buffer.byteLength(bundleText, 'utf8') / 1024).toFixed(1);
  console.log(`[build_vercel_api] Bundled ${path.relative(ROOT_DIR, OUT_FILE)} (${sizeKb} KB) cleanly with 0 .ts imports.`);
}

buildVercelServerlessBundle().catch((err) => {
  console.error('[build_vercel_api] Failed:', err);
  process.exit(1);
});
