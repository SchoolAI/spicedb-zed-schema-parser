import fs from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { generateSDK } from './generate-sdk'
import { parseSpiceDBSchema } from './schema-parser/parser'
import { analyzeSpiceDbSchema } from './semantic-analyzer/analyzer'

const schemaSource = fs.readFileSync(
  new URL('./fixtures/test-schema.zed', import.meta.url),
  'utf-8',
)

let generated: string

beforeAll(() => {
  const { ast } = parseSpiceDBSchema(schemaSource)
  if (!ast) throw new Error('Schema failed to parse')
  const result = analyzeSpiceDbSchema(ast)
  if (!result.isValid) throw new Error(`Schema analysis failed: ${result.errors.map(e => e.message).join(', ')}`)
  generated = generateSDK(result.augmentedAst!)
})

describe('generateSDK — imports', () => {
  it('imports all required builder exports', () => {
    expect(generated).toContain('PermissionOperations')
    expect(generated).toContain('WriteOperation')
    expect(generated).toContain('Transaction')
    expect(generated).toContain('DeleteOperation')
    expect(generated).toContain('CheckOperation')
    expect(generated).toContain('BulkCheckOperation')
  })
})

describe('generateSDK — resource types', () => {
  it('generates a Resource type for every definition', () => {
    expect(generated).toContain("export type UserResource = Resource<'user'>")
    expect(generated).toContain("export type TeamResource = Resource<'team'>")
    expect(generated).toContain("export type FolderResource = Resource<'folder'>")
    expect(generated).toContain("export type DocumentResource = Resource<'document'>")
    expect(generated).toContain("export type OrganizationResource = Resource<'organization'>")
    expect(generated).toContain("export type TagResource = Resource<'tag'>")
  })

  it('does not contain undefined in any type name', () => {
    expect(generated).not.toContain('undefinedResource')
    expect(generated).not.toContain('Resource<undefined>')
  })
})

describe('generateSDK — batch', () => {
  it('generates permissions.batch at the top of the permissions object', () => {
    expect(generated).toContain('batch: (...operations: WriteOperation[])')
    expect(generated).toContain('const tx = new Transaction()')
  })
})

describe('generateSDK — grant / revoke: subject arrays', () => {
  it('generates array union for single-type relation', () => {
    // team.grant.member: user only
    expect(generated).toContain(
      "member: (subject: Subject<'user'> | Subject<'user'>[], resource: TeamResource)",
    )
  })

  it('generates array union for multi-type relation (folder.grant.collaborator)', () => {
    expect(generated).toContain(
      "collaborator: (subject: Subject<'user' | 'team'> | Subject<'user' | 'team'>[], resource: FolderResource)",
    )
  })

  it('generates revoke with same array signature', () => {
    expect(generated).toContain(
      "collaborator: (subject: Subject<'user' | 'team'> | Subject<'user' | 'team'>[], resource: FolderResource) => PermissionOperations.revoke('collaborator')",
    )
  })
})

describe('generateSDK — check: permissions', () => {
  it('generates all document permission checks', () => {
    expect(generated).toContain(
      "edit: (subject: Subject<'user'>, resource: DocumentResource) => PermissionOperations.check('edit')",
    )
    expect(generated).toContain(
      "view: (subject: Subject<'user'>, resource: DocumentResource) => PermissionOperations.check('view')",
    )
    expect(generated).toContain(
      "delete: (subject: Subject<'user'>, resource: DocumentResource) => PermissionOperations.check('delete')",
    )
    expect(generated).toContain(
      "shared: (subject: Subject<'user'>, resource: DocumentResource) => PermissionOperations.check('shared')",
    )
  })

  it('generates organization permission checks with snake_case names camelCased', () => {
    expect(generated).toContain("adminAccess: (subject: Subject<'user'>, resource: OrganizationResource)")
    expect(generated).toContain("subtreeMember: (subject: Subject<'user'>, resource: OrganizationResource)")
  })
})

describe('generateSDK — check: relation checks', () => {
  it('generates @check: annotation as a custom check name', () => {
    // folder.collaborator has /** @check: isCollaborator */
    expect(generated).toContain(
      "isCollaborator: (subject: Subject<'user' | 'team'>, resource: FolderResource) => PermissionOperations.check('collaborator')",
    )
  })

  it('generates is<PascalCase> for plain relations without @check: annotation', () => {
    expect(generated).toContain(
      "isOwner: (subject: Subject<'user'>, resource: DocumentResource) => PermissionOperations.check('owner')",
    )
    expect(generated).toContain(
      "isEditor: (subject: Subject<'user'>, resource: DocumentResource) => PermissionOperations.check('editor')",
    )
    expect(generated).toContain(
      "isViewer: (subject: Subject<'user'>, resource: DocumentResource) => PermissionOperations.check('viewer')",
    )
  })

  it('generates isCreatedBy for tag.created_by', () => {
    expect(generated).toContain(
      "isCreatedBy: (subject: Subject<'user'>, resource: TagResource) => PermissionOperations.check('created_by')",
    )
  })
})

describe('generateSDK — checkBulk', () => {
  it('generates checkBulk for document with all 4 permissions', () => {
    expect(generated).toContain(
      "checkBulk: (permission: 'edit' | 'view' | 'delete' | 'shared', subject: Subject<'user' | 'folder'>, resources: DocumentResource[]) => PermissionOperations.bulkCheck(permission, subject, resources)",
    )
  })

  it('generates checkBulk for organization with all 4 permissions', () => {
    expect(generated).toContain(
      "checkBulk: (permission: 'admin_access' | 'member_access' | 'full_member' | 'subtree_member'",
    )
  })

  it('does not generate checkBulk for tag (relations-only definition)', () => {
    // tag block ends before any checkBulk; verify by checking the tag section has no checkBulk
    const tagSection = generated.slice(
      generated.indexOf('tag: {'),
      generated.indexOf('};') + 2,
    )
    // The tag section should not contain 'checkBulk'
    expect(tagSection).not.toContain('checkBulk')
  })

  it('does not generate a permissions.user entry at all', () => {
    expect(generated).not.toContain('permissions.user')
    expect(generated).not.toMatch(/^\s+user:\s*\{/m)
  })
})

describe('generateSDK — lookup', () => {
  it('generates lookup.resources for document hardcoded to ofType("document")', () => {
    expect(generated).toContain(".ofType('document')")
  })

  it('generates lookup.subjects for organization accepting OrganizationResource', () => {
    expect(generated).toContain(
      "subjects: (resource: OrganizationResource, permission: 'admin_access' | 'member_access' | 'full_member' | 'subtree_member', subjectType: 'user' | 'organization')",
    )
  })

  it('does not generate lookup for tag (relations-only definition)', () => {
    const tagSection = generated.slice(
      generated.indexOf('tag: {'),
      generated.indexOf('};') + 2,
    )
    expect(tagSection).not.toContain('lookup:')
  })
})

describe('generateSDK — deleteAll', () => {
  it('generates deleteAll for document with hardcoded resourceType and typed relation filter', () => {
    expect(generated).toContain("resourceType: 'document'")
    expect(generated).toContain(
      "relation?: 'owner' | 'editor' | 'viewer' | 'parent_folder'",
    )
  })

  it('generates deleteAll for tag (relations-only definition)', () => {
    expect(generated).toContain("resourceType: 'tag'")
    expect(generated).toContain("relation?: 'created_by'")
  })

  it('does not generate deleteAll for user (empty definition)', () => {
    // user has no relations — generateDeleteAll returns '' for it
    // and the user entry is skipped entirely
    expect(generated).not.toMatch(/resourceType: 'user'/)
  })
})

describe('generateSDK — dynamic dispatch', () => {
  it('generates ResourceType union excluding user', () => {
    expect(generated).toContain(
      "export type ResourceType = 'team' | 'folder' | 'document' | 'organization' | 'tag'",
    )
  })

  it('generates GrantParams discriminated union for each definition with relations', () => {
    expect(generated).toContain("objectType: 'team'; relation: 'member' | 'admin'")
    expect(generated).toContain("objectType: 'folder'; relation: 'owner' | 'collaborator' | 'public' | 'parent'")
    expect(generated).toContain("objectType: 'document'; relation: 'owner' | 'editor' | 'viewer' | 'parent_folder'")
    expect(generated).toContain("objectType: 'tag'; relation: 'created_by'")
  })

  it('generates RevokeParams = GrantParams', () => {
    expect(generated).toContain('export type RevokeParams = GrantParams')
  })

  it('generates CheckParams discriminated union for definitions with permissions only', () => {
    expect(generated).toContain("objectType: 'team'; permission: 'manage' | 'collaborate'")
    expect(generated).toContain("objectType: 'document'; permission: 'edit' | 'view' | 'delete' | 'shared'")
    // tag has no permissions so should NOT appear in CheckParams
    expect(generated).not.toContain("objectType: 'tag'; permission:")
  })

  it('generates dynamicGrant, dynamicRevoke, dynamicCheck functions', () => {
    expect(generated).toContain('export function dynamicGrant(params: GrantParams): WriteOperation')
    expect(generated).toContain('export function dynamicRevoke(params: RevokeParams): WriteOperation')
    expect(generated).toContain('export function dynamicCheck(params: CheckParams): CheckOperation')
  })
})

describe('generateSDK — find', () => {
  it('generates find entries for folder including byCollaborator', () => {
    expect(generated).toContain(
      "byCollaborator: (subject: Subject<'user' | 'team'>) => PermissionOperations.find().relation('collaborator')",
    )
  })

  it('generates find entries for organization including byAdmin', () => {
    expect(generated).toContain(
      "byAdmin: (subject: Subject<'user'>) => PermissionOperations.find().relation('admin')",
    )
  })

  it('generates find entry for tag', () => {
    expect(generated).toContain(
      "byCreatedBy: (subject: Subject<'user'>) => PermissionOperations.find().relation('created_by')",
    )
  })
})
