import { v1 } from '@authzed/authzed-node'

export type SpiceDBClient = v1.ZedPromiseClientInterface
/**
 * Base interface for all operations
 */
export interface Operation<T> {
  execute(client: SpiceDBClient): Promise<T>
}

/**
 * Helper function to parse resource references
 */
export function parseReference(ref: string): [string, string] {
  const [part1, part2] = ref.split(':')
  if (!part1 || !part2) {
    throw new Error(
      `Invalid reference format: ${ref}. Expected format: type:id`,
    )
  }
  return [part1, part2]
}

/**
 * Result types
 */
export interface QueryResult {
  type: string
  id: string
  relation?: string
  subjectType?: string
  subjectId?: string
  permissionship?: v1.LookupPermissionship
}

export interface LookupResult {
  type: string
  id: string
  permissionship?: v1.LookupPermissionship
}

export interface TransactionResult {
  token: string | null
  succeeded: boolean
  operationCount: number
}
