// Fails a commit if any image outside shots/ is staged, or if a staged file's
// name matches a picture in the reference library (which must never be committed).
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
const staged = execSync('git diff --cached --name-only --diff-filter=ACMR').toString().split('\n').filter(Boolean);
const img = /\.(png|jpe?g|webp|gif|bmp|tiff?|avif|heic|psd|exr|hdr|ktx2?|svg)$/i;
const bad = staged.filter((f) => img.test(f) && !f.startsWith('shots/'));
const libs = ['/home/user/pack/2026-11-21-amazon-pack/08-junior-eos/library/library.json', '/home/user/pack/2026-11-21-amazon-pack/03-eos/library.json', '08-junior-eos/library/library.json'];
const names = new Set();
for (const l of libs) if (existsSync(l)) for (const m of readFileSync(l, 'utf8').matchAll(/"([^"\/]+\.(?:jpe?g|png|webp))"/gi)) names.add(m[1].toLowerCase());
const lib = staged.filter((f) => names.has(basename(f).toLowerCase()));
const pack = staged.filter((f) => /(^|\/)(0[1-8]-(story|truth|eos|look|technique|bar|studio|junior-eos))\//.test(f) || /amazon-pack/.test(f) || /\.zip$/i.test(f));
if (bad.length || lib.length || pack.length) {
  console.error('COMMIT BLOCKED\n images outside shots/: ' + bad.join(', ') + '\n library file names: ' + lib.join(', ') + '\n pack files: ' + pack.join(', '));
  process.exit(1);
}
console.log(`staged check ok (${staged.length} files, ${names.size} library names known)`);
