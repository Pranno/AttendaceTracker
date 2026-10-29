import { build } from 'esbuild'
await build({ entryPoints: ['scripts/diag-entry.ts'], bundle: true, format: 'esm', outfile: '/tmp/diag.mjs', platform: 'node', logLevel: 'silent' })
await import('/tmp/diag.mjs')
