import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const { name } = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
const debug = process.argv.includes('--debug')
await build({
  absWorkingDir: fileURLToPath(root),
  entryPoints: ['src/client/index.jsx'],
  outfile: 'dist/client.js',
  bundle: true, format: 'cjs', platform: 'browser', target: 'es2022', jsx: 'automatic',
  external: ['react', 'react/jsx-runtime'],
  alias: { '#debug-panel': fileURLToPath(new URL(`src/client/debug/${debug ? 'enabled' : 'disabled'}.js`, root)) },
  sourcemap: true,
  banner: { js: `window.__ModuleLoader__.load({id:${JSON.stringify(name)}, factory:(require)=>{var module={exports:{}};var exports=module.exports;` },
  footer: { js: 'return module.exports;}});' },
})
console.log(`DSH ${debug ? 'local debug' : 'standard'} client bundle built in dist/client.js`)
