import fs from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  parseSpiceDBSchema,
  type ObjectTypeDefinition,
  type PermissionDeclaration,
  type PermissionExpression,
  type RelationDeclaration,
  type SchemaAST,
} from './parser'

const schema1 = fs.readFileSync(
  new URL('../fixtures/001-schema.zed', import.meta.url),
  'utf-8',
)

const schema2 = fs.readFileSync(
  new URL('../fixtures/002-schema.zed', import.meta.url),
  'utf-8',
)

// Helper Functions
function findDefinition(ast: SchemaAST, name: string): ObjectTypeDefinition {
  const def = ast.definitions.find(d => d.name === name)
  if (!def) throw new Error(`Definition '${name}' not found`)
  if (def.type !== 'definition')
    throw new Error(`'${name}' is not an ObjectTypeDefinition`)
  return def as ObjectTypeDefinition
}

function findRelation(
  def: ObjectTypeDefinition,
  name: string,
): RelationDeclaration {
  const rel = def.relations.find(r => r.name === name)
  if (!rel)
    throw new Error(`Relation '${name}' not found in definition '${def.name}'`)
  return rel
}

function findPermission(
  def: ObjectTypeDefinition,
  name: string,
): PermissionDeclaration {
  const perm = def.permissions.find(p => p.name === name)
  if (!perm)
    throw new Error(
      `Permission '${name}' not found in definition '${def.name}'`,
    )
  return perm
}

function assertRelationTypes(
  relation: RelationDeclaration,
  expectedTypes: Array<{
    typeName: string
    wildcard?: boolean
    relation?: string
  }>,
) {
  expect(relation.types.length).toBe(expectedTypes.length)
  expectedTypes.forEach(expectedType => {
    expect(relation.types).toEqual(
      expect.arrayContaining([expect.objectContaining(expectedType)]),
    )
  })
}

function assertRelationDocComment(
  relation: RelationDeclaration,
  expectedDocComment?: string,
) {
  if (expectedDocComment !== undefined) {
    expect(relation.docComment).toBe(expectedDocComment)
  } else {
    expect(relation.docComment).toBeUndefined()
  }
}

function stringifyPermissionExpression(expr?: PermissionExpression): string {
  if (!expr) return ''
  switch (expr.type) {
    case 'identifier':
      return expr.name
    case 'union':
      return expr.operands.map(stringifyPermissionExpression).join(' + ')
    case 'intersection':
      return expr.operands.map(stringifyPermissionExpression).join(' & ')
    case 'exclusion':
      // Chevrotain CST visitor for exclusion might always produce left/right.
      // If it can be unary (e.g. `nil - something`), this needs adjustment.
      // Based on SpiceDB grammar, exclusion is binary.
      return `${stringifyPermissionExpression(expr.left)} - ${stringifyPermissionExpression(expr.right)}`
    case 'arrow':
      return `${stringifyPermissionExpression(expr.left)}->${expr.target}`
    // TODO: Add 'any' and 'all' if they appear in 001-schema.zed
    // For 001-schema.zed, these are not used.
    default:
      // console.error('Unknown permission expression for stringify:', expr)
      throw new Error(
        `Unknown permission expression type: ${(expr as any).type}`,
      )
  }
}

function assertPermissionExpression(
  permission: PermissionDeclaration,
  expectedExpression: string,
) {
  expect(stringifyPermissionExpression(permission.expression)).toBe(
    expectedExpression,
  )
}

function assertPermissionDocComment(
  permission: PermissionDeclaration,
  expectedDocComment?: string,
) {
  if (expectedDocComment !== undefined) {
    expect(permission.docComment).toBe(expectedDocComment)
  } else {
    expect(permission.docComment).toBeUndefined()
  }
}

describe('parseSpiceDBSchema for 001-schema.zed', () => {
  let ast: SchemaAST

  beforeAll(() => {
    const result = parseSpiceDBSchema(schema1)
    if (result.errors.length > 0) {
      console.error('Parser errors:', result.errors)
      throw new Error(
        `Schema parsing failed: ${result.errors.map(e => e.message).join(', ')}`,
      )
    }
    if (!result.ast) {
      throw new Error('AST was not generated after parsing')
    }
    ast = result.ast
  })

  it('should parse all top-level definitions', () => {
    expect(ast.definitions.length).toEqual(5)
    const definitionNames = ast.definitions.map(d => d.name).sort()
    expect(definitionNames).toEqual([
      'group_a',
      'group_b',
      'resource_type_a',
      'resource_type_b',
      'user',
    ])
  })

  describe('user definition', () => {
    it('should parse correctly', () => {
      const userDef = findDefinition(ast, 'user')
      expect(userDef.relations).toEqual([])
      expect(userDef.permissions).toEqual([])
      expect(userDef.docComment).toBeUndefined()
    })
  })

  describe('resource_type_a definition', () => {
    let def: ObjectTypeDefinition
    beforeAll(() => {
      def = findDefinition(ast, 'resource_type_a')
    })

    it('should parse relations correctly', () => {
      assertRelationTypes(findRelation(def, 'primary_accessor'), [
        { typeName: 'user' },
      ])
      assertRelationTypes(findRelation(def, 'secondary_accessor'), [
        { typeName: 'user' },
      ])
      assertRelationTypes(findRelation(def, 'tertiary_accessor'), [
        { typeName: 'user' },
      ])
      assertRelationTypes(findRelation(def, 'general_user'), [
        { typeName: 'user', wildcard: true },
      ])
      assertRelationTypes(findRelation(def, 'member_of_group'), [
        { typeName: 'group_a' },
      ])
      assertRelationTypes(findRelation(def, 'initiator'), [
        { typeName: 'user' },
      ])
    })

    it('should parse permissions correctly', () => {
      assertPermissionExpression(
        findPermission(def, 'can_modify'),
        'primary_accessor + secondary_accessor',
      )
      assertPermissionExpression(
        findPermission(def, 'can_access'),
        'primary_accessor + secondary_accessor + tertiary_accessor + general_user + initiator + member_of_group->can_access',
      )
      assertPermissionExpression(
        findPermission(def, 'can_list'),
        'primary_accessor + secondary_accessor + tertiary_accessor + initiator + member_of_group->can_access',
      )
      assertPermissionExpression(
        findPermission(def, 'is_shared'),
        'secondary_accessor + tertiary_accessor',
      )
    })

    it('should not have doc comments on definition, relations or permissions', () => {
      expect(def.docComment).toBeUndefined()
      def.relations.forEach(rel => expect(rel.docComment).toBeUndefined())
      def.permissions.forEach(perm =>
        expect(perm.docComment).toBeUndefined(),
      )
    })
  })

  describe('resource_type_b definition', () => {
    let def: ObjectTypeDefinition
    beforeAll(() => {
      def = findDefinition(ast, 'resource_type_b')
    })

    it('should parse relations correctly', () => {
      assertRelationTypes(findRelation(def, 'primary_accessor'), [{ typeName: 'user' }])
      assertRelationTypes(findRelation(def, 'secondary_accessor'), [
        { typeName: 'user' },
      ])
      assertRelationTypes(findRelation(def, 'tertiary_accessor'), [
        { typeName: 'user' },
      ])
      assertRelationTypes(findRelation(def, 'general_user'), [
        { typeName: 'user', wildcard: true },
      ])
      assertRelationTypes(findRelation(def, 'member_of_group'), [
        { typeName: 'group_a' },
      ])
    })

    it('should parse permissions correctly', () => {
      assertPermissionExpression(
        findPermission(def, 'can_modify'),
        'primary_accessor + secondary_accessor',
      )
      assertPermissionExpression(
        findPermission(def, 'can_access'),
        'primary_accessor + secondary_accessor + tertiary_accessor + general_user + member_of_group->can_access',
      )
      assertPermissionExpression(
        findPermission(def, 'can_list'),
        'primary_accessor + secondary_accessor + tertiary_accessor + member_of_group->can_access',
      )
      assertPermissionExpression(
        findPermission(def, 'is_shared'),
        'secondary_accessor + tertiary_accessor',
      )
    })

    it('should not have doc comments on definition, relations or permissions', () => {
      expect(def.docComment).toBeUndefined()
      def.relations.forEach(rel => expect(rel.docComment).toBeUndefined())
      def.permissions.forEach(perm =>
        expect(perm.docComment).toBeUndefined(),
      )
    })
  })

  describe('group_a definition', () => {
    let def: ObjectTypeDefinition
    beforeAll(() => {
      def = findDefinition(ast, 'group_a')
    })

    it('should parse relations correctly', () => {
      assertRelationTypes(findRelation(def, 'primary_accessor'), [
        { typeName: 'user' },
      ])
      assertRelationTypes(findRelation(def, 'secondary_accessor'), [
        { typeName: 'user' },
      ])
      assertRelationTypes(findRelation(def, 'tertiary_accessor'), [
        { typeName: 'user' },
      ])
      assertRelationTypes(findRelation(def, 'group_manager'), [
        { typeName: 'group_b' },
      ])
    })

    it('should parse permissions correctly', () => {
      assertPermissionExpression(
        findPermission(def, 'can_modify'),
        'primary_accessor + secondary_accessor + group_manager->can_manage',
      )
      assertPermissionExpression(
        findPermission(def, 'can_access'),
        'primary_accessor + secondary_accessor + tertiary_accessor + group_manager->can_use_shared_assets + group_manager->can_manage',
      )
      assertPermissionExpression(
        findPermission(def, 'is_shared'),
        'secondary_accessor + tertiary_accessor',
      )
    })

    it('should not have doc comments on definition or permissions', () => {
      expect(def.docComment).toBeUndefined()
      def.permissions.forEach(perm =>
        expect(perm.docComment).toBeUndefined(),
      )
    })
  })

  describe('group_b definition', () => {
    let def: ObjectTypeDefinition
    beforeAll(() => {
      def = findDefinition(ast, 'group_b')
    })
    it('should parse relations correctly', () => {
      assertRelationTypes(findRelation(def, 'admin'), [
        { typeName: 'user' },
      ])
      assertRelationTypes(findRelation(def, 'type_a_user'), [
        { typeName: 'user' },
      ])
      assertRelationTypes(findRelation(def, 'type_b_user'), [
        { typeName: 'user' },
      ])
      assertRelationTypes(findRelation(def, 'parent_group'), [
        { typeName: 'group_b' },
      ])
      assertRelationTypes(findRelation(def, 'child_group'), [
        { typeName: 'group_b' },
      ])
    })

    it('should parse permissions correctly', () => {
      assertPermissionExpression(
        findPermission(def, 'can_use_shared_assets'),
        'type_a_user + child_group->can_use_shared_assets + can_manage',
      )
      assertPermissionExpression(
        findPermission(def, 'can_manage'),
        'admin + parent_group->can_manage',
      )
    })

    it('should not have a doc comment on the definition itself', () => {
      expect(def.docComment).toBeUndefined()
    })
  })
})

describe('parseSpiceDBSchema for 002-schema.zed', () => {
  it('parses the minimal org/folder/document schema (fixture 2) without error', () => {
    let result
    expect(() => {
      result = parseSpiceDBSchema(schema2)
    }).not.toThrow()
    expect(result).toBeDefined()
  })
})
