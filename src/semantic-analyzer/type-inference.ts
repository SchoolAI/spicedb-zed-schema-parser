import { PermissionExpression, RelationType } from '../schema-parser/parser'
import { SymbolTable } from './symbol-table'

export class TypeInferenceEngine {
  constructor(private symbolTable: SymbolTable) {}

  inferExpressionType(
    defName: string,
    expr: PermissionExpression,
    callStack: Set<string> = new Set(),
  ): RelationType[] | null {
    switch (expr.type) {
      case 'identifier': {
        const rel = this.symbolTable.getRelation(defName, expr.name)
        if (rel) {
          const resolvedTypes: RelationType[] = []
          for (const typeRef of rel.types) {
            if (typeRef.relation) {
              const subjectRelationTypes = this.inferSubjectRelationType(
                typeRef.typeName,
                typeRef.relation,
                callStack,
              )
              if (subjectRelationTypes) {
                resolvedTypes.push(...subjectRelationTypes)
              }
            } else {
              resolvedTypes.push(typeRef)
            }
          }
          return this.deduplicateTypes(resolvedTypes)
        }
        const perm = this.symbolTable.getPermission(defName, expr.name)
        if (perm) {
          const stackKey = `${defName}#${expr.name}`
          if (callStack.has(stackKey)) {
            return null // Cycle detected
          }
          callStack.add(stackKey)
          const result = this.inferExpressionType(
            defName,
            perm.expression,
            callStack,
          )
          callStack.delete(stackKey)
          return result
        }
        return null
      }

      case 'union': {
        const allTypes: RelationType[] = []
        for (const operand of expr.operands) {
          const types = this.inferExpressionType(defName, operand, callStack)
          if (types) {
            allTypes.push(...types)
          }
        }
        return this.deduplicateTypes(allTypes)
      }

      case 'intersection': {
        let commonTypes: RelationType[] | null = null
        for (const operand of expr.operands) {
          const types = this.inferExpressionType(defName, operand, callStack)
          if (!types) return null
          if (!commonTypes) {
            commonTypes = types
          } else {
            commonTypes = this.intersectTypes(commonTypes, types)
          }
        }
        return commonTypes
      }

      case 'exclusion':
        return this.inferExpressionType(defName, expr.left, callStack)

      case 'arrow':
      case 'any':
      case 'all': {
        const leftTypes = this.inferExpressionType(
          defName,
          expr.left,
          callStack,
        )
        if (!leftTypes) return null

        const resultTypes: RelationType[] = []
        for (const leftType of leftTypes) {
          const targetRel = this.symbolTable.getRelation(
            leftType.typeName,
            expr.target,
          )
          if (targetRel) {
            for (const typeRef of targetRel.types) {
              if (typeRef.relation) {
                const subjectRelationTypes = this.inferSubjectRelationType(
                  typeRef.typeName,
                  typeRef.relation,
                  callStack,
                )
                if (subjectRelationTypes) {
                  resultTypes.push(...subjectRelationTypes)
                }
              } else {
                resultTypes.push(typeRef)
              }
            }
          }
          const targetPerm = this.symbolTable.getPermission(
            leftType.typeName,
            expr.target,
          )
          if (targetPerm) {
            const stackKey = `${leftType.typeName}#${expr.target}`
            if (callStack.has(stackKey)) {
              continue // Cycle detected, skip this path
            }
            callStack.add(stackKey)
            const permTypes = this.inferExpressionType(
              leftType.typeName,
              targetPerm.expression,
              callStack,
            )
            callStack.delete(stackKey)
            if (permTypes) {
              resultTypes.push(...permTypes)
            }
          }
        }
        return this.deduplicateTypes(resultTypes)
      }

      default:
        return null
    }
  }

  private inferSubjectRelationType(
    typeName: string,
    relationName: string,
    callStack: Set<string>,
  ): RelationType[] | null {
    const targetRel = this.symbolTable.getRelation(typeName, relationName)
    if (targetRel) {
      const resolvedTypes: RelationType[] = []
      for (const typeRef of targetRel.types) {
        if (typeRef.relation) {
          const subjectRelationTypes = this.inferSubjectRelationType(
            typeRef.typeName,
            typeRef.relation,
            callStack,
          )
          if (subjectRelationTypes) {
            resolvedTypes.push(...subjectRelationTypes)
          }
        } else {
          resolvedTypes.push(typeRef)
        }
      }
      return this.deduplicateTypes(resolvedTypes)
    }

    const targetPerm = this.symbolTable.getPermission(typeName, relationName)
    if (targetPerm) {
      const stackKey = `${typeName}#${relationName}`
      if (callStack.has(stackKey)) {
        return null // Cycle detected
      }
      callStack.add(stackKey)
      const result = this.inferExpressionType(
        typeName,
        targetPerm.expression,
        callStack,
      )
      callStack.delete(stackKey)
      return result
    }
    return null
  }

  private deduplicateTypes(types: RelationType[]): RelationType[] {
    const seen = new Set<string>()
    const result: RelationType[] = []

    for (const type of types) {
      const key = `${type.typeName}${type.wildcard ? ':*' : ''}${type.relation ? '#' + type.relation : ''}`
      if (!seen.has(key)) {
        seen.add(key)
        result.push(type)
      }
    }

    return result
  }

  private intersectTypes(a: RelationType[], b: RelationType[]): RelationType[] {
    const result: RelationType[] = []
    const bKeys = new Set(
      b.map(
        type =>
          `${type.typeName}${type.wildcard ? ':*' : ''}${type.relation ? '#' + type.relation : ''}`,
      ),
    )

    for (const typeA of a) {
      const keyA = `${typeA.typeName}${typeA.wildcard ? ':*' : ''}${typeA.relation ? '#' + typeA.relation : ''}`
      if (bKeys.has(keyA)) {
        result.push(typeA)
      }
    }
    // Deduplication is handled by the caller (inferExpressionType for 'intersection') if needed,
    // but intersecting already deduplicated lists should yield a deduplicated list.
    return this.deduplicateTypes(result) // Ensure the result is deduplicated
  }
}
