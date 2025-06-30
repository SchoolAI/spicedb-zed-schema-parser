import { v1 } from '@authzed/authzed-node'
import { LookupResult, Operation, parseReference, SpiceDBClient } from './types'

/**
 * Lookup operation for finding accessible resources or subjects with permissions
 */
export class LookupOperation implements Operation<LookupResult[]> {
  protected lookupType?: 'resources' | 'subjects'
  protected resourceFilter?: { type: string; id?: string }
  protected subjectFilter?: { type: string; id?: string }
  protected permission?: string
  protected consistency?: v1.Consistency

  resourcesAccessibleBy(subjectRef: string): this {
    this.lookupType = 'resources'
    const [type, id] = parseReference(subjectRef)
    this.subjectFilter = { type, id }
    return this
  }

  subjectsWithAccessTo(resourceRef: string): this {
    this.lookupType = 'subjects'
    const [type, id] = parseReference(resourceRef)
    this.resourceFilter = { type, id }
    return this
  }

  ofType(type: string): this {
    if (this.lookupType === 'resources') {
      this.resourceFilter = { type }
    } else if (this.lookupType === 'subjects') {
      this.subjectFilter = { type }
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

  async execute(client: SpiceDBClient): Promise<LookupResult[]> {
    if (!this.permission) {
      throw new Error('Lookup operation requires permission')
    }

    if (this.lookupType === 'resources' && this.subjectFilter) {
      const request = v1.LookupResourcesRequest.create({
        resourceObjectType: this.resourceFilter?.type || 'document',
        permission: this.permission,
        subject: v1.SubjectReference.create({
          object: v1.ObjectReference.create({
            objectType: this.subjectFilter.type,
            objectId: this.subjectFilter.id!,
          }),
        }),
        consistency: this.consistency,
      })

      const stream = await client.lookupResources(request)

      const results: LookupResult[] = []
      for (const result of stream) {
        if (result.resourceObjectId) {
          results.push({
            type: this.resourceFilter?.type || 'document',
            id: result.resourceObjectId,
            permissionship: result.permissionship,
          })
        }
      }
      return results
    }

    if (this.lookupType === 'subjects' && this.resourceFilter?.id) {
      const request = v1.LookupSubjectsRequest.create({
        resource: v1.ObjectReference.create({
          objectType: this.resourceFilter.type,
          objectId: this.resourceFilter.id,
        }),
        permission: this.permission,
        subjectObjectType: this.subjectFilter?.type || 'user',
        consistency: this.consistency,
      })

      const stream = await client.lookupSubjects(request)

      const results: LookupResult[] = []
      for (const result of stream) {
        if (result.subject?.subjectObjectId) {
          results.push({
            type: this.subjectFilter?.type || 'user',
            id: result.subject.subjectObjectId,
            permissionship: result.subject.permissionship,
          })
        }
      }
      return results
    }

    throw new Error('Invalid lookup configuration')
  }

  /**
   * Special helper for looking up subjects with multiple permission levels
   */
  async withPermissions(
    permissions: string[],
    client?: SpiceDBClient,
  ): Promise<Map<string, string>> {
    if (!this.resourceFilter?.id) {
      throw new Error('Multiple permission lookup requires a specific resource')
    }

    // This method needs a client, either passed in or error
    if (!client) {
      throw new Error(
        'withPermissions requires a client. Use execute(client) or pass client as second parameter.',
      )
    }

    const resultMap = new Map<string, string>()

    // Query each permission level
    for (const permission of permissions) {
      const request = v1.LookupSubjectsRequest.create({
        resource: v1.ObjectReference.create({
          objectType: this.resourceFilter.type,
          objectId: this.resourceFilter.id,
        }),
        permission,
        subjectObjectType: this.subjectFilter?.type || 'user',
        consistency: this.consistency,
      })

      const stream = await client.lookupSubjects(request)

      for (const result of stream) {
        if (result.subject?.subjectObjectId) {
          // Only set if not already set (maintains hierarchy)
          if (!resultMap.has(result.subject.subjectObjectId)) {
            resultMap.set(result.subject.subjectObjectId, permission)
          }
        }
      }
    }

    return resultMap
  }

  toJSON() {
    return {
      lookupType: this.lookupType,
      resourceFilter: this.resourceFilter,
      subjectFilter: this.subjectFilter,
      permission: this.permission,
      consistency: this.consistency,
    }
  }
}

/**
 * Bound version of LookupOperation
 */
export class BoundLookupOperation extends LookupOperation {
  constructor(private client: SpiceDBClient) {
    super()
  }

  async execute(): Promise<LookupResult[]> {
    return super.execute(this.client)
  }

  async withPermissions(permissions: string[]): Promise<Map<string, string>> {
    return super.withPermissions(permissions, this.client)
  }
}
