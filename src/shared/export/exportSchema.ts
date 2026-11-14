// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Charl Fourie. See runtimes/LICENSE.
/**
 * The game export format as a schema (zod), mirroring types.ts. Used to
 * publish schemas/skein.export.v4.json, and by tests to check every export the
 * editor writes. Strict: an export with a field this schema doesn't know is an
 * error, so the published schema can't quietly fall behind the format.
 */
import { z } from 'zod'
import { EXPORT_FORMAT, EXPORT_VERSION } from './types'

const Value = z.union([z.number(), z.boolean(), z.string(), z.null()])

const StatePath = z.union([
  z.object({ get: z.literal('var'), var: z.string() }).strict(),
  z.object({ get: z.literal('prop'), entity: z.string(), prop: z.string() }).strict(),
  z.object({ get: z.literal('rel'), rel: z.string(), from: z.string(), to: z.string() }).strict(),
  z.object({ get: z.literal('time'), field: z.enum(['day', 'phase', 'hour', 'minute']) }).strict(),
  z.object({ get: z.literal('visit'), node: z.string() }).strict()
])

const OPS = ['and', 'or', '==', '!=', '<', '<=', '>', '>=', 'phase<', 'phase<=', 'phase>', 'phase>=', '+', '-', '*', '/'] as const

export type ExprShape =
  | { lit: z.infer<typeof Value> }
  | z.infer<typeof StatePath>
  | { not: ExprShape }
  | { neg: ExprShape }
  | { chance: number }
  | { roll: [number, number] }
  | { op: (typeof OPS)[number]; a: ExprShape; b: ExprShape }

const Expr: z.ZodType<ExprShape> = z.lazy(() =>
  z.union([
    z.object({ lit: Value }).strict(),
    StatePath,
    z.object({ not: Expr }).strict(),
    z.object({ neg: Expr }).strict(),
    z.object({ chance: z.number() }).strict(),
    z.object({ roll: z.tuple([z.number(), z.number()]) }).strict(),
    z.object({ op: z.enum(OPS), a: Expr, b: Expr }).strict()
  ])
)

const Statement = z.union([
  z.object({ set: StatePath, op: z.enum(['=', '+=', '-=']), value: Expr }).strict(),
  z.object({ advance: z.number() }).strict(),
  z.object({ advanceTo: z.string(), stay: z.literal(true).optional() }).strict(),
  z.object({ pass: z.number() }).strict()
])

const Condition = z.object({ expr: Expr, source: z.string().optional() }).strict()
const Effects = z.object({ do: z.array(Statement), source: z.string().optional() }).strict()

const defShape = {
  type: z.enum(['text', 'number', 'boolean', 'enum', 'entity', 'color']),
  default: Value,
  options: z.array(z.string()).optional(),
  labels: z.array(z.string()).optional(),
  template: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  integer: z.literal(true).optional()
}

const nodeBase = {
  id: z.string(),
  start: z.literal(true).optional(),
  end: z.literal(true).optional(),
  requires: Condition.optional(),
  effects: Effects.optional(),
  count: z.literal(true).optional(),
  tag: z.string().optional(),
  takes: z.number().optional(),
  activity: z.string().optional()
}

const Choice = z
  .object({
    id: z.string(),
    text: z.string().optional(),
    line: z.string().optional(),
    vars: z.record(Expr).optional(),
    requires: Condition.optional(),
    count: z.literal(true).optional()
  })
  .strict()

const Node = z.discriminatedUnion('type', [
  z
    .object({
      ...nodeBase,
      type: z.literal('dialogue'),
      speaker: z.string().nullable(),
      text: z.string(),
      menuText: z.string().optional(),
      next: z.array(z.string()),
      line: z.string().optional(),
      menuLine: z.string().optional(),
      vars: z.record(Expr).optional(),
      choices: z.array(Choice.nullable()).optional()
    })
    .strict(),
  z.object({ ...nodeBase, type: z.literal('condition'), condition: Condition.nullable(), onTrue: z.string().nullable(), onFalse: z.string().nullable() }).strict(),
  z.object({ ...nodeBase, type: z.literal('instruction'), instruction: Effects.nullable(), next: z.array(z.string()) }).strict(),
  z
    .object({ ...nodeBase, type: z.literal('hub'), label: z.string(), next: z.array(z.string()), ask: z.literal(true).optional(), fallback: z.string().optional(), choices: z.array(Choice.nullable()).optional() })
    .strict(),
  z.object({ ...nodeBase, type: z.literal('jump'), jumpTo: z.string().nullable(), jumpFlow: z.string().optional() }).strict(),
  z.object({ ...nodeBase, type: z.literal('call'), flow: z.string().nullable(), next: z.array(z.string()) }).strict()
])

export const ExportFileSchema = z
  .object({
    format: z.literal(EXPORT_FORMAT),
    version: z.number().int().min(1).max(EXPORT_VERSION),
    project: z.object({ id: z.string(), name: z.string() }).strict(),
    templates: z.record(
      z.object({ id: z.string(), name: z.string(), properties: z.record(z.object({ ...defShape, state: z.literal(true).optional() }).strict()) }).strict()
    ),
    entities: z.record(z.object({ id: z.string(), name: z.string(), template: z.string(), values: z.record(Value) }).strict()),
    state: z
      .object({
        variables: z.record(z.object({ ...defShape, hud: z.literal(true).optional() }).strict()),
        relationships: z.record(
          z.object({ ...defShape, name: z.string(), from: z.string(), to: z.string(), values: z.record(z.record(Value)) }).strict()
        ),
        time: z
          .object({
            phases: z.array(z.string()),
            labels: z.array(z.string()),
            start: z.object({ day: z.number(), phase: z.string().nullable(), minute: z.number().optional() }).strict(),
            minutes: z.array(z.number()).optional(),
            dayStart: z.number().optional()
          })
          .strict(),
        rules: z.array(
          z
            .object({
              id: z.string(),
              name: z.string(),
              trigger: z.enum(['phase', 'day']),
              phase: z.string().nullable(),
              forEach: z.string().nullable(),
              flow: z.string().nullable().optional(),
              when: Condition.optional(),
              effects: Effects
            })
            .strict()
        )
      })
      .strict(),
    flows: z.record(z.object({ id: z.string(), name: z.string(), start: z.array(z.string()), nodes: z.record(Node) }).strict())
  })
  .strict()
