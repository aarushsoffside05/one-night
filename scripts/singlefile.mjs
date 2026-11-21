// Makes dist/one-night.html: the whole game in one self-contained file (code, workers, models).
// It inlines the built script and style into the page. Workers are already inside the script as
// Blob-URL bundles (Vite ?worker&inline), since module workers do not load from a double-clicked file.
import fs from 'node:fs'
import path from 'node:path'
const dist = 'dist'
let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8')
const assets = fs.readdirSync(path.join(dist, 'assets'))
const js = assets.filter((f) => f.endsWith('.js'))
if (js.length !== 1) { console.error('expected exactly one script chunk, got', js); process.exit(1) }
html = html.replace(/<script type="module"[^>]*src="[^"]+"[^>]*><\/script>/, () =>
  `<script type="module">${fs.readFileSync(path.join(dist, 'assets', js[0]), 'utf8').replace(/<\/script/g, '<\\/script')}</script>`)
html = html.replace(/<link rel="stylesheet"[^>]*href="[^"]+"[^>]*>/, () => {
  const css = assets.filter((f) => f.endsWith('.css')).map((f) => fs.readFileSync(path.join(dist, 'assets', f), 'utf8')).join('\n')
  return `<style>${css}</style>`
})
html = html.replace(/<link rel="modulepreload"[^>]*>/g, '')
if (/(src|href)="\.\/assets\//.test(html)) { console.error('single file still points at ./assets'); process.exit(1) }
fs.writeFileSync(path.join(dist, 'one-night.html'), html)
const kb = (f) => (fs.statSync(f).size / 1024).toFixed(0)
const gz = (await import('node:zlib')).gzipSync(html).length
console.log(`dist/one-night.html ${kb(path.join(dist, 'one-night.html'))} KB (${(gz / 1024).toFixed(0)} KB gzipped)`)
fs.writeFileSync(path.join(dist, 'size.txt'), `one-night.html ${kb(path.join(dist, 'one-night.html'))} KB raw, ${(gz / 1024).toFixed(0)} KB gzipped\n`)
