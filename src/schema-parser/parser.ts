import { CstParser, createToken, ICstVisitor, Lexer } from 'chevrotain'

// ============================================================================
// Lexer Definition
// ============================================================================

// Literals and Identifiers
const Identifier = createToken({
  name: 'Identifier',
  pattern: /[a-zA-Z_][a-zA-Z0-9_]*/,
})
const Integer = createToken({ name: 'Integer', pattern: /0|[1-9]\d*/ })
const StringLiteral = createToken({ name: 'StringLiteral', pattern: /"[^"]*"/ })

// Keywords
const Definition = createToken({
  name: 'Definition',
  pattern: /definition/,
  longer_alt: Identifier,
})
const Caveat = createToken({
  name: 'Caveat',
  pattern: /caveat/,
  longer_alt: Identifier,
})
const Relation = createToken({
  name: 'Relation',
  pattern: /relation/,
  longer_alt: Identifier,
})
const Permission = createToken({
  name: 'Permission',
  pattern: /permission/,
  longer_alt: Identifier,
})

// Operators
const Plus = createToken({ name: 'Plus', pattern: /\+/ })
const Minus = createToken({ name: 'Minus', pattern: /-/ })
const Ampersand = createToken({ name: 'Ampersand', pattern: /&/ })
const Arrow = createToken({ name: 'Arrow', pattern: /->/ })
const Dot = createToken({ name: 'Dot', pattern: /\./ })
const Hash = createToken({ name: 'Hash', pattern: /#/ })
const Colon = createToken({ name: 'Colon', pattern: /:/ })
const Semicolon = createToken({ name: 'Semicolon', pattern: /;/ })
const Comma = createToken({ name: 'Comma', pattern: /,/ })
const Equals = createToken({ name: 'Equals', pattern: /==/ })
const Assign = createToken({ name: 'Assign', pattern: /=/, longer_alt: Equals })
const Star = createToken({ name: 'Star', pattern: /\*/ })
const Pipe = createToken({ name: 'Pipe', pattern: /\|/ })

// Delimiters
const LParen = createToken({ name: 'LParen', pattern: /\(/ })
const RParen = createToken({ name: 'RParen', pattern: /\)/ })
const LBrace = createToken({ name: 'LBrace', pattern: /\{/ })
const RBrace = createToken({ name: 'RBrace', pattern: /\}/ })

// Special tokens
const Any = createToken({ name: 'Any', pattern: /any/, longer_alt: Identifier })
const All = createToken({ name: 'All', pattern: /all/, longer_alt: Identifier })

// Comments
const BlockComment = createToken({
  name: 'BlockComment',
  pattern: /\/\*[\s\S]*?\*\//,
  group: Lexer.SKIPPED,
})

const DocComment = createToken({
  name: 'DocComment',
  pattern: /\/\*\*[\s\S]*?\*\//,
  group: 'comments',
})

const LineComment = createToken({
  name: 'LineComment',
  pattern: /\/\/[^\n\r]*/,
  group: Lexer.SKIPPED,
})

// Whitespace
const WhiteSpace = createToken({
  name: 'WhiteSpace',
  pattern: /\s+/,
  group: Lexer.SKIPPED,
})

// All tokens in order of precedence
const allTokens = [
  // Comments (before other tokens to handle properly)
  DocComment,
  BlockComment,
  LineComment,
  WhiteSpace,

  // Multi-character operators (before single-character)
  Arrow,
  Equals,

  // Keywords (before Identifier)
  Definition,
  Caveat,
  Relation,
  Permission,
  Any,
  All,

  // Literals
  Integer,
  StringLiteral,
  Identifier,

  // Single-character operators
  Plus,
  Minus,
  Ampersand,
  Dot,
  Hash,
  Colon,
  Semicolon,
  Comma,
  Assign,
  Star,
  Pipe,

  // Delimiters
  LParen,
  RParen,
  LBrace,
  RBrace,
]

// Create the lexer
export const SpiceDBLexer = new Lexer(allTokens)

// ============================================================================
// Parser Definition
// ============================================================================

export class SpiceDBParser extends CstParser {
  constructor() {
    super(allTokens)
    this.performSelfAnalysis()
  }

  // Top-level rule
  public schema = this.RULE('schema', () => {
    this.MANY(() => {
      this.OR([
        { ALT: () => this.SUBRULE(this.caveatDefinition) },
        { ALT: () => this.SUBRULE(this.objectTypeDefinition) },
      ])
    })
  })

  // Caveat definition
  private caveatDefinition = this.RULE('caveatDefinition', () => {
    this.OPTION(() => this.CONSUME(DocComment))
    this.CONSUME(Caveat)
    this.CONSUME(Identifier, { LABEL: 'name' })
    this.CONSUME(LParen)
    this.OPTION2(() => this.SUBRULE(this.parameterList))
    this.CONSUME(RParen)
    this.CONSUME(LBrace)
    this.SUBRULE(this.caveatExpression)
    this.CONSUME(RBrace)
  })

  // Parameter list for caveats
  private parameterList = this.RULE('parameterList', () => {
    this.SUBRULE(this.parameter)
    this.MANY(() => {
      this.CONSUME(Comma)
      this.SUBRULE2(this.parameter)
    })
  })

  // Single parameter
  private parameter = this.RULE('parameter', () => {
    this.CONSUME(Identifier, { LABEL: 'paramName' })
    this.CONSUME2(Identifier, { LABEL: 'paramType' })
  })

  // Caveat expression (simplified for now)
  private caveatExpression = this.RULE('caveatExpression', () => {
    this.CONSUME(Identifier, { LABEL: 'left' })
    this.CONSUME(Equals)
    this.CONSUME(Integer, { LABEL: 'right' })
  })

  // Object type definition
  private objectTypeDefinition = this.RULE('objectTypeDefinition', () => {
    this.OPTION(() => this.CONSUME(DocComment))
    this.CONSUME(Definition)
    this.CONSUME(Identifier, { LABEL: 'name' })
    this.CONSUME(LBrace)
    this.MANY(() => {
      this.OR([
        { ALT: () => this.SUBRULE(this.relationDeclaration) },
        { ALT: () => this.SUBRULE(this.permissionDeclaration) },
      ])
    })
    this.CONSUME(RBrace)
  })

  // Relation declaration
  private relationDeclaration = this.RULE('relationDeclaration', () => {
    this.OPTION(() => this.CONSUME(DocComment))
    this.CONSUME(Relation)
    this.CONSUME(Identifier, { LABEL: 'name' })
    this.CONSUME(Colon)
    this.SUBRULE(this.relationTypes)
  })

  // Relation types (union of allowed types)
  private relationTypes = this.RULE('relationTypes', () => {
    this.SUBRULE(this.relationType)
    this.MANY(() => {
      this.CONSUME(Pipe)
      this.SUBRULE2(this.relationType)
    })
  })

  // Single relation type
  private relationType = this.RULE('relationType', () => {
    this.CONSUME(Identifier, { LABEL: 'typeName' })
    this.OPTION(() => {
      this.OR([
        {
          ALT: () => {
            this.CONSUME(Colon)
            this.CONSUME(Star)
          },
        },
        {
          ALT: () => {
            this.CONSUME(Hash)
            this.CONSUME2(Identifier, { LABEL: 'relation' })
          },
        },
      ])
    })
  })

  // Permission declaration
  private permissionDeclaration = this.RULE('permissionDeclaration', () => {
    this.OPTION(() => this.CONSUME(DocComment))
    this.CONSUME(Permission)
    this.CONSUME(Identifier, { LABEL: 'name' })
    this.CONSUME(Assign)
    this.SUBRULE(this.permissionExpression)
  })

  // Permission expression with proper precedence
  private permissionExpression = this.RULE('permissionExpression', () => {
    this.SUBRULE(this.unionExpression)
  })

  // Union expression (lowest precedence)
  private unionExpression = this.RULE('unionExpression', () => {
    this.SUBRULE(this.intersectionExpression)
    this.MANY(() => {
      this.CONSUME(Plus)
      this.SUBRULE2(this.intersectionExpression)
    })
  })

  // Intersection expression
  private intersectionExpression = this.RULE('intersectionExpression', () => {
    this.SUBRULE(this.exclusionExpression)
    this.MANY(() => {
      this.CONSUME(Ampersand)
      this.SUBRULE2(this.exclusionExpression)
    })
  })

  // Exclusion expression
  private exclusionExpression = this.RULE('exclusionExpression', () => {
    this.SUBRULE(this.arrowExpression)
    this.MANY(() => {
      this.CONSUME(Minus)
      this.SUBRULE2(this.arrowExpression)
    })
  })

  // Arrow expression (highest precedence)
  private arrowExpression = this.RULE('arrowExpression', () => {
    this.SUBRULE(this.primaryExpression)
    this.MANY(() => {
      this.OR([
        {
          ALT: () => {
            this.CONSUME(Arrow)
            this.CONSUME(Identifier, { LABEL: 'arrowTarget' })
          },
        },
        {
          ALT: () => {
            this.CONSUME(Dot)
            this.OR2([
              {
                ALT: () => {
                  this.CONSUME(Any)
                  this.CONSUME(LParen)
                  this.CONSUME2(Identifier, { LABEL: 'anyTarget' })
                  this.CONSUME(RParen)
                },
              },
              {
                ALT: () => {
                  this.CONSUME(All)
                  this.CONSUME2(LParen)
                  this.CONSUME3(Identifier, { LABEL: 'allTarget' })
                  this.CONSUME2(RParen)
                },
              },
            ])
          },
        },
      ])
    })
  })

  // Primary expression (identifiers and parentheses)
  private primaryExpression = this.RULE('primaryExpression', () => {
    this.OR([
      {
        ALT: () => {
          this.CONSUME(Identifier)
        },
      },
      {
        ALT: () => {
          this.CONSUME(LParen)
          this.SUBRULE(this.permissionExpression)
          this.CONSUME(RParen)
        },
      },
    ])
  })
}

// Create parser instance
export const parserInstance = new SpiceDBParser()

// ============================================================================
// AST Types
// ============================================================================

export interface SchemaAST {
  definitions: (CaveatDefinition | ObjectTypeDefinition)[]
}

export interface CaveatDefinition {
  type: 'caveat'
  name: string
  docComment?: string
  parameters: Parameter[]
  expression: CaveatExpression
}

export interface Parameter {
  name: string
  type: string
}

export interface CaveatExpression {
  left: string
  operator: 'equals'
  right: number
}

export interface ObjectTypeDefinition {
  type: 'definition'
  name: string
  docComment?: string
  relations: RelationDeclaration[]
  permissions: PermissionDeclaration[]
}

export interface RelationDeclaration {
  name: string
  docComment?: string
  types: RelationType[]
}

export interface RelationType {
  typeName: string
  wildcard?: boolean
  relation?: string
}

export interface PermissionDeclaration {
  name: string
  docComment?: string
  expression: PermissionExpression
}

export type PermissionExpression =
  | IdentifierExpression
  | UnionExpression
  | IntersectionExpression
  | ExclusionExpression
  | ArrowExpression
  | AnyExpression
  | AllExpression

export interface IdentifierExpression {
  type: 'identifier'
  name: string
}

export interface UnionExpression {
  type: 'union'
  operands: PermissionExpression[]
}

export interface IntersectionExpression {
  type: 'intersection'
  operands: PermissionExpression[]
}

export interface ExclusionExpression {
  type: 'exclusion'
  left: PermissionExpression
  right: PermissionExpression
}

export interface ArrowExpression {
  type: 'arrow'
  left: PermissionExpression
  target: string
}

export interface AnyExpression {
  type: 'any'
  left: PermissionExpression
  target: string
}

export interface AllExpression {
  type: 'all'
  left: PermissionExpression
  target: string
}

// ============================================================================
// CST to AST Visitor
// ============================================================================

const BaseVisitor = parserInstance.getBaseCstVisitorConstructor()

export class SpiceDBVisitor
  extends BaseVisitor
  implements ICstVisitor<any, any>
{
  constructor() {
    super()
    this.validateVisitor()
  }

  schema(ctx: any): SchemaAST {
    const definitions: (CaveatDefinition | ObjectTypeDefinition)[] = []

    if (ctx.caveatDefinition) {
      definitions.push(...ctx.caveatDefinition.map((cd: any) => this.visit(cd)))
    }

    if (ctx.objectTypeDefinition) {
      definitions.push(
        ...ctx.objectTypeDefinition.map((od: any) => this.visit(od)),
      )
    }

    return { definitions }
  }

  caveatDefinition(ctx: any): CaveatDefinition {
    const docComment = ctx.DocComment ? ctx.DocComment[0].image : undefined
    const name = ctx.name[0].image
    const parameters = ctx.parameterList ? this.visit(ctx.parameterList[0]) : []
    const expression = this.visit(ctx.caveatExpression[0])

    return {
      type: 'caveat',
      name,
      docComment,
      parameters,
      expression,
    }
  }

  parameterList(ctx: any): Parameter[] {
    const params: Parameter[] = []

    if (ctx.parameter) {
      params.push(...ctx.parameter.map((p: any) => this.visit(p)))
    }

    return params
  }

  parameter(ctx: any): Parameter {
    return {
      name: ctx.paramName[0].image,
      type: ctx.paramType[0].image,
    }
  }

  caveatExpression(ctx: any): CaveatExpression {
    return {
      left: ctx.left[0].image,
      operator: 'equals',
      right: parseInt(ctx.right[0].image),
    }
  }

  objectTypeDefinition(ctx: any): ObjectTypeDefinition {
    const docComment = ctx.DocComment ? ctx.DocComment[0].image : undefined
    const name = ctx.name[0].image
    const relations: RelationDeclaration[] = []
    const permissions: PermissionDeclaration[] = []

    if (ctx.relationDeclaration) {
      relations.push(...ctx.relationDeclaration.map((r: any) => this.visit(r)))
    }

    if (ctx.permissionDeclaration) {
      permissions.push(
        ...ctx.permissionDeclaration.map((p: any) => this.visit(p)),
      )
    }

    return {
      type: 'definition',
      name,
      docComment,
      relations,
      permissions,
    }
  }

  relationDeclaration(ctx: any): RelationDeclaration {
    const docComment = ctx.DocComment ? ctx.DocComment[0].image : undefined
    const name = ctx.name[0].image
    const types = this.visit(ctx.relationTypes[0])

    return {
      name,
      docComment,
      types,
    }
  }

  relationTypes(ctx: any): RelationType[] {
    const types: RelationType[] = []

    if (ctx.relationType) {
      types.push(...ctx.relationType.map((t: any) => this.visit(t)))
    }

    return types
  }

  relationType(ctx: any): RelationType {
    const typeName = ctx.typeName[0].image
    const result: RelationType = { typeName }

    if (ctx.Star) {
      result.wildcard = true
    } else if (ctx.relation) {
      result.relation = ctx.relation[0].image
    }

    return result
  }

  permissionDeclaration(ctx: any): PermissionDeclaration {
    const docComment = ctx.DocComment ? ctx.DocComment[0].image : undefined
    const name = ctx.name[0].image
    const expression = this.visit(ctx.permissionExpression[0])

    return {
      name,
      docComment,
      expression,
    }
  }

  permissionExpression(ctx: any): PermissionExpression {
    return this.visit(ctx.unionExpression[0])
  }

  unionExpression(ctx: any): PermissionExpression {
    if (!ctx.Plus) {
      return this.visit(ctx.intersectionExpression[0])
    }

    const operands: PermissionExpression[] = ctx.intersectionExpression.map(
      (e: any) => this.visit(e),
    )

    return {
      type: 'union',
      operands,
    }
  }

  intersectionExpression(ctx: any): PermissionExpression {
    if (!ctx.Ampersand) {
      return this.visit(ctx.exclusionExpression[0])
    }

    const operands: PermissionExpression[] = ctx.exclusionExpression.map(
      (e: any) => this.visit(e),
    )

    return {
      type: 'intersection',
      operands,
    }
  }

  exclusionExpression(ctx: any): PermissionExpression {
    if (!ctx.Minus) {
      return this.visit(ctx.arrowExpression[0])
    }

    const [left, right] = ctx.arrowExpression.map((e: any) => this.visit(e))

    return {
      type: 'exclusion',
      left,
      right,
    }
  }

  arrowExpression(ctx: any): PermissionExpression {
    let expr = this.visit(ctx.primaryExpression[0])

    if (ctx.Arrow) {
      for (let i = 0; i < ctx.Arrow.length; i++) {
        expr = {
          type: 'arrow',
          left: expr,
          target: ctx.arrowTarget[i].image,
        }
      }
    }

    if (ctx.anyTarget) {
      for (let i = 0; i < ctx.anyTarget.length; i++) {
        expr = {
          type: 'any',
          left: expr,
          target: ctx.anyTarget[i].image,
        }
      }
    }

    if (ctx.allTarget) {
      for (let i = 0; i < ctx.allTarget.length; i++) {
        expr = {
          type: 'all',
          left: expr,
          target: ctx.allTarget[i].image,
        }
      }
    }

    return expr
  }

  primaryExpression(ctx: any): PermissionExpression {
    if (ctx.Identifier) {
      return {
        type: 'identifier',
        name: ctx.Identifier[0].image,
      }
    }

    return this.visit(ctx.permissionExpression[0])
  }
}

// ============================================================================
// Parser API
// ============================================================================

export interface ParseResult {
  ast?: SchemaAST
  errors: Array<{
    message: string
    line: number
    column: number
  }>
}

export function parseSpiceDBSchema(text: string): ParseResult {
  // Tokenize
  const lexingResult = SpiceDBLexer.tokenize(text)

  if (lexingResult.errors.length > 0) {
    return {
      errors: lexingResult.errors.map(error => ({
        message: error.message,
        line: error.line || 0,
        column: error.column || 0,
      })),
    }
  }

  // Parse
  parserInstance.input = lexingResult.tokens
  const cst = parserInstance.schema()

  if (parserInstance.errors.length > 0) {
    return {
      errors: parserInstance.errors.map(error => ({
        message: error.message,
        line: error.token?.startLine || 0,
        column: error.token?.startColumn || 0,
      })),
    }
  }

  // Convert CST to AST
  const visitor = new SpiceDBVisitor()
  const ast = visitor.visit(cst)

  return {
    ast,
    errors: [],
  }
}
