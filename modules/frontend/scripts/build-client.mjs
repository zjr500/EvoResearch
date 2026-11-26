import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const { name } = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
await build({
  absWorkingDir: fileURLToPath(root),
  entryPoints: ['src/client/index.jsx'],
  outfile: 'dist/client.js',
  bundle: true, format: 'cjs', platform: 'browser', target: 'es2022', jsx: 'automatic',
  external: ['react', 'react/jsx-runtime'],
  sourcemap: true,
  banner: { js: `window.__ModuleLoader__.load({id:${JSON.stringify(name)}, factory:(require)=>{var module={exports:{}};var exports=module.exports;` },
  footer: { js: 'return module.exports;}});' },
})
console.log('DSH client bundle built in dist/client.js')
