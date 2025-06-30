import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseSpiceDBSchema } from '../schema-parser/parser'
import { analyzeSpiceDbSchema } from './analyzer'

const schema1 = fs.readFileSync(
  new URL('../fixtures/001-schema.zed', import.meta.url),
  'utf-8',
)

const schema2 = fs.readFileSync(
  new URL('../fixtures/002-schema.zed', import.meta.url),
  'utf-8',
)

describe('SpiceDB Schema Analyzer', () => {
  it('analyzes 001-schema correctly', () => {
    const { ast } = parseSpiceDBSchema(schema1)
    if (!ast) {
      throw new Error('AST is undefined')
    }
    const result = analyzeSpiceDbSchema(ast)

    if (!result.isValid) {
      console.error('Errors:', result.errors)
      console.error('Warnings:', result.warnings)
    }

    expect(result.isValid).toBe(true)
    expect(result.errors.length).toBe(0)
    expect(result.warnings.length).toBe(4)
    expect(result.augmentedAst).toBeDefined()
    expect(result.symbolTable).toBeDefined()
  })

  it('analyzes 002-schema correctly', () => {
    const { ast } = parseSpiceDBSchema(schema2)
    if (!ast) {
      throw new Error('AST is undefined')
    }
    const result = analyzeSpiceDbSchema(ast)

    if (!result.isValid) {
      console.error('Errors:', result.errors)
      console.error('Warnings:', result.warnings)
    }

    expect(result.isValid).toBe(true)
    expect(result.errors.length).toBe(0)
    expect(result.warnings.length).toBe(1)
    expect(result.augmentedAst).toBeDefined()
    expect(result.symbolTable).toBeDefined()
  })
})
