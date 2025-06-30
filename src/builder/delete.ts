import { v1 } from '@authzed/authzed-node'
import { Operation, parseReference, SpiceDBClient } from './types'

/**
 * Operation for deleting relationships
 */
export class DeleteOperation implements Operation<string | null> {
  protected filter: {
    subjectType?: string
    subjectId?: string
    relation?: string
    resourceType?: string
    resourceId?: string
  } = {}

  subject(ref: string): this {
    const [type, id] = parseReference(ref)
    this.filter.subjectType = type
    this.filter.subjectId = id
    return this
  }

  relation(rel: string): this {
    this.filter.relation = rel
    return this
  }

  resource(ref: string): this {
    const [type, id] = parseReference(ref)
    this.filter.resourceType = type
    this.filter.resourceId = id
    return this
  }

  where(filter: {
    resourceType?: string
    resourceId?: string
    relation?: string
    subjectType?: string
    subjectId?: string
  }): this {
    this.filter = { ...this.filter, ...filter }
    return this
  }

  async execute(client: SpiceDBClient): Promise<string | null> {
    const relationshipFilter: Partial<v1.RelationshipFilter> = {}

    if (this.filter.resourceType) {
      relationshipFilter.resourceType = this.filter.resourceType
    }
    if (this.filter.resourceId) {
      relationshipFilter.optionalResourceId = this.filter.resourceId
    }
    if (this.filter.relation) {
      relationshipFilter.optionalRelation = this.filter.relation
    }

    if (this.filter.subjectType || this.filter.subjectId) {
      const subjectFilter: Partial<v1.SubjectFilter> = {}
      if (this.filter.subjectType) {
        subjectFilter.subjectType = this.filter.subjectType
      }
      if (this.filter.subjectId) {
        subjectFilter.optionalSubjectId = this.filter.subjectId
      }
      relationshipFilter.optionalSubjectFilter =
        v1.SubjectFilter.create(subjectFilter)
    }

    const request = v1.DeleteRelationshipsRequest.create({
      relationshipFilter: v1.RelationshipFilter.create(relationshipFilter),
    })

    const response = await client.deleteRelationships(request)

    return response.deletedAt?.token || null
  }

  toJSON() {
    return {
      filter: this.filter,
    }
  }
}

/**
 * Bound version of DeleteOperation
 */
export class BoundDeleteOperation extends DeleteOperation {
  constructor(private client: SpiceDBClient) {
    super()
  }

  async execute(): Promise<string | null> {
    return super.execute(this.client)
  }
}
