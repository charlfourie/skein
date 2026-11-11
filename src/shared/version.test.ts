import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { EXPORT_VERSION } from './export/types'
import { SCHEMA_VERSION } from './schema'
import { SKEIN_VERSION } from './version'

describe('versions', () => {
  it('the app version matches package.json, and the docs list the current formats', () => {
    expect(JSON.parse(readFileSync('package.json', 'utf8')).version).toBe(SKEIN_VERSION)
    const policy = readFileSync('docs/VERSIONING.md', 'utf8')
    expect(policy).toContain(`| ${SKEIN_VERSION} | ${SCHEMA_VERSION} | ${EXPORT_VERSION} |`)
  })
})
