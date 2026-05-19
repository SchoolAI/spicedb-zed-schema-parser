import { v1 } from '@authzed/authzed-node'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPermissions, Operations, PermissionOperations } from './index'
import { SpiceDBClient } from './types'

// Mock the SpiceDBClient
const mockWriteRelationships = vi
  .fn<SpiceDBClient['writeRelationships']>()
  .mockResolvedValue(
    v1.WriteRelationshipsResponse.create({
      writtenAt: v1.ZedToken.create({ token: 'test_token' }),
    }),
  )
const mockCheckPermission = vi
  .fn<SpiceDBClient['checkPermission']>()
  .mockResolvedValue(
    v1.CheckPermissionResponse.create({
      permissionship: v1.CheckPermissionResponse_Permissionship.HAS_PERMISSION,
    }),
  )
const mockDeleteRelationships = vi
  .fn<SpiceDBClient['deleteRelationships']>()
  .mockResolvedValue(
    v1.DeleteRelationshipsResponse.create({
      deletedAt: v1.ZedToken.create({ token: 'delete_token' }),
    }),
  )
const mockLookupResources = vi
  .fn<SpiceDBClient['lookupResources']>()
  .mockResolvedValue([] as any)
const mockLookupSubjects = vi
  .fn<SpiceDBClient['lookupSubjects']>()
  .mockResolvedValue([] as any)
const mockReadRelationships = vi
  .fn<SpiceDBClient['readRelationships']>()
  .mockResolvedValue([] as any)

const mockClient = {
  writeRelationships: mockWriteRelationships,
  checkPermission: mockCheckPermission,
  deleteRelationships: mockDeleteRelationships,
  lookupResources: mockLookupResources,
  lookupSubjects: mockLookupSubjects,
  readRelationships: mockReadRelationships,
} as unknown as SpiceDBClient

describe('Permissions Builder', () => {
  const perms = createPermissions(mockClient)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should build and execute a grant operation', async () => {
    const token = await perms
      .grant('editor')
      .subject('user:alice')
      .resource('document:doc1')
      .execute()

    expect(token).toBe('test_token')
    expect(mockClient.writeRelationships).toHaveBeenCalledWith(
      expect.objectContaining({
        updates: [
          expect.objectContaining({
            operation: v1.RelationshipUpdate_Operation.TOUCH,
            relationship: expect.objectContaining({
              resource: expect.objectContaining({
                objectType: 'document',
                objectId: 'doc1',
              }),
              relation: 'editor',
              subject: expect.objectContaining({
                object: expect.objectContaining({
                  objectType: 'user',
                  objectId: 'alice',
                }),
              }),
            }),
          }),
        ],
      }),
    )
  })

  it('should build and execute a check operation', async () => {
    const hasPermission = await perms
      .check('view')
      .subject('user:bob')
      .resource('document:doc2')
      .execute()

    expect(hasPermission).toBe(true)
    expect(mockClient.checkPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: expect.objectContaining({
          objectType: 'document',
          objectId: 'doc2',
        }),
        permission: 'view',
        subject: expect.objectContaining({
          object: expect.objectContaining({
            objectType: 'user',
            objectId: 'bob',
          }),
        }),
      }),
    )
  })

  it('should build and execute a batch transaction', async () => {
    // biome-ignore format: one-line-per-operation
    const result = await perms.batch()
      .add(perms.grant('viewer').subject('user:charlie').resource('folder:f1'))
      .add(perms.revoke('editor').subject('user:alice').resource('document:doc1'))
      .execute();

    expect(result.succeeded).toBe(true)
    expect(result.operationCount).toBe(2)
    expect(mockClient.writeRelationships).toHaveBeenCalledWith(
      expect.objectContaining({
        updates: expect.arrayContaining([
          expect.objectContaining({
            operation: v1.RelationshipUpdate_Operation.TOUCH, // grant
            relationship: expect.objectContaining({ relation: 'viewer' }),
          }),
          expect.objectContaining({
            operation: v1.RelationshipUpdate_Operation.DELETE, // revoke
            relationship: expect.objectContaining({ relation: 'editor' }),
          }),
        ]),
      }),
    )
  })

  it('should build and execute a delete operation using the static builder', async () => {
    const operation = Operations.delete().where({
      resourceType: 'document',
      resourceId: 'doc3',
    })

    const token = await perms.execute(operation)

    expect(token).toBe('delete_token')
    expect(mockClient.deleteRelationships).toHaveBeenCalledWith(
      expect.objectContaining({
        relationshipFilter: expect.objectContaining({
          resourceType: 'document',
          optionalResourceId: 'doc3',
        }),
      }),
    )
  })
})

describe('WriteOperation: multi-subject grant / revoke', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('grant with array of subjects produces one TOUCH update per subject', async () => {
    const op = PermissionOperations.grant('editor')
      .subject(['user:alice', 'user:bob'])
      .resource('document:doc1')

    await op.execute(mockClient)

    expect(mockWriteRelationships).toHaveBeenCalledOnce()
    const { updates } = mockWriteRelationships.mock.calls[0]![0]
    expect(updates).toHaveLength(2)
    expect(updates[0]).toMatchObject({
      operation: v1.RelationshipUpdate_Operation.TOUCH,
      relationship: expect.objectContaining({
        resource: expect.objectContaining({
          objectType: 'document',
          objectId: 'doc1',
        }),
        relation: 'editor',
        subject: expect.objectContaining({
          object: expect.objectContaining({
            objectType: 'user',
            objectId: 'alice',
          }),
        }),
      }),
    })
    expect(updates[1]).toMatchObject({
      operation: v1.RelationshipUpdate_Operation.TOUCH,
      relationship: expect.objectContaining({
        subject: expect.objectContaining({
          object: expect.objectContaining({
            objectType: 'user',
            objectId: 'bob',
          }),
        }),
      }),
    })
  })

  it('revoke with array of subjects produces one DELETE update per subject', async () => {
    const op = PermissionOperations.revoke('viewer')
      .subject(['user:alice', 'user:bob'])
      .resource('folder:f1')

    await op.execute(mockClient)

    const { updates } = mockWriteRelationships.mock.calls[0]![0]
    expect(updates).toHaveLength(2)
    expect(updates[0]).toMatchObject({
      operation: v1.RelationshipUpdate_Operation.DELETE,
    })
    expect(updates[1]).toMatchObject({
      operation: v1.RelationshipUpdate_Operation.DELETE,
    })
  })
})

describe('Transaction: batch execution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('PermissionOperations.batch() sends all operations in a single writeRelationships call', async () => {
    const result = await PermissionOperations.batch()
      .add(
        PermissionOperations.grant('editor')
          .subject('user:alice')
          .resource('document:doc1'),
      )
      .add(
        PermissionOperations.revoke('viewer')
          .subject('user:bob')
          .resource('folder:f1'),
      )
      .execute(mockClient)

    expect(result.succeeded).toBe(true)
    expect(result.operationCount).toBe(2)
    expect(mockWriteRelationships).toHaveBeenCalledOnce()

    const { updates } = mockWriteRelationships.mock.calls[0]![0]
    expect(updates).toHaveLength(2)
    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: v1.RelationshipUpdate_Operation.TOUCH,
        }),
        expect.objectContaining({
          operation: v1.RelationshipUpdate_Operation.DELETE,
        }),
      ]),
    )
  })
})

describe('DeleteOperation: filter combinations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('full filter — sends relation, resourceType, and optionalSubjectFilter', async () => {
    const op = PermissionOperations.delete().where({
      resourceType: 'document',
      relation: 'editor',
      subjectType: 'user',
      subjectId: 'alice',
    })

    await op.execute(mockClient)

    expect(mockDeleteRelationships).toHaveBeenCalledWith(
      expect.objectContaining({
        relationshipFilter: expect.objectContaining({
          resourceType: 'document',
          optionalRelation: 'editor',
          optionalSubjectFilter: expect.objectContaining({
            subjectType: 'user',
            optionalSubjectId: 'alice',
          }),
        }),
      }),
    )
  })

  it('partial filter — no optionalSubjectFilter when subject fields are absent', async () => {
    const op = PermissionOperations.delete().where({
      resourceType: 'folder',
      resourceId: 'f1',
    })

    await op.execute(mockClient)

    const request = mockDeleteRelationships.mock.calls[0]![0]
    const filter = request?.relationshipFilter
    expect(filter?.resourceType).toBe('folder')
    expect(filter?.optionalResourceId).toBe('f1')
    expect(filter?.optionalSubjectFilter).toBeUndefined()
  })
})

describe('LookupOperation: resources, subjects, and multi-permission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lookup resources — sends correct LookupResourcesRequest and maps results', async () => {
    mockLookupResources.mockResolvedValueOnce([
      {
        resourceObjectId: 'doc1',
        permissionship: v1.LookupPermissionship.HAS_PERMISSION,
      },
    ] as any)

    const results = await PermissionOperations.lookup()
      .resourcesAccessibleBy('user:alice')
      .withPermission('view')
      .ofType('document')
      .execute(mockClient)

    expect(mockLookupResources).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceObjectType: 'document',
        permission: 'view',
        subject: expect.objectContaining({
          object: expect.objectContaining({
            objectType: 'user',
            objectId: 'alice',
          }),
        }),
      }),
    )
    expect(results).toEqual([
      {
        type: 'document',
        id: 'doc1',
        permissionship: v1.LookupPermissionship.HAS_PERMISSION,
      },
    ])
  })

  it('lookup subjects — sends correct LookupSubjectsRequest and maps results', async () => {
    mockLookupSubjects.mockResolvedValueOnce([
      {
        subject: {
          subjectObjectId: 'alice',
          permissionship: v1.LookupPermissionship.HAS_PERMISSION,
        },
      },
    ] as any)

    const results = await PermissionOperations.lookup()
      .subjectsWithAccessTo('document:doc1')
      .withPermission('view')
      .ofType('user')
      .execute(mockClient)

    expect(mockLookupSubjects).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: expect.objectContaining({
          objectType: 'document',
          objectId: 'doc1',
        }),
        permission: 'view',
        subjectObjectType: 'user',
      }),
    )
    expect(results).toEqual([
      {
        type: 'user',
        id: 'alice',
        permissionship: v1.LookupPermissionship.HAS_PERMISSION,
      },
    ])
  })

  it('withPermissions — calls lookupSubjects in parallel and merges with first-wins semantics', async () => {
    // 'edit' permission lookup returns alice
    mockLookupSubjects.mockResolvedValueOnce([
      {
        subject: {
          subjectObjectId: 'alice',
          permissionship: v1.LookupPermissionship.HAS_PERMISSION,
        },
      },
    ] as any)
    // 'view' permission lookup returns alice and bob (alice already seen — bob is new)
    mockLookupSubjects.mockResolvedValueOnce([
      {
        subject: {
          subjectObjectId: 'alice',
          permissionship: v1.LookupPermissionship.HAS_PERMISSION,
        },
      },
      {
        subject: {
          subjectObjectId: 'bob',
          permissionship: v1.LookupPermissionship.HAS_PERMISSION,
        },
      },
    ] as any)

    const op = PermissionOperations.lookup()
      .subjectsWithAccessTo('folder:f1')
      .ofType('user')

    const resultMap = await op.withPermissions(['edit', 'view'], mockClient)

    expect(mockLookupSubjects).toHaveBeenCalledTimes(2)
    expect(resultMap.get('alice')).toBe('edit') // first-wins
    expect(resultMap.get('bob')).toBe('view')
    expect(resultMap.size).toBe(2)
  })
})

describe('QueryOperation (find): readRelationships', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('find().relation().subject() sends correct ReadRelationshipsRequest', async () => {
    mockReadRelationships.mockResolvedValueOnce([
      {
        relationship: {
          resource: { objectType: 'document', objectId: 'doc1' },
          relation: 'editor',
          subject: { object: { objectType: 'user', objectId: 'alice' } },
        },
      },
      {
        relationship: {
          resource: { objectType: 'document', objectId: 'doc2' },
          relation: 'editor',
          subject: { object: { objectType: 'user', objectId: 'alice' } },
        },
      },
    ] as any)

    const results = await PermissionOperations.find()
      .relation('editor')
      .subject('user:alice')
      .execute(mockClient)

    expect(mockReadRelationships).toHaveBeenCalledOnce()
    const request = mockReadRelationships.mock.calls[0]![0]
    expect(request.relationshipFilter).toMatchObject({
      optionalRelation: 'editor',
      optionalSubjectFilter: expect.objectContaining({
        subjectType: 'user',
        optionalSubjectId: 'alice',
      }),
    })

    expect(results).toEqual([
      {
        type: 'document',
        id: 'doc1',
        relation: 'editor',
        subjectType: 'user',
        subjectId: 'alice',
      },
      {
        type: 'document',
        id: 'doc2',
        relation: 'editor',
        subjectType: 'user',
        subjectId: 'alice',
      },
    ])
  })

  it('find().relation().subject() with wildcard only sets subjectType', async () => {
    mockReadRelationships.mockResolvedValueOnce([
      {
        relationship: {
          resource: { objectType: 'folder', objectId: 'f1' },
          relation: 'collaborator',
          subject: { object: { objectType: 'user', objectId: 'bob' } },
        },
      },
    ] as any)

    const results = await PermissionOperations.find()
      .relation('collaborator')
      .subject('user:*')
      .execute(mockClient)

    const request = mockReadRelationships.mock.calls[0]![0]
    expect(request.relationshipFilter).toMatchObject({
      optionalRelation: 'collaborator',
      optionalSubjectFilter: expect.objectContaining({
        subjectType: 'user',
      }),
    })
    expect(
      request.relationshipFilter?.optionalSubjectFilter?.optionalSubjectId,
    ).toBe('')

    expect(results).toEqual([
      {
        type: 'folder',
        id: 'f1',
        relation: 'collaborator',
        subjectType: 'user',
        subjectId: 'bob',
      },
    ])
  })

  it('find().relation() without subject sends only optionalRelation filter', async () => {
    mockReadRelationships.mockResolvedValueOnce([
      {
        relationship: {
          resource: { objectType: 'document', objectId: 'doc1' },
          relation: 'viewer',
          subject: { object: { objectType: 'user', objectId: 'charlie' } },
        },
      },
    ] as any)

    const results = await PermissionOperations.find()
      .relation('viewer')
      .execute(mockClient)

    const request = mockReadRelationships.mock.calls[0]![0]
    expect(request.relationshipFilter).toMatchObject({
      optionalRelation: 'viewer',
    })
    expect(request.relationshipFilter?.optionalSubjectFilter).toBeUndefined()

    expect(results).toEqual([
      {
        type: 'document',
        id: 'doc1',
        relation: 'viewer',
        subjectType: 'user',
        subjectId: 'charlie',
      },
    ])
  })
})

describe('Validation errors', () => {
  it('lookup().execute() without permission set throws', async () => {
    const op = PermissionOperations.lookup()
      .resourcesAccessibleBy('user:alice')
      .ofType('document')

    await expect(op.execute(mockClient)).rejects.toThrow(
      'Lookup operation requires permission',
    )
  })

  it('check().execute() without subject and resource throws', async () => {
    const op = PermissionOperations.check('view')

    await expect(op.execute(mockClient)).rejects.toThrow(
      'Check operation requires both subject and resource',
    )
  })
})
