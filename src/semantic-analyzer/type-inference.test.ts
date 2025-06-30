import { describe, expect, it } from 'vitest'
import {
  ObjectTypeDefinition,
  parseSpiceDBSchema,
  SchemaAST,
} from '../schema-parser/parser'
import { analyzeSpiceDbSchema } from './analyzer'
import { SymbolTable } from './symbol-table'
import { TypeInferenceEngine } from './type-inference'

describe('Type Inference in Augmented AST', () => {
  it('should infer types for a permission referencing a simple relation', () => {
    const schema = `
      definition user {}
      definition document {
        relation viewer: user
        permission view = viewer
      }
    `
    const { ast } = parseSpiceDBSchema(schema)
    if (!ast) throw new Error('AST is undefined')
    const result = analyzeSpiceDbSchema(ast)

    expect(result.isValid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.augmentedAst).toBeDefined()

    const docDef = result.augmentedAst?.definitions.find(
      d => d.name === 'document' && d.type === 'definition',
    ) as any // AugmentedObjectTypeDefinition
    expect(docDef).toBeDefined()
    const viewPerm = docDef.permissions.find((p: any) => p.name === 'view')
    expect(viewPerm).toBeDefined()
    expect(viewPerm.inferredSubjectTypes).toEqual([{ typeName: 'user' }])
  })

  it('should infer types for a permission referencing another permission', () => {
    const schema = `
      definition user {}
      definition document {
        relation editor: user
        permission edit = editor
        permission view = edit
      }
    `
    const { ast } = parseSpiceDBSchema(schema)
    if (!ast) throw new Error('AST is undefined')
    const result = analyzeSpiceDbSchema(ast)

    expect(result.isValid).toBe(true)
    expect(result.errors).toHaveLength(0)
    const docDef = result.augmentedAst?.definitions.find(
      d => d.name === 'document' && d.type === 'definition',
    ) as any
    const viewPerm = docDef.permissions.find((p: any) => p.name === 'view')
    expect(viewPerm.inferredSubjectTypes).toEqual([{ typeName: 'user' }])
  })

  it('should infer types for a permission with a union of relations', () => {
    const schema = `
      definition user {}
      definition group {}
      definition document {
        relation owner: user
        relation collaborator: group
        permission view = owner + collaborator
      }
    `
    const { ast } = parseSpiceDBSchema(schema)
    if (!ast) throw new Error('AST is undefined')
    const result = analyzeSpiceDbSchema(ast)

    expect(result.isValid).toBe(true)
    expect(result.errors).toHaveLength(0)
    const docDef = result.augmentedAst?.definitions.find(
      d => d.name === 'document' && d.type === 'definition',
    ) as any
    const viewPerm = docDef.permissions.find((p: any) => p.name === 'view')
    expect(viewPerm.inferredSubjectTypes).toEqual(
      expect.arrayContaining([{ typeName: 'user' }, { typeName: 'group' }]),
    )
    expect(viewPerm.inferredSubjectTypes).toHaveLength(2)
  })

  it('should infer types for a permission with an intersection of relations', () => {
    const schema = `
      definition user {}
      definition role {
        relation member: user
      }
      definition document {
        relation primary_contact: user
        relation project_lead: role#member
        permission sign_off = primary_contact & project_lead
      }
    `
    // primary_contact is user
    // project_lead is user (from role#member)
    // intersection should be user
    const { ast } = parseSpiceDBSchema(schema)
    if (!ast) throw new Error('AST is undefined')
    const result = analyzeSpiceDbSchema(ast)

    expect(result.isValid).toBe(true)
    expect(result.errors).toHaveLength(0)
    const docDef = result.augmentedAst?.definitions.find(
      d => d.name === 'document' && d.type === 'definition',
    ) as any
    const signOffPerm = docDef.permissions.find(
      (p: any) => p.name === 'sign_off',
    )
    expect(signOffPerm.inferredSubjectTypes).toEqual([{ typeName: 'user' }])
  })

  it('should infer types for a permission with an exclusion (type of left side)', () => {
    const schema = `
      definition user {}
      definition banned_user {}
      definition resource {
        relation all_users: user
        relation banned: banned_user // Different type, won't affect intersection for type inference
        permission access = all_users - banned
      }
    `
    const { ast } = parseSpiceDBSchema(schema)
    if (!ast) throw new Error('AST is undefined')
    const result = analyzeSpiceDbSchema(ast)
    expect(result.isValid).toBe(true)
    expect(result.errors).toHaveLength(0)
    const resourceDef = result.augmentedAst?.definitions.find(
      d => d.name === 'resource' && d.type === 'definition',
    ) as any
    const accessPerm = resourceDef.permissions.find(
      (p: any) => p.name === 'access',
    )
    expect(accessPerm.inferredSubjectTypes).toEqual([{ typeName: 'user' }])
  })

  it('should infer types for an arrow expression', () => {
    const schema = `
      definition user {}
      definition group {
        relation member: user
      }
      definition document {
        relation parent_group: group
        permission view = parent_group->member
      }
    `
    // parent_group is 'group', member on 'group' is 'user'. So view is 'user'.
    const { ast } = parseSpiceDBSchema(schema)
    if (!ast) throw new Error('AST is undefined')
    const result = analyzeSpiceDbSchema(ast)

    expect(result.isValid).toBe(true)
    expect(result.errors).toHaveLength(0)
    const docDef = result.augmentedAst?.definitions.find(
      d => d.name === 'document' && d.type === 'definition',
    ) as any
    const viewPerm = docDef.permissions.find((p: any) => p.name === 'view')
    expect(viewPerm.inferredSubjectTypes).toEqual([{ typeName: 'user' }])
  })

  it('should infer types for an arrow expression targeting a permission', () => {
    const schema = `
      definition user {}
      definition organization {
        relation admin: user
        permission manage = admin
      }
      definition project {
        relation org: organization
        permission edit_project = org->manage
      }
    `
    // org is 'organization', manage on 'organization' is 'admin' (user). So edit_project is 'user'.
    const { ast } = parseSpiceDBSchema(schema)
    if (!ast) throw new Error('AST is undefined')
    const result = analyzeSpiceDbSchema(ast)

    expect(result.isValid).toBe(true)
    expect(result.errors).toHaveLength(0)
    const projectDef = result.augmentedAst?.definitions.find(
      d => d.name === 'project' && d.type === 'definition',
    ) as any
    const editPerm = projectDef.permissions.find(
      (p: any) => p.name === 'edit_project',
    )
    expect(editPerm.inferredSubjectTypes).toEqual([{ typeName: 'user' }])
  })

  it('should handle arrow expression with multiple possible types on left, yielding multiple result types', () => {
    const schema = `
      definition user {}
      definition service_account {}
      definition team {
        relation direct_member: user
        relation service_member: service_account
        permission team_members = direct_member + service_member // team_members is now part of team
      }
      definition resource { // This definition is not strictly needed for the resource_c test but is fine
        relation owner_team: team
        permission access = owner_team->direct_member + owner_team->service_member
      }
      // Removed resource_b as its purpose is now incorporated into the main 'team' definition
      definition resource_c {
          relation current_team: team
          permission effective_access = current_team->team_members // team_members on team is user | service_account
      }
    `
    const { ast } = parseSpiceDBSchema(schema)
    if (!ast) throw new Error('AST is undefined')
    const result = analyzeSpiceDbSchema(ast)

    expect(result.isValid).toBe(true)
    expect(result.errors).toHaveLength(0)

    const resourceCDef = result.augmentedAst?.definitions.find(
      d => d.name === 'resource_c' && d.type === 'definition',
    ) as any
    const effectiveAccessPerm = resourceCDef.permissions.find(
      (p: any) => p.name === 'effective_access',
    )
    expect(effectiveAccessPerm.inferredSubjectTypes).toEqual(
      expect.arrayContaining([
        { typeName: 'user' },
        { typeName: 'service_account' },
      ]),
    )
    expect(effectiveAccessPerm.inferredSubjectTypes).toHaveLength(2)
  })

  it('should result in null inferred types for arrow with undefined target and report error', () => {
    const schema = `
      definition user {}
      definition document {
        relation owner: user
        permission view = owner->non_existent_relation // error here
      }
    `
    const { ast } = parseSpiceDBSchema(schema)
    if (!ast) throw new Error('AST is undefined')
    const result = analyzeSpiceDbSchema(ast)

    expect(result.isValid).toBe(false) // Because UNDEFINED_ARROW_TARGET is a fatal error for usage
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'UNDEFINED_ARROW_TARGET' }),
      ]),
    )
    // Augmented AST might be undefined due to fatal error
    if (result.augmentedAst) {
      const docDef = result.augmentedAst.definitions.find(
        d => d.name === 'document' && d.type === 'definition',
      ) as any
      const viewPerm = docDef.permissions.find((p: any) => p.name === 'view')
      // Type inference might proceed up to the point of failure or return null for the problematic part
      // Depending on implementation, inferredSubjectTypes could be null or an empty array if error occurs
      expect(viewPerm.inferredSubjectTypes).toBeNull()
    } else {
      // If augmentedAst is undefined, this also implies the error was fatal enough.
      expect(result.augmentedAst).toBeUndefined()
    }
  })

  it('should result in null inferred types for permission referencing undefined identifier and report error', () => {
    const schema = `
      definition user {}
      definition document {
        permission view = non_existent_relation // error here
      }
    `
    const { ast } = parseSpiceDBSchema(schema)
    if (!ast) throw new Error('AST is undefined')
    const result = analyzeSpiceDbSchema(ast)

    expect(result.isValid).toBe(false) // Because UNDEFINED_IDENTIFIER is a fatal error
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'UNDEFINED_IDENTIFIER' }),
      ]),
    )
    if (result.augmentedAst) {
      const docDef = result.augmentedAst.definitions.find(
        d => d.name === 'document' && d.type === 'definition',
      ) as any
      const viewPerm = docDef.permissions.find((p: any) => p.name === 'view')
      expect(viewPerm.inferredSubjectTypes).toBeNull()
    } else {
      expect(result.augmentedAst).toBeUndefined()
    }
  })

  it('should correctly infer types for relation with wildcard', () => {
    const schema = `
      definition user {}
      definition resource {
        relation viewer: user:*
        permission view = viewer
      }
    `
    const { ast } = parseSpiceDBSchema(schema)
    if (!ast) throw new Error('AST is undefined')
    const result = analyzeSpiceDbSchema(ast)

    expect(result.isValid).toBe(true)
    expect(result.errors).toHaveLength(0)
    const resourceDef = result.augmentedAst?.definitions.find(
      d => d.name === 'resource' && d.type === 'definition',
    ) as any
    const viewPerm = resourceDef.permissions.find((p: any) => p.name === 'view')
    expect(viewPerm.inferredSubjectTypes).toEqual([
      { typeName: 'user', wildcard: true },
    ])
  })

  it('should correctly infer types for relation with specific subject relation', () => {
    const schema = `
      definition user {}
      definition group {
        relation member: user
      }
      definition resource {
        relation shared_with_group_members: group#member
        permission access = shared_with_group_members
      }
    `
    const { ast } = parseSpiceDBSchema(schema)
    if (!ast) throw new Error('AST is undefined')
    const result = analyzeSpiceDbSchema(ast)

    expect(result.isValid).toBe(true)
    expect(result.errors).toHaveLength(0)
    const resourceDef = result.augmentedAst?.definitions.find(
      d => d.name === 'resource' && d.type === 'definition',
    ) as any
    const accessPerm = resourceDef.permissions.find(
      (p: any) => p.name === 'access',
    )
    // The type of 'group#member' is 'user'
    expect(accessPerm.inferredSubjectTypes).toEqual([{ typeName: 'user' }])
  })

  it('should not produce augmented AST if critical pre-augmentation errors exist', () => {
    const schema = `
      definition document {
        relation viewer: non_existent_type // UNDEFINED_TYPE error
        permission view = viewer
      }
    `
    const { ast } = parseSpiceDBSchema(schema)
    if (!ast) throw new Error('AST is undefined')
    const result = analyzeSpiceDbSchema(ast)

    expect(result.isValid).toBe(false)
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'UNDEFINED_TYPE' }),
      ]),
    )
    expect(result.augmentedAst).toBeUndefined() // Critical error should prevent augmentation
    expect(result.symbolTable).toBeDefined() // Symbol table is always built
  })

  it('should not produce augmented AST if cycle detected', () => {
    const schema = `
      definition node {
        permission p1 = p2
        permission p2 = p1 // CIRCULAR_DEPENDENCY
      }
    `
    const { ast } = parseSpiceDBSchema(schema)
    if (!ast) throw new Error('AST is undefined')
    const result = analyzeSpiceDbSchema(ast)

    expect(result.isValid).toBe(false)
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'CIRCULAR_DEPENDENCY' }),
      ]),
    )
    expect(result.augmentedAst).toBeUndefined() // Cycle is a fatal error for usage
  })
})

// ============================================================================
// Focused Unit Tests for TypeInferenceEngine
// ============================================================================
describe('Isolated TypeInferenceEngine', () => {
  it('should correctly intersect two relations that both resolve to the same type', () => {
    // 1. Setup: Manually create the AST and SymbolTable
    const ast: SchemaAST = {
      definitions: [
        {
          type: 'definition',
          name: 'user',
          relations: [],
          permissions: [],
        },
        {
          type: 'definition',
          name: 'role',
          relations: [
            {
              name: 'member',
              types: [{ typeName: 'user' }],
            },
          ],
          permissions: [],
        },
        {
          type: 'definition',
          name: 'document',
          relations: [
            {
              name: 'primary_contact',
              types: [{ typeName: 'user' }],
            },
            {
              name: 'project_lead',
              types: [{ typeName: 'role', relation: 'member' }],
            },
          ],
          permissions: [
            {
              name: 'sign_off',
              expression: {
                type: 'intersection',
                operands: [
                  { type: 'identifier', name: 'primary_contact' },
                  { type: 'identifier', name: 'project_lead' },
                ],
              },
            },
          ],
        },
      ],
    }

    const symbolTable = new SymbolTable()
    for (const def of ast.definitions) {
      symbolTable.addDefinition(def as ObjectTypeDefinition)
    }

    const typeInference = new TypeInferenceEngine(symbolTable)

    // 2. Act: Directly call inferExpressionType on the intersection expression
    const signOffPermission = (ast.definitions[2] as ObjectTypeDefinition)
      .permissions[0]
    if (!signOffPermission) {
      throw new Error('sign_off permission not found in test setup')
    }
    const inferredTypes = typeInference.inferExpressionType(
      'document',
      signOffPermission.expression,
    )

    // 3. Assert: Check if the result is as expected
    expect(inferredTypes).toEqual([{ typeName: 'user' }])
  })
})
