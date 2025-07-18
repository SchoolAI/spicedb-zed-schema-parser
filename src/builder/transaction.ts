import { v1 } from '@authzed/authzed-node'
import { Operation, SpiceDBClient, TransactionResult } from './types'
import { WriteOperation } from './write'

/**
 * Transaction for batching multiple operations
 */
export class Transaction implements Operation<TransactionResult> {
  protected operations: WriteOperation[] = []

  add(operation: WriteOperation): this {
    this.operations.push(operation)
    return this
  }

  toRelationshipUpdates() {
    return this.operations.flatMap(operation =>
      operation.toRelationshipUpdates(),
    )
  }

  async execute(client: SpiceDBClient): Promise<TransactionResult> {
    const updates = this.toRelationshipUpdates()

    const request = v1.WriteRelationshipsRequest.create({
      updates,
    })
    const response = await client.writeRelationships(request)

    return {
      token: response.writtenAt?.token || null,
      succeeded: true,
      operationCount: updates.length,
    }
  }

  toJSON() {
    return {
      operationCount: this.operations.length,
    }
  }
}

/**
 * Bound version of Transaction
 */
export class BoundTransaction extends Transaction {
  constructor(private client: SpiceDBClient) {
    super()
  }

  async execute(): Promise<TransactionResult> {
    return super.execute(this.client)
  }
}
