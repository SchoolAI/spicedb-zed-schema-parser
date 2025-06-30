import {
  CaveatDefinition,
  ObjectTypeDefinition,
  PermissionExpression,
  RelationDeclaration,
  SchemaAST,
} from '../schema-parser/parser'
import { DependencyGraph } from './dependency-graph'
import { SymbolTable } from './symbol-table'
import { TypeInferenceEngine } from './type-inference'
import {
  AugmentedObjectTypeDefinition,
  AugmentedPermissionDeclaration,
  AugmentedRelationDeclaration,
  AugmentedSchemaAST,
  SchemaAnalysisResult,
  SemanticError,
} from './types'

// These errors mean the fundamental structure or references are broken.
const criticalPreAugmentationErrorCodes = [
  'DUPLICATE_DEFINITION',
  'UNDEFINED_TYPE',
  'UNDEFINED_RELATION',
  'DUPLICATE_MEMBER_NAME',
]

// These errors mean the schema cannot be used for semantic analysis
const fatalForUsageErrorCodes = [
  ...criticalPreAugmentationErrorCodes, // Errors caught before augmentation
  'CIRCULAR_DEPENDENCY', // Cycles make the graph unusable
  'UNDEFINED_IDENTIFIER', // Referenced name doesn't exist
  'UNDEFINED_ARROW_TARGET', // Arrow target doesn't exist on resolved types
  'AUGMENTATION_INTERNAL_ERROR', // If augmentation process itself failed
]

export class SemanticAnalyzer {
  private symbolTable: SymbolTable
  private typeInference: TypeInferenceEngine
  private errors: SemanticError[] = []
  private warnings: SemanticError[] = []

  constructor() {
    this.symbolTable = new SymbolTable()
    this.typeInference = new TypeInferenceEngine(this.symbolTable)
  }

  analyze(ast: SchemaAST): SchemaAnalysisResult {
    this.errors = []
    this.warnings = []
    // Re-initialize symbolTable and typeInference for each call to ensure a clean state.
    this.symbolTable = new SymbolTable()
    this.typeInference = new TypeInferenceEngine(this.symbolTable)

    // Phase 1: Build symbol table
    this.buildSymbolTable(ast)

    // Phase 2: Validate definitions (relations, types within them)
    this.validateDefinitions(ast)

    // Phase 3: Check for cycles using the original AST structure
    this.checkForCycles(ast)

    // Phase 4: Validate expressions using the original AST structure
    this.validateExpressions(ast)

    // Phase 5: Additional checks
    this.performAdditionalChecks(ast)

    const isValid = this.errors.length === 0
    const isFatalForUsage = this.errors.some(e =>
      fatalForUsageErrorCodes.includes(e.code),
    )

    const augmentedAst = this.augmentAst(ast)

    if (isFatalForUsage) {
      // If any "fatal for usage" errors exist, the augmented AST is not reliable,
      // even if it was partially built or built before the error was detected.
      return {
        augmentedAst: undefined,
        symbolTable: this.symbolTable, // Always return the symbol table
        errors: this.errors,
        warnings: this.warnings,
        isValid: isValid,
      }
    }

    return {
      augmentedAst,
      symbolTable: this.symbolTable, // Always return the symbol table
      errors: this.errors,
      warnings: this.warnings,
      isValid: isValid,
    }
  }

  private augmentAst(ast: SchemaAST): AugmentedSchemaAST | undefined {
    try {
      const augmentedDefinitions: (
        | AugmentedObjectTypeDefinition
        | CaveatDefinition
      )[] = []
      for (const def of ast.definitions) {
        if (def.type === 'definition') {
          // Map relations to AugmentedRelationDeclaration
          // For now, AugmentedRelationDeclaration is structurally identical to RelationDeclaration
          const augmentedRelations: AugmentedRelationDeclaration[] =
            def.relations.map(rel => ({
              ...rel,
            }))

          // Map permissions to AugmentedPermissionDeclaration, inferring types
          const augmentedPermissions: AugmentedPermissionDeclaration[] = []
          for (const perm of def.permissions) {
            const inferredTypes = this.typeInference.inferExpressionType(
              def.name,
              perm.expression,
            )
            augmentedPermissions.push({
              ...perm,
              inferredSubjectTypes: inferredTypes,
            })
          }

          const augmentedDef: AugmentedObjectTypeDefinition = {
            type: 'definition', // Explicitly set type
            name: def.name,
            relations: augmentedRelations,
            permissions: augmentedPermissions,
            // Safely access comments, assuming ObjectTypeDefinition might have 'comments'
            // even if not in its strict imported type, consistent with BaseNode expectation.
            comments: (def as ObjectTypeDefinition & { comments?: string[] })
              .comments,
          }
          augmentedDefinitions.push(augmentedDef)
        } else if (def.type === 'caveat') {
          // CaveatDefinitions are included as-is in the augmented AST
          augmentedDefinitions.push(def)
        }
      }
      return { definitions: augmentedDefinitions }
    } catch (e: any) {
      // Catch unexpected errors during the augmentation process itself
      this.addError(
        'AUGMENTATION_INTERNAL_ERROR',
        `Internal error during AST augmentation: ${e.message}`,
        {},
      )
      return undefined // Ensure AST is undefined if augmentation crashes
    }
  }

  // Phase 1: Build symbol table
  private buildSymbolTable(ast: SchemaAST): void {
    const definedNames = new Set<string>()

    for (const def of ast.definitions) {
      // Check for duplicate definitions
      if (definedNames.has(def.name)) {
        this.addError(
          'DUPLICATE_DEFINITION',
          `Duplicate definition name: ${def.name}`,
          { definition: def.name },
        )
      }
      definedNames.add(def.name)

      // Add to symbol table
      this.symbolTable.addDefinition(def)
    }
  }

  // Phase 2: Validate definitions
  private validateDefinitions(ast: SchemaAST): void {
    for (const def of ast.definitions) {
      if (def.type === 'definition') {
        this.validateObjectTypeDefinition(def as ObjectTypeDefinition)
      } else if (def.type === 'caveat') {
        this.validateCaveatDefinition(def as CaveatDefinition)
      }
    }
  }

  private validateObjectTypeDefinition(def: ObjectTypeDefinition): void {
    // Check for duplicate relation/permission names
    const names = new Set<string>()

    for (const rel of def.relations) {
      if (names.has(rel.name)) {
        this.addError(
          'DUPLICATE_MEMBER_NAME',
          `Duplicate relation/permission name '${rel.name}' in ${def.name}`,
          { definition: def.name, relation: rel.name },
        )
      }
      names.add(rel.name)
      this.validateRelation(def.name, rel)
    }

    for (const perm of def.permissions) {
      if (names.has(perm.name)) {
        this.addError(
          'DUPLICATE_MEMBER_NAME',
          `Duplicate relation/permission name '${perm.name}' in ${def.name}`,
          { definition: def.name, permission: perm.name },
        )
      }
      names.add(perm.name)
    }
  }

  private validateRelation(defName: string, rel: RelationDeclaration): void {
    for (const type of rel.types) {
      // Check if referenced type exists
      if (!this.symbolTable.hasDefinition(type.typeName)) {
        this.addError(
          'UNDEFINED_TYPE',
          `Undefined type '${type.typeName}' in relation '${rel.name}'`,
          { definition: defName, relation: rel.name },
        )
      }

      // If it has a sub-relation, check if it exists
      if (type.relation) {
        const targetType = this.symbolTable.getDefinition(type.typeName)
        if (targetType && targetType.type === 'definition') {
          if (
            !this.symbolTable.hasRelationOrPermission(
              type.typeName,
              type.relation,
            )
          ) {
            this.addError(
              'UNDEFINED_RELATION',
              `Undefined relation '${type.relation}' on type '${type.typeName}'`,
              { definition: defName, relation: rel.name },
            )
          }
        }
      }

      // Warn about wildcard usage
      if (type.wildcard) {
        this.addWarning(
          'WILDCARD_USAGE',
          `Wildcard used in relation '${rel.name}'. Be careful with public access.`,
          { definition: defName, relation: rel.name },
        )
      }
    }
  }

  private validateCaveatDefinition(def: CaveatDefinition): void {
    // Check parameter types
    const validTypes = [
      'int',
      'uint',
      'string',
      'bool',
      'bytes',
      'list',
      'map',
      'timestamp',
      'duration',
    ]

    for (const param of def.parameters) {
      if (!validTypes.includes(param.type)) {
        this.addError(
          'INVALID_PARAMETER_TYPE',
          `Invalid parameter type '${param.type}' in caveat '${def.name}'`,
          { definition: def.name },
        )
      }
    }

    // Check that caveat expression only references declared parameters
    const paramNames = new Set(def.parameters.map(p => p.name))
    if (!paramNames.has(def.expression.left)) {
      this.addError(
        'UNDEFINED_CAVEAT_PARAMETER',
        `Unknown parameter '${def.expression.left}' in caveat expression`,
        { definition: def.name },
      )
    }
  }

  // Phase 3: Check for cycles
  private checkForCycles(ast: SchemaAST): void {
    const graph = new DependencyGraph()

    // Build dependency graph
    for (const def of ast.definitions) {
      if (def.type === 'definition') {
        for (const perm of (def as ObjectTypeDefinition).permissions) {
          const fromNode = `${def.name}#${perm.name}`
          graph.addNode({
            type: 'permission',
            name: perm.name,
            fullName: fromNode,
          })

          this.addExpressionDependencies(
            graph,
            def.name,
            perm.name,
            perm.expression,
          )
        }
      }
    }

    // Find cycles
    const cycles = graph.findCycles()
    for (const cycle of cycles) {
      // A direct self-reference like 'perm -> perm' will appear as [perm, perm] in the cycle path.
      // These are often valid recursive definitions in SpiceDB (e.g., for hierarchical permissions).
      // We should not mark the schema as invalid for these specific types of cycles.
      // More complex cycles (e.g., A -> B -> A) are still considered errors.
      if (cycle.length === 2 && cycle[0] === cycle[1]) {
        // Optionally, we could add a specific warning or informational message here if needed,
        // but for now, we'll treat it as a valid pattern and not add an error.
        // Example: this.addWarning('SELF_REFERENTIAL_PERMISSION', `Permission ${cycle[0]} refers to itself.`, {});
        continue
      }
      this.addError(
        'CIRCULAR_DEPENDENCY',
        `Circular dependency detected: ${cycle.join(' -> ')}`,
        {},
      )
    }
  }

  private addExpressionDependencies(
    graph: DependencyGraph,
    defName: string,
    permName: string,
    expr: PermissionExpression,
  ): void {
    const fromNode = `${defName}#${permName}`

    switch (expr.type) {
      case 'identifier':
        // Check if it's a local relation/permission
        if (this.symbolTable.hasRelationOrPermission(defName, expr.name)) {
          const toNode = `${defName}#${expr.name}`
          graph.addNode({
            type: 'relation_or_permission',
            name: expr.name,
            fullName: toNode,
          })
          graph.addEdge(fromNode, toNode)
        }
        break

      case 'union':
      case 'intersection':
        for (const operand of expr.operands) {
          this.addExpressionDependencies(graph, defName, permName, operand)
        }
        break

      case 'exclusion':
        this.addExpressionDependencies(graph, defName, permName, expr.left)
        this.addExpressionDependencies(graph, defName, permName, expr.right)
        break

      case 'arrow':
      case 'any':
      case 'all': {
        // An arrow expression creates a dependency on the target permission.
        // Example: `permission p1 = self->p2`. This is a dependency from p1 to p2.
        // The type of `self` determines which definition `p2` is on.
        const leftTypes = this.typeInference.inferExpressionType(
          defName,
          expr.left,
        )
        if (leftTypes) {
          for (const leftType of leftTypes) {
            // We don't need to check if the target exists here, just add the dependency.
            // Validation of the target happens in `validateExpression`.
            const toNode = `${leftType.typeName}#${expr.target}`
            graph.addNode({
              type: 'relation_or_permission',
              name: expr.target,
              fullName: toNode,
            })
            graph.addEdge(fromNode, toNode)
          }
        }
        // Also recurse on the left side of the arrow.
        this.addExpressionDependencies(graph, defName, permName, expr.left)
        break
      }
    }
  }

  // Phase 4: Validate expressions
  private validateExpressions(ast: SchemaAST): void {
    for (const def of ast.definitions) {
      if (def.type === 'definition') {
        for (const perm of (def as ObjectTypeDefinition).permissions) {
          this.validateExpression(def.name, perm.expression)
        }
      }
    }
  }

  private validateExpression(
    defName: string,
    expr: PermissionExpression,
  ): void {
    switch (expr.type) {
      case 'identifier':
        // Check if identifier exists in current type
        if (!this.symbolTable.hasRelationOrPermission(defName, expr.name)) {
          this.addError(
            'UNDEFINED_IDENTIFIER',
            `Undefined identifier '${expr.name}' in type '${defName}'`,
            { definition: defName },
          )
        }
        break

      case 'union':
      case 'intersection':
        if (expr.operands.length < 2) {
          this.addError(
            'INVALID_EXPRESSION',
            `${expr.type} expression must have at least 2 operands`,
            { definition: defName },
          )
        }
        for (const operand of expr.operands) {
          this.validateExpression(defName, operand)
        }
        break

      case 'exclusion':
        this.validateExpression(defName, expr.left)
        this.validateExpression(defName, expr.right)
        break

      case 'arrow':
      case 'any':
      case 'all': {
        this.validateExpression(defName, expr.left)

        const leftTypes = this.typeInference.inferExpressionType(
          defName,
          expr.left,
        )
        if (leftTypes) {
          let targetFound = false
          for (const leftType of leftTypes) {
            if (
              this.symbolTable.hasRelationOrPermission(
                leftType.typeName,
                expr.target,
              )
            ) {
              targetFound = true
              break
            }
          }
          if (!targetFound) {
            const resolvedTypeNames = leftTypes.map(t => t.typeName).join(', ')
            this.addError(
              'UNDEFINED_ARROW_TARGET',
              `Target '${expr.target}' not found on resolved types [${resolvedTypeNames}] for expression starting with '${(expr.left as any).name}'`,
              { definition: defName },
            )
          }
        }
        break
      }
    }
  }

  // Phase 5: Additional checks
  private performAdditionalChecks(ast: SchemaAST): void {
    // Check for unused definitions
    const usedTypes = new Set<string>()

    for (const def of ast.definitions) {
      if (def.type === 'definition') {
        for (const rel of (def as ObjectTypeDefinition).relations) {
          for (const type of rel.types) {
            usedTypes.add(type.typeName)
          }
        }
      }
    }

    for (const def of ast.definitions) {
      if (def.type === 'definition' && !usedTypes.has(def.name)) {
        // Check if it's referenced in any arrow expressions

        // This is a simplified check
        const isUsed = false
        // TODO: Implement complete usage check

        if (!isUsed && def.name !== 'user') {
          // 'user' is often a root type
          this.addWarning(
            'UNUSED_DEFINITION',
            `Definition '${def.name}' is not referenced anywhere`,
            { definition: def.name },
          )
        }
      }
    }

    // Check for permissions without any granting mechanism
    for (const def of ast.definitions) {
      if (def.type === 'definition') {
        for (const perm of (def as ObjectTypeDefinition).permissions) {
          if (this.isEmptyPermission(perm.expression)) {
            this.addWarning(
              'EMPTY_PERMISSION',
              `Permission '${perm.name}' in '${def.name}' has no granting mechanism`,
              { definition: def.name, permission: perm.name },
            )
          }
        }
      }
    }
  }

  private isEmptyPermission(_expr: PermissionExpression): boolean {
    // This is a simplified check - would need more sophisticated analysis
    return false
  }

  // Helper methods
  private addError(code: string, message: string, location: any): void {
    this.errors.push({
      type: 'semantic_error',
      code,
      message,
      location,
    })
  }

  private addWarning(code: string, message: string, location: any): void {
    this.warnings.push({
      type: 'semantic_error',
      code,
      message,
      location,
    })
  }
}

export function analyzeSpiceDbSchema(ast: SchemaAST): SchemaAnalysisResult {
  const analyzer = new SemanticAnalyzer()
  return analyzer.analyze(ast)
}
