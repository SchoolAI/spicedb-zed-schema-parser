import { v1 } from '@authzed/authzed-node'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BulkCheckOperation } from './bulk-check'
import { SpiceDBClient } from './types'
import { PermissionOperations } from './operations'

describe('BulkCheckOperation — construction (no gRPC needed)', () => {
  it('toJSON returns the correct shape', () => {
    const op = new BulkCheckOperation('view', 'user:alice', [
      'document:doc1',
      'document:doc2',
    ])

    expect(op.toJSON()).toEqual({
      permission: 'view',
      subject: 'user:alice',
      resources: ['document:doc1', 'document:doc2'],
    })
  })

  it('PermissionOperations.bulkCheck() returns a BulkCheckOperation instance', () => {
    const op = PermissionOperations.bulkCheck('edit', 'user:bob', [
      'document:doc1',
    ])

    expect(op).toBeInstanceOf(BulkCheckOperation)
    expect(op.toJSON()).toMatchObject({
      permission: 'edit',
      subject: 'user:bob',
      resources: ['document:doc1'],
    })
  })
})

describe('BulkCheckOperation — runtime execution', () => {
  const mockCheckBulkPermissions =
    vi.fn<SpiceDBClient['checkBulkPermissions']>()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const mockClient = {
    checkBulkPermissions: mockCheckBulkPermissions,
  } as unknown as SpiceDBClient

  const mockBulkCheckResponse = {
    pairs: [
      {
        request: {
          resource: { objectType: 'document', objectId: 'doc1' },
        },
        response: {
          oneofKind: 'item',
          item: {
            permissionship:
              v1.CheckPermissionResponse_Permissionship.HAS_PERMISSION,
          },
        },
      },
      {
        request: {
          resource: { objectType: 'document', objectId: 'doc2' },
        },
        response: {
          oneofKind: 'item',
          item: {
            permissionship:
              v1.CheckPermissionResponse_Permissionship.NO_PERMISSION,
          },
        },
      },
    ],
  }

  it('maps pairs response to { resourceId, hasPermission }[]', async () => {
    mockCheckBulkPermissions.mockResolvedValueOnce(mockBulkCheckResponse as any)

    const op = new BulkCheckOperation('view', 'user:alice', [
      'document:doc1',
      'document:doc2',
    ])

    const results = await op.execute(mockClient)

    expect(results).toEqual([
      { resourceId: 'doc1', hasPermission: true },
      { resourceId: 'doc2', hasPermission: false },
    ])
  })

  it('passes the correct items to checkBulkPermissions', async () => {
    mockCheckBulkPermissions.mockResolvedValueOnce(mockBulkCheckResponse as any)

    const op = new BulkCheckOperation('edit', 'user:alice', [
      'document:doc1',
      'document:doc2',
    ])

    await op.execute(mockClient)

    expect(mockCheckBulkPermissions).toHaveBeenCalledOnce()
    const request = mockCheckBulkPermissions.mock.calls[0]![0]
    expect(request.items).toHaveLength(2)
    expect(request.items[0]).toMatchObject({
      resource: { objectType: 'document', objectId: 'doc1' },
      permission: 'edit',
      subject: {
        object: { objectType: 'user', objectId: 'alice' },
      },
    })
  })
})
