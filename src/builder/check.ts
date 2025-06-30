import { v1 } from '@authzed/authzed-node'
import { Operation, parseReference, SpiceDBClient } from './types'

/**
 * Operation for checking permissions
 */
export class CheckOperation implements Operation<boolean> {
  protected subjectRef?: string
  protected resourceRef?: string
  protected consistency?: v1.Consistency

  constructor(protected permission: string) {}

  subject(ref: string): this {
    this.subjectRef = ref
    return this
  }

  resource(ref: string): this {
    this.resourceRef = ref
    return this
  }

  withConsistency(token: string): this {
    this.consistency = v1.Consistency.create({
      requirement: {
        oneofKind: 'atLeastAsFresh',
        atLeastAsFresh: v1.ZedToken.create({ token }),
      },
    })
    return this
  }

  async execute(client: SpiceDBClient): Promise<boolean> {
    if (!this.subjectRef || !this.resourceRef) {
      throw new Error('Check operation requires both subject and resource')
    }

    const [subjectType, subjectId] = parseReference(this.subjectRef)
    const [resourceType, resourceId] = parseReference(this.resourceRef)

    const request = v1.CheckPermissionRequest.create({
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
      consistency: this.consistency,
    })

    const response = await client.checkPermission(request)

    return (
      response.permissionship ===
      v1.CheckPermissionResponse_Permissionship.HAS_PERMISSION
    )
  }

  toJSON() {
    return {
      permission: this.permission,
      subject: this.subjectRef,
      resource: this.resourceRef,
      consistency: this.consistency,
    }
  }
}

/**
 * Bound version of CheckOperation
 */
export class BoundCheckOperation extends CheckOperation {
  constructor(
    private client: SpiceDBClient,
    permission: string,
  ) {
    super(permission)
  }

  async execute(): Promise<boolean> {
    return super.execute(this.client)
  }
}
