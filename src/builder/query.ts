import { v1 } from '@authzed/authzed-node'
import { Operation, parseReference, QueryResult, SpiceDBClient } from './types'

/**
 * Operation for querying relationships
 */
export class QueryOperation implements Operation<QueryResult[]> {
  protected filter: {
    subjectType?: string
    subjectId?: string
    relation?: string
    resourceType?: string
    resourceId?: string
  } = {}
  protected queryType?: 'subjects' | 'resources'
  protected permission?: string
  protected consistency?: v1.Consistency

  subjects(type?: string): this {
    this.queryType = 'subjects'
    if (type) this.filter.subjectType = type
    return this
  }

  resources(type?: string): this {
    this.queryType = 'resources'
    if (type) this.filter.resourceType = type
    return this
  }

  subject(ref: string): this {
    if (ref.includes('*')) {
      const [type] = parseReference(ref)
      this.filter.subjectType = type
    } else {
      const [type, id] = parseReference(ref)
      this.filter.subjectType = type
      this.filter.subjectId = id
    }
    return this
  }

  relation(rel: string): this {
    if (rel !== '*') {
      this.filter.relation = rel
    }
    return this
  }

  resource(ref: string): this {
    if (ref.includes('*')) {
      const [type] = parseReference(ref)
      this.filter.resourceType = type
    } else {
      const [type, id] = parseReference(ref)
      this.filter.resourceType = type
      this.filter.resourceId = id
    }
    return this
  }

  withPermission(permission: string): this {
    this.permission = permission
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

  async execute(client: SpiceDBClient): Promise<QueryResult[]> {
    // If looking up subjects for a specific resource/permission
    if (
      this.queryType === 'subjects' &&
      this.filter.resourceType &&
      this.filter.resourceId &&
      this.permission
    ) {
      const request = v1.LookupSubjectsRequest.create({
        resource: v1.ObjectReference.create({
          objectType: this.filter.resourceType,
          objectId: this.filter.resourceId,
        }),
        permission: this.permission,
        subjectObjectType: this.filter.subjectType || 'user',
        consistency: this.consistency,
      })

      const stream = await client.lookupSubjects(request)

      const results: QueryResult[] = []
      for (const result of stream) {
        if (result.subject?.subjectObjectId) {
          results.push({
            type: this.filter.subjectType || 'user',
            id: result.subject.subjectObjectId,
            relation:
              result.subject.permissionship ===
              v1.LookupPermissionship.HAS_PERMISSION
                ? this.permission
                : undefined,
          })
        }
      }
      return results
    }

    // If looking up resources accessible to a subject
    if (
      this.queryType === 'resources' &&
      this.filter.subjectType &&
      this.filter.subjectId &&
      this.permission
    ) {
      const request = v1.LookupResourcesRequest.create({
        resourceObjectType: this.filter.resourceType || 'document',
        permission: this.permission,
        subject: v1.SubjectReference.create({
          object: v1.ObjectReference.create({
            objectType: this.filter.subjectType,
            objectId: this.filter.subjectId,
          }),
        }),
        consistency: this.consistency,
      })

      const stream = await client.lookupResources(request)

      const results: QueryResult[] = []
      for (const result of stream) {
        if (result.resourceObjectId) {
          results.push({
            type: this.filter.resourceType || 'document',
            id: result.resourceObjectId,
            permissionship: result.permissionship,
          })
        }
      }
      return results
    }

    // For general relationship queries, use ReadRelationships
    const filter: Partial<v1.RelationshipFilter> = {}

    if (this.filter.resourceType) {
      filter.resourceType = this.filter.resourceType
    }
    if (this.filter.resourceId) {
      filter.optionalResourceId = this.filter.resourceId
    }
    if (this.filter.relation) {
      filter.optionalRelation = this.filter.relation
    }

    if (this.filter.subjectType || this.filter.subjectId) {
      const subjectFilter: Partial<v1.SubjectFilter> = {}
      if (this.filter.subjectType) {
        subjectFilter.subjectType = this.filter.subjectType
      }
      if (this.filter.subjectId) {
        subjectFilter.optionalSubjectId = this.filter.subjectId
      }
      filter.optionalSubjectFilter = v1.SubjectFilter.create(subjectFilter)
    }

    const request = v1.ReadRelationshipsRequest.create({
      relationshipFilter: v1.RelationshipFilter.create(filter),
      consistency: this.consistency,
    })

    const stream = await client.readRelationships(request)
    const results: QueryResult[] = []

    for (const result of stream) {
      if (result.relationship) {
        results.push({
          type: result.relationship.resource?.objectType || '',
          id: result.relationship.resource?.objectId || '',
          relation: result.relationship.relation,
          subjectType: result.relationship.subject?.object?.objectType || '',
          subjectId: result.relationship.subject?.object?.objectId || '',
        })
      }
    }

    return results
  }

  toJSON() {
    return {
      queryType: this.queryType,
      filter: this.filter,
      permission: this.permission,
      consistency: this.consistency,
    }
  }
}

/**
 * Bound version of QueryOperation
 */
export class BoundQueryOperation extends QueryOperation {
  constructor(private client: SpiceDBClient) {
    super()
  }

  async execute(): Promise<QueryResult[]> {
    return super.execute(this.client)
  }
}
