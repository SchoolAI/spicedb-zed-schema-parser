import { v1 } from '@authzed/authzed-node'
import { describe, expect, it, vi } from 'vitest'
import { createPermissions, Operations } from './index'
import { SpiceDBClient } from './types'

// Mock the SpiceDBClient
const mockClient = {
  writeRelationships: vi
    .fn<SpiceDBClient['writeRelationships']>()
    .mockResolvedValue(
      v1.WriteRelationshipsResponse.create({
        writtenAt: v1.ZedToken.create({ token: 'test_token' }),
      }),
    ),
  checkPermission: vi.fn<SpiceDBClient['checkPermission']>().mockResolvedValue(
    v1.CheckPermissionResponse.create({
      permissionship: v1.CheckPermissionResponse_Permissionship.HAS_PERMISSION,
    }),
  ),
  deleteRelationships: vi
    .fn<SpiceDBClient['deleteRelationships']>()
    .mockResolvedValue(
      v1.DeleteRelationshipsResponse.create({
        deletedAt: v1.ZedToken.create({ token: 'delete_token' }),
      }),
    ),
  lookupResources: vi
    .fn<SpiceDBClient['lookupResources']>()
    .mockResolvedValue([] as any), // Simplified for this test
  lookupSubjects: vi
    .fn<SpiceDBClient['lookupSubjects']>()
    .mockResolvedValue([] as any), // Simplified for this test
  readRelationships: vi
    .fn<SpiceDBClient['readRelationships']>()
    .mockResolvedValue([] as any), // Simplified for this test
} as unknown as SpiceDBClient

describe('Permissions Builder', () => {
  const perms = createPermissions(mockClient)

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
    const result = await perms
      .batch()
      .grant('viewer').subject('user:charlie').resource('folder:f1')
      .and()
      .revoke('editor').subject('user:alice').resource('document:doc1')
      .and()
      .commit();

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
