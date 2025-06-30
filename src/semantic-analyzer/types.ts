import {
  CaveatDefinition,
  PermissionDeclaration,
  RelationDeclaration,
  RelationType,
} from '../schema-parser/parser'

// ============================================================================
// Error Types
// ============================================================================

export interface SemanticError {
  type: 'semantic_error'
  code: string
  message: string
  location?: {
    definition?: string
    relation?: string
    permission?: string
  }
}

// ============================================================================
// Result & Augmented AST Types
// ============================================================================

export interface SchemaAnalysisResult {
  augmentedAst?: AugmentedSchemaAST
  symbolTable: any // Using 'any' to avoid circular dependency with symbol-table.ts
  errors: SemanticError[]
  warnings: SemanticError[]
  isValid: boolean // True if errors array is empty
}

export interface AugmentedSchemaAST {
  definitions: (AugmentedObjectTypeDefinition | CaveatDefinition)[]
  // CaveatDefinition is included as-is from schema-parser
}

export interface AugmentedObjectTypeDefinition {
  type: 'definition'
  name: string
  relations: AugmentedRelationDeclaration[]
  permissions: AugmentedPermissionDeclaration[]
  comments?: string[] // From BaseNode, which ObjectTypeDefinition originally extends
}

export interface AugmentedRelationDeclaration extends RelationDeclaration {
  // Currently, this structure is the same as RelationDeclaration.  It's part of the "augmented" AST
  // structure, and its types are validated.  Consumers can use the SymbolTable (returned in
  // SchemaAnalysisResult) to resolve typeName to full definitions if needed.
}

export interface AugmentedPermissionDeclaration extends PermissionDeclaration {
  inferredSubjectTypes: RelationType[] | null
}
