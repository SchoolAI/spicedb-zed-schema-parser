import { BoundCheckOperation, CheckOperation } from './check'
import { BoundDeleteOperation, DeleteOperation } from './delete'
import { BoundLookupOperation, LookupOperation } from './lookup'
import { BoundQueryOperation, QueryOperation } from './query'
import { BoundTransaction, Transaction } from './transaction'
import { Operation, SpiceDBClient } from './types'
import { BoundWriteOperation, WriteOperation } from './write'

/**
 * Static builders for creating pure operations without a client
 */
// biome-ignore lint/complexity/noStaticOnlyClass: builder class is intended
export class PermissionOperations {
  /**
   * Create a grant operation
   */
  static grant(relation: string): WriteOperation {
    return new WriteOperation('grant', relation)
  }

  /**
   * Create a revoke operation
   */
  static revoke(relation: string): WriteOperation {
    return new WriteOperation('revoke', relation)
  }

  /**
   * Create a check operation
   */
  static check(permission: string): CheckOperation {
    return new CheckOperation(permission)
  }

  /**
   * Create a find/query operation
   */
  static find(): QueryOperation {
    return new QueryOperation()
  }

  /**
   * Create a delete operation
   */
  static delete(): DeleteOperation {
    return new DeleteOperation()
  }

  /**
   * Create a batch transaction
   */
  static batch(): Transaction {
    return new Transaction()
  }

  /**
   * Create a lookup operation
   */
  static lookup(): LookupOperation {
    return new LookupOperation()
  }
}

/**
 * Main entry point for the permissions DSL with bound client
 */
export class Permissions {
  constructor(private client: SpiceDBClient) {}

  /**
   * Grant a relation between subjects and resources
   */
  grant(relation: string): BoundWriteOperation {
    return new BoundWriteOperation(this.client, 'grant', relation)
  }

  /**
   * Revoke a relation between subjects and resources
   */
  revoke(relation: string): BoundWriteOperation {
    return new BoundWriteOperation(this.client, 'revoke', relation)
  }

  /**
   * Check if a subject has a permission on a resource
   */
  check(permission: string): BoundCheckOperation {
    return new BoundCheckOperation(this.client, permission)
  }

  /**
   * Find subjects or resources matching criteria
   */
  find(): BoundQueryOperation {
    return new BoundQueryOperation(this.client)
  }

  /**
   * Delete relationships matching a filter
   */
  delete(): BoundDeleteOperation {
    return new BoundDeleteOperation(this.client)
  }

  /**
   * Create a batch transaction
   */
  batch(): BoundTransaction {
    return new BoundTransaction(this.client)
  }

  /**
   * Lookup resources accessible to a subject
   */
  lookup(): BoundLookupOperation {
    return new BoundLookupOperation(this.client)
  }

  /**
   * Execute a pure operation with this instance's client
   */
  async execute<T>(operation: Operation<T>): Promise<T> {
    return operation.execute(this.client)
  }
}

/**
 * Create a permissions instance with bound client
 */
export function createPermissions(client: SpiceDBClient): Permissions {
  return new Permissions(client)
}

/**
 * Export the static builders for convenience
 */
export const Operations = PermissionOperations
