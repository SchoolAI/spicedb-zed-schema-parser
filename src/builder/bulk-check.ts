import { v1 } from '@authzed/authzed-node'
import { Operation, parseReference, SpiceDBClient } from './types'

export interface BulkCheckResult {
  resourceId: string
  hasPermission: boolean
}

/**
 * Operation for checking permissions across multiple resources in a single gRPC call.
 */
export class BulkCheckOperation implements Operation<BulkCheckResult[]> {
  constructor(
    private permission: string,
    private subjectRef: string,
    private resourceRefs: string[],
  ) {}

  async execute(client: SpiceDBClient): Promise<BulkCheckResult[]> {
    const [subjectType, subjectId] = parseReference(this.subjectRef)

    const items = this.resourceRefs.map((ref) => {
      const [resourceType, resourceId] = parseReference(ref)
      return v1.CheckBulkPermissionsRequestItem.create({
        resource: v1.ObjectReference.create({
          objectType: resourceType,
          objectId: resourceId,
        }),
        permission: this.permission,
        subject: v1.SubjectReference.create({
          object: v1.ObjectReference.create({
            objectType: subjectType,
            objectId: subjectId,
          }),
        }),
      })
    })

    const response = await client.checkBulkPermissions(
      v1.CheckBulkPermissionsRequest.create({ items }),
    )

    return response.pairs.map((pair, i) => ({
      resourceId: parseReference(this.resourceRefs[i]!)[1],
      hasPermission:
        pair.response.oneofKind === 'item' &&
        pair.response.item.permissionship ===
          v1.CheckPermissionResponse_Permissionship.HAS_PERMISSION,
    }))
  }

  toJSON() {
    return {
      permission: this.permission,
      subject: this.subjectRef,
      resources: this.resourceRefs,
    }
  }
}
