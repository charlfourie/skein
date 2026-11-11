/**
 * The published JSON Schemas (schemas/*.json), generated from the same zod
 * definitions the editor and the exporter use, so they can't drift. Regenerate
 * with `npm run make:schemas`; a test fails when the committed files are stale.
 * Not used by the app itself.
 */
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { ExportFileSchema } from './export/exportSchema'
import { EXPORT_VERSION } from './export/types'
import { FLOW_FORMAT } from './projectFiles'
import { FlowSchema, ProjectSchema, SCHEMA_VERSION, StoryTestSchema } from './schema'
import { serializeCanonical } from './serialize'

const BASE = 'https://raw.githubusercontent.com/charlfourie/skein/main/schemas'

function publish(file: string, title: string, description: string, schema: z.ZodTypeAny): [string, string] {
  const json = zodToJsonSchema(schema, { target: 'jsonSchema7', $refStrategy: 'root', definitionPath: 'definitions' }) as Record<string, unknown>
  return [file, serializeCanonical({ ...json, $id: `${BASE}/${file}`, title, description })]
}

export function jsonSchemas(): Record<string, string> {
  const flowFile = FlowSchema.extend({ format: z.literal(FLOW_FORMAT), tests: z.record(StoryTestSchema).optional() })
  return Object.fromEntries([
    publish(
      `skein.project.v${SCHEMA_VERSION}.json`,
      'Skein project',
      `A Skein project (format "skein.project", version ${SCHEMA_VERSION}): a single .skein.json file, or the project.json of a project folder (whose flows are in flows/*.json).`,
      ProjectSchema
    ),
    publish(
      `skein.flow.v${SCHEMA_VERSION}.json`,
      'Skein flow file',
      `One flow of a project folder (flows/<name>.<id>.json), with the story tests for it. Project format version ${SCHEMA_VERSION}.`,
      flowFile
    ),
    publish(
      `skein.export.v${EXPORT_VERSION}.json`,
      'Skein game export',
      `The file games read (format "skein.export", versions 1 to ${EXPORT_VERSION}). See docs/EXPORT.md for how a story runs.`,
      ExportFileSchema
    )
  ])
}
