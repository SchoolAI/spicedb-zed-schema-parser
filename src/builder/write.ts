import { v1 } from '@authzed/authzed-node'
import { Operation, parseReference, SpiceDBClient } from './types'

/**
 * Base class for operations that write relationships
 */
export class WriteOperation implements Operation<string | null> {
  protected subjects: string[] = []
  protected resources: string[] = []
  protected consistency?: v1.Consistency

  constructor(
    protected operation: 'grant' | 'revoke',
    protected relation: string,
  ) {}

  subject(ref: string | string[]): this {
    this.subjects = Array.isArray(ref) ? ref : [ref]
    return this
  }

  resource(ref: string | string[]): this {
    this.resources = Array.isArray(ref) ? ref : [ref]
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

  toRelationshipUpdates(): v1.RelationshipUpdate[] {
    const updates: v1.RelationshipUpdate[] = []

    for (const subjectRef of this.subjects) {
      for (const resourceRef of this.resources) {
        const [subjectType, subjectId] = parseReference(subjectRef)
        const [resourceType, resourceId] = parseReference(resourceRef)

        const relationship = v1.Relationship.create({
          resource: v1.ObjectReference.create({
            objectType: resourceType,
            objectId: resourceId,
          }),
          relation: this.relation,
          subject: v1.SubjectReference.create({
            object: v1.ObjectReference.create({
              objectType: subjectType,
              objectId: subjectId,
            }),
          }),
        })

        updates.push(
          v1.RelationshipUpdate.create({
            relationship,
            operation:
              this.operation === 'grant'
                ? v1.RelationshipUpdate_Operation.TOUCH
                : v1.RelationshipUpdate_Operation.DELETE,
          }),
        )
      }
    }

    return updates
  }

  async execute(client: SpiceDBClient): Promise<string | null> {
    const updates = this.toRelationshipUpdates()

    const request = v1.WriteRelationshipsRequest.create({ updates })

    const response = await client.writeRelationships(request)

    return response.writtenAt?.token || null
  }

  /**
   * Convert to a plain object for serialization
   */
  toJSON() {
    return {
      operation: this.operation,
      relation: this.relation,
      subjects: this.subjects,
      resources: this.resources,
      consistency: this.consistency,
    }
  }
}

/**
 * Bound version of WriteOperation with immediate execute
 */
export class BoundWriteOperation extends WriteOperation {
  constructor(
    private client: SpiceDBClient,
    operation: 'grant' | 'revoke',
    relation: string,
  ) {
    super(operation, relation)
  }

  async execute(): Promise<string | null> {
    return super.execute(this.client)
  }
}
