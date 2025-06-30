# SpiceDB Zed Schema Parser

A TypeScript library for parsing, analyzing, and generating type-safe SDKs from SpiceDB's `.zed` schema files.

## Overview

This library provides a complete toolchain for working with SpiceDB schemas, transforming its schema DSL into type-safe TypeScript APIs. It consists of three main components:

1. **Schema Parser** - Parses `.zed` files into structured ASTs using Chevrotain
2. **Schema Analyzer** - Performs semantic analysis and type inference
3. **SDK Generator** - Creates type-safe TypeScript SDKs from analyzed schemas

Additionally, it includes a **Fluent Builder Library** that provides an ergonomic API for SpiceDB operations, serving as a bridge between the verbose `@authzed/authzed-node` gRPC client and your type-safe generated SDK.

## Problems Solved

### 1. **Type Safety**

Convert string-based SpiceDB operations into compile-time checked TypeScript:

```typescript
// ❌ Error-prone: strings everywhere, no compile-time validation
await client.checkPermission({
  resource: {
    objectType: "document",
    objectId: "doc1"
  },
  permission: "edit", // Could be misspelled
  subject: {
    object: {
      objectType: "user",
      objectId: "alice"
    }
  },
});

// ✅ Type-safe: generated from your schema
await permissions.document.check.edit("user:alice", "document:doc1").execute();
```

### 2. **Schema Validation**

Catch schema errors early with comprehensive semantic analysis:

- Undefined type references
- Circular dependencies
- Invalid permission expressions
- Duplicate definitions

### 3. **Developer Experience**

Replace verbose gRPC objects with fluent, chainable APIs:

(Note: this layer is not type-safe, but you can drop down to it if the type-safe SDK you generate from your schema.zed file is insufficient to the task).

```typescript
// ❌ Verbose gRPC style
await client.writeRelationships({
  updates: [
    {
      operation: RelationshipUpdate_Operation.TOUCH,
      relationship: {
        resource: { objectType: "document", objectId: "doc1" },
        relation: "editor",
        subject: { object: { objectType: "user", objectId: "alice" } },
      },
    },
  ],
});

// ✅ Fluent builder style
await perms
  .grant("editor")
  .subject("user:alice")
  .resource("document:doc1")
  .execute();
```

### 4. **Code Generation**

Automatically generate SDKs that stay in sync with schema changes, preventing runtime errors when schemas evolve.

## Installation

```bash
npm install @schoolai/spicedb-zed-schema-parser
```

## Quick Start

Here's a complete example of parsing a schema and generating a type-safe SDK:

```typescript
import fs from "node:fs/promises";
import {
  parseSpiceDBSchema,
  analyzeSpiceDbSchema,
  generateSDK,
} from "@schoolai/spicedb-zed-schema-parser";

async function generatePermissionsSDK() {
  // 1. Read your schema file
  const schemaContent = await fs.readFile("schema.zed", "utf-8");

  // 2. Parse the schema
  const { ast, errors: parseErrors } = parseSpiceDBSchema(schemaContent);
  if (parseErrors.length > 0) {
    console.error("Parse errors:", parseErrors);
    return;
  }

  // 3. Analyze the schema
  const {
    augmentedAst,
    errors: analysisErrors,
    isValid,
  } = analyzeSpiceDbSchema(ast!);
  if (!isValid) {
    console.error("Analysis errors:", analysisErrors);
    return;
  }

  // 4. Generate TypeScript SDK
  const generatedCode = generateSDK(augmentedAst!);

  // 5. Write to file
  await fs.writeFile("generated/permissions.ts", generatedCode);
  console.log("✅ Type-safe permissions SDK generated!");
}
```

## Example Schema

```zed
definition user {}

definition document {
    relation owner: user
    relation editor: user
    relation viewer: user

    permission edit = owner + editor
    permission view = owner + editor + viewer
}

definition folder {
    relation owner: user
    relation editor: user
    relation parent: folder

    permission edit = owner + editor + parent->edit
    permission view = owner + editor + parent->view
}
```

## Generated SDK Usage

The generated SDK provides type-safe methods for all your schema operations:

```typescript
import { permissions } from "./generated/permissions";

// ✅ Type-safe operations - TypeScript will catch typos and invalid combinations
await permissions.document.grant
  .editor("user:alice", "document:doc1")
  .execute();
await permissions.document.check.view("user:bob", "document:doc1").execute();
await permissions.folder.find.byOwner("user:alice").execute();

// ❌ TypeScript errors for invalid operations
await permissions.document.grant.invalidRelation("user:alice", "document:doc1"); // Error!
await permissions.document.check.edit("invalid:type", "document:doc1"); // Error!
```

## Fluent Builder API

For cases where you need dynamic operations or are migrating from string-based APIs, use the fluent builder:

```typescript
import {
  createPermissions,
  Operations,
} from "@schoolai/spicedb-zed-schema-parser";

const perms = createPermissions(spicedbClient);

// Grant permissions
await perms
  .grant("editor")
  .subject("user:alice")
  .resource("document:doc1")
  .execute();

// Check permissions
const hasPermission = await perms
  .check("view")
  .subject("user:bob")
  .resource("document:doc1")
  .execute();

// Batch operations
await perms
  .batch()
  .grant("viewer").subject("user:charlie").resource("folder:f1")
  .and()
  .revoke("editor").subject("user:alice").resource("document:doc1")
  .and()
  .commit();

// Use static builders for pure operations
const deleteOp = Operations.delete().where({
  resourceType: "document",
  resourceId: "doc1",
});
await perms.execute(deleteOp);
```

## API Reference

### Core Functions

#### `parseSpiceDBSchema(text: string): ParseResult`

Parses a SpiceDB schema string into an AST.

```typescript
const { ast, errors } = parseSpiceDBSchema(schemaContent);
```

#### `analyzeSpiceDbSchema(ast: SchemaAST): SchemaAnalysisResult`

Performs semantic analysis on a parsed schema.

```typescript
const { augmentedAst, errors, isValid } = analyzeSpiceDbSchema(ast);
```

#### `generateSDK(schema: AugmentedSchemaAST): string`

Generates TypeScript code for a type-safe permissions SDK.

```typescript
const generatedCode = generateSDK(augmentedAst);
```

### Builder Classes

#### `createPermissions(client: SpiceDBClient): Permissions`

Creates a permissions instance with bound SpiceDB client.

#### `Operations` (Static Builder)

Provides static methods for creating pure operations:

- `Operations.grant(relation: string)`
- `Operations.revoke(relation: string)`
- `Operations.check(permission: string)`
- `Operations.find()`
- `Operations.delete()`
- `Operations.batch()`

## Schema Features Supported

- ✅ **Definitions** - Object type definitions
- ✅ **Relations** - Direct relations between objects
- ✅ **Permissions** - Computed permissions with complex expressions
- ✅ **Caveats** - Conditional logic (basic support)
- ✅ **Union expressions** - `permission = rel1 + rel2`
- ✅ **Intersection expressions** - `permission = rel1 & rel2`
- ✅ **Exclusion expressions** - `permission = rel1 - rel2`
- ✅ **Arrow expressions** - `permission = rel->permission`
- ✅ **Wildcard relations** - `relation public: user:*`
- ✅ **Sub-relations** - `relation editor: user#admin`
- ✅ **Doc comments** - `/** documentation */`

## Error Handling

The library provides comprehensive error reporting:

### Parse Errors

```typescript
const { ast, errors } = parseSpiceDBSchema(invalidSchema);
if (errors.length > 0) {
  errors.forEach((err) => {
    console.error(`${err.message} at line ${err.line}, column ${err.column}`);
  });
}
```

### Semantic Errors

```typescript
const { isValid, errors } = analyzeSpiceDbSchema(ast);
if (!isValid) {
  errors.forEach((err) => {
    console.error(`${err.code}: ${err.message}`);
  });
}
```

Common error types:

- `UNDEFINED_TYPE` - Referenced type doesn't exist
- `CIRCULAR_DEPENDENCY` - Circular permission dependencies
- `DUPLICATE_DEFINITION` - Duplicate type names
- `UNDEFINED_RELATION` - Referenced relation doesn't exist
- `INVALID_EXPRESSION` - Malformed permission expression

## Architecture

```
┌─────────────┐    ┌──────────────┐    ┌─────────────────┐    ┌──────────────┐
│ .zed Schema │───▶│ Parser       │───▶│ Semantic        │───▶│ SDK          │
│             │    │ (Chevrotain) │    │ Analyzer        │    │ Generator    │
└─────────────┘    └──────────────┘    └─────────────────┘    └──────────────┘
                           │                     │                     │
                           ▼                     ▼                     ▼
                   ┌──────────────┐    ┌─────────────────┐    ┌──────────────┐
                   │ AST          │    │ Augmented AST   │    │ TypeScript   │
                   │              │    │ + Type Info     │    │ SDK Code     │
                   └──────────────┘    └─────────────────┘    └──────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ Fluent Builder Library (Independent)                                        │
│ ┌─────────────┐    ┌──────────────┐    ┌─────────────────┐                  │
│ │ Operations  │───▶│ Fluent API   │───▶│ SpiceDB Client  │                  │
│ │ Builder     │    │ (Chainable)  │    │ (gRPC)          │                  │
│ └─────────────┘    └──────────────┘    └─────────────────┘                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Development

### Building

```bash
npm run build
```

### Testing

```bash
npm test
```

### Linting

```bash
npm run lint
npm run lint:fix
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes and add tests
4. Run the test suite: `npm test`
5. Commit your changes: `git commit -m 'Add amazing feature'`
6. Push to the branch: `git push origin feature/amazing-feature`
7. Open a Pull Request

## Related Projects

- [SpiceDB](https://github.com/authzed/spicedb) - The authorization system this library supports
- [@authzed/authzed-node](https://github.com/authzed/authzed-node) - Official Node.js client for SpiceDB
- [Chevrotain](https://github.com/Chevrotain/chevrotain) - Parser building toolkit used for `.zed` parsing
