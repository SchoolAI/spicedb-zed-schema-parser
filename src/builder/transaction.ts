import { v1 } from '@authzed/authzed-node'
import {
  Operation,
  parseReference,
  SpiceDBClient,
  TransactionResult,
} from './types'

/**
 * Transaction for batching multiple operations
 */
export class Transaction implements Operation<TransactionResult> {
  protected operations: (() => v1.RelationshipUpdate)[] = []

  grant(relation: string): TransactionWriteOperation<Transaction> {
    return new TransactionWriteOperation(this, 'grant', relation)
  }

  revoke(relation: string): TransactionWriteOperation<Transaction> {
    return new TransactionWriteOperation(this, 'revoke', relation)
  }

  add(operation: () => v1.RelationshipUpdate): this {
    this.operations.push(operation)
    return this
  }

  async execute(client: SpiceDBClient): Promise<TransactionResult> {
    const updates = this.operations.map(op => op())

    const request = v1.WriteRelationshipsRequest.create({ updates })
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

  grant(relation: string): TransactionWriteOperation<BoundTransaction> {
    return new TransactionWriteOperation(this, 'grant', relation)
  }

  revoke(relation: string): TransactionWriteOperation<BoundTransaction> {
    return new TransactionWriteOperation(this, 'revoke', relation)
  }

  async execute(): Promise<TransactionResult> {
    return super.execute(this.client)
  }

  async commit(): Promise<TransactionResult> {
    return this.execute()
  }
}

/**
 * Write operation within a transaction
 */
export class TransactionWriteOperation<T extends Transaction> {
  private subjects: string[] = []
  private resources: string[] = []

  constructor(
    private transaction: T,
    private operation: 'grant' | 'revoke',
    private relation: string,
  ) {}

  subject(ref: string | string[]): this {
    this.subjects = Array.isArray(ref) ? ref : [ref]
    return this
  }

  resource(ref: string | string[]): this {
    this.resources = Array.isArray(ref) ? ref : [ref]
    return this
  }

  and(): T {
    // Add all combinations to transaction
    for (const subjectRef of this.subjects) {
      for (const resourceRef of this.resources) {
        this.transaction.add(() => {
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

          return v1.RelationshipUpdate.create({
            relationship,
            operation:
              this.operation === 'grant'
                ? v1.RelationshipUpdate_Operation.TOUCH
                : v1.RelationshipUpdate_Operation.DELETE,
          })
        })
      }
    }

    return this.transaction
  }
}
