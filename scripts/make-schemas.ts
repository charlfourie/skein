/**
 * Regenerate the published JSON Schemas in schemas/.
 * Usage: npm run make:schemas
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { jsonSchemas } from '../src/shared/jsonSchemas'

const schemas = jsonSchemas()
mkdirSync('schemas', { recursive: true })
// Older versions stay published only through git history; the folder holds the current ones.
for (const f of readdirSync('schemas')) if (f.endsWith('.json') && !(f in schemas)) rmSync(`schemas/${f}`)
for (const [file, text] of Object.entries(schemas)) writeFileSync(`schemas/${file}`, text)
console.log(`Wrote ${Object.keys(schemas).join(', ')} to schemas/`)
