# SpiceDB Zed Schema Parser

A TypeScript library for parsing, analyzing, and generating type-safe SDKs from SpiceDB's `.zed` schema files.

## Overview

This library provides a complete toolchain for working with SpiceDB schemas, transforming its schema DSL into type-safe TypeScript APIs. It consists of three main components:

1. **Schema Parser** - Parses `.zed` files into structured ASTs using Chevrotain
2. **Semantic Analyzer** - Performs semantic analysis and type inference on the parsed AST
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
    objectId: "doc1",
  },
  permission: "edit", // Could be misspelled
  subject: {
    object: {
      objectType: "user",
      objectId: "alice",
    },
  },
});

// ✅ Type-safe: generated from your schema
await permissions.document.check
  .edit("user:alice", "document:doc1")
  .execute(spicedbClient);
```

### 2. **Schema Validation**

Catch schema errors early with comprehensive semantic analysis:

- Undefined type references
- Circular dependencies
- Invalid permission expressions
- Duplicate definitions

### 3. **Developer Experience**

Replace verbose gRPC objects with fluent, chainable APIs:

The builder layer is intentionally string-based — drop down to it when you need dynamic relations or operations whose shape isn't known until runtime. The generated SDK is a thin, type-safe facade over these same primitives.

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
pnpm install @schoolai/spicedb-zed-schema-parser
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
    /** @check: isOwnedBy */
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

> Tip: the `@check: <name>` directive in a relation's doc comment renames its auto-generated relation check (see [Generated SDK Usage](#generated-sdk-usage)). Without it, `relation owner: user` would surface as `permissions.document.check.isOwner(...)`; with it, you get `permissions.document.check.isOwnedBy(...)`.

## Generated SDK Shape

For each definition with relations or permissions, the generator emits a typed surface under `permissions.<type>`:

| Surface                                                                              | What it does                                                |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `permissions.<type>.grant.<relation>(subject, resource)`                             | Grant a relation — `subject` accepts a single ref or array  |
| `permissions.<type>.revoke.<relation>(subject, resource)`                            | Revoke a relation — also accepts arrays                     |
| `permissions.<type>.check.<permission>(subject, resource)`                           | Type-safe permission check                                  |
| `permissions.<type>.check.is<Relation>(subject, resource)`                           | Auto-generated relation check (rename via `@check:`)        |
| `permissions.<type>.checkBulk(permission, subject, resources[])`                     | Single `CheckBulkPermissions` gRPC call                     |
| `permissions.<type>.find.by<Relation>(subject)`                                      | Find resources where subject holds `<Relation>`             |
| `permissions.<type>.lookup.resources(subject, permission)`                           | `LookupResources` for accessible objects                    |
| `permissions.<type>.lookup.subjects(resource, permission, subjectType)`              | `LookupSubjects` for who can do something                   |
| `permissions.<type>.deleteAll({ relation?, subjectType?, subjectId?, resourceId? })` | Filtered bulk delete                                        |
| `permissions.batch(...operations)`                                                   | Combine writes into a single transaction                    |
| `dynamicGrant / dynamicRevoke / dynamicCheck` + `GrantParams / RevokeParams / CheckParams` | Runtime dispatch with discriminated-union safety       |

## Generated SDK Usage

The generated SDK provides type-safe methods for every schema surface above. Subject and resource literals are validated at compile time from the relations declared in your schema.

Every generated method returns a pure `Operation<T>` — pass your SpiceDB client to `.execute(client)` to run it. (For a pre-bound `.execute()` with no args, use [`createPermissions(client)`](#fluent-builder-api).)

### Grants and revokes (single or batched subjects)

```typescript
import { permissions } from "./generated/permissions";

// Single subject
await permissions.document.grant
  .editor("user:alice", "document:doc1")
  .execute(spicedbClient);

// Multiple subjects in one call — produces one TOUCH update per subject
await permissions.document.grant
  .editor(["user:alice", "user:bob"], "document:doc1")
  .execute(spicedbClient);

await permissions.document.revoke
  .viewer("user:charlie", "document:doc1")
  .execute(spicedbClient);

// ❌ Compile-time errors for invalid operations
await permissions.document.grant.invalidRelation("user:alice", "document:doc1"); // Error!
await permissions.document.check.edit("invalid:type", "document:doc1"); // Error!
```

### Permission and relation checks

```typescript
// Permission check
await permissions.document.check
  .view("user:bob", "document:doc1")
  .execute(spicedbClient);

// Auto-generated relation check (defaults to `is<Relation>`, overridden by `@check:`)
await permissions.document.check
  .isOwnedBy("user:alice", "document:doc1")
  .execute(spicedbClient);

// With strong consistency from a previous write token
await permissions.document.check
  .view("user:bob", "document:doc1")
  .withConsistency(zedToken)
  .execute(spicedbClient);
```

### Bulk checks

Check a single permission against many resources in one gRPC round-trip:

```typescript
const results = await permissions.document
  .checkBulk("view", "user:alice", [
    "document:doc1",
    "document:doc2",
    "document:doc3",
  ])
  .execute(spicedbClient);
// → [{ resourceId: "doc1", hasPermission: true }, ...]
```

### Find and lookup

```typescript
// Find: which documents does alice own?
const owned = await permissions.document.find
  .byOwner("user:alice")
  .execute(spicedbClient);

// Lookup resources accessible by a subject (LookupResources)
const viewable = await permissions.document.lookup
  .resources("user:alice", "view")
  .execute(spicedbClient);

// Lookup subjects with access to a resource (LookupSubjects)
const editors = await permissions.document.lookup
  .subjects("document:doc1", "edit", "user")
  .execute(spicedbClient);
```

### Filtered bulk delete

```typescript
// Revoke everything alice has on document:doc1
await permissions.document
  .deleteAll({ relation: "editor", subjectType: "user", subjectId: "alice" })
  .execute(spicedbClient);

// Wipe all relationships for a deleted resource
await permissions.document.deleteAll({ resourceId: "doc1" }).execute(spicedbClient);
```

### Transactions (batched writes)

`permissions.batch(...)` combines any number of grant/revoke operations into a single
`WriteRelationships` call and returns `{ token, succeeded, operationCount }`:

```typescript
const result = await permissions
  .batch(
    permissions.document.grant.editor("user:alice", "document:doc1"),
    permissions.document.grant.viewer(["user:bob", "user:charlie"], "document:doc1"),
    permissions.folder.revoke.editor("user:dave", "folder:f1"),
  )
  .execute(spicedbClient);
```

### Dynamic dispatch (runtime-typed)

For admin tools, UI builders, or anywhere the operation shape isn't known until runtime,
the generator emits discriminated unions and dispatcher functions:

```typescript
import {
  dynamicGrant,
  dynamicCheck,
  type GrantParams,
  type CheckParams,
} from "./generated/permissions";

const params: GrantParams = {
  objectType: "document", // narrows allowed `relation` and `subject` types
  relation: "editor",
  subject: "user:alice",
  resource: "document:doc1",
};

await dynamicGrant(params).execute(spicedbClient);
```

TypeScript enforces, per `objectType`, that `relation`, `subject`, and `resource` match the
schema — you can't accidentally grant a `folder` relation with a `document` resource.

## Fluent Builder API

For cases where you need dynamic operations or are migrating from string-based APIs, use the fluent builder. Every method comes in two flavors:

- **`createPermissions(client)`** returns a `Permissions` instance with the client already bound — call `.execute()` with no args.
- **`Operations.*`** static builders produce pure `Operation<T>` values you can serialize, store, or run later with `op.execute(client)` / `perms.execute(op)`.

### Grants, revokes, and batch transactions

```typescript
import {
  createPermissions,
  Operations,
} from "@schoolai/spicedb-zed-schema-parser";

const perms = createPermissions(spicedbClient);

// Single grant
await perms
  .grant("editor")
  .subject("user:alice")
  .resource("document:doc1")
  .execute();

// Multi-subject grant in a single gRPC call
await perms
  .grant("viewer")
  .subject(["user:alice", "user:bob", "user:charlie"])
  .resource("document:doc1")
  .execute();

// Batch — every .add() is written in one WriteRelationships call
await perms
  .batch()
  .add(perms.grant("viewer").subject("user:charlie").resource("folder:f1"))
  .add(perms.revoke("editor").subject("user:alice").resource("document:doc1"))
  .execute();
```

### Checks (single and bulk)

```typescript
const canView = await perms
  .check("view")
  .subject("user:bob")
  .resource("document:doc1")
  .withConsistency(zedToken) // optional strong consistency
  .execute();

// Bulk check — one CheckBulkPermissions gRPC call for many resources
const bulk = await Operations.bulkCheck("view", "user:alice", [
  "document:doc1",
  "document:doc2",
]).execute(spicedbClient);
// → [{ resourceId: "doc1", hasPermission: true }, ...]
```

### Lookup and multi-permission lookup

```typescript
// Which documents can alice view?
const accessible = await perms
  .lookup()
  .resourcesAccessibleBy("user:alice")
  .withPermission("view")
  .ofType("document")
  .execute();

// Who can edit document:doc1?
const editors = await perms
  .lookup()
  .subjectsWithAccessTo("document:doc1")
  .withPermission("edit")
  .ofType("user")
  .execute();

// `withPermissions` fans out one LookupSubjects call per permission in parallel,
// returning a Map<subjectId, highestPermission> with first-wins semantics
const matrix = await perms
  .lookup()
  .subjectsWithAccessTo("document:doc1")
  .ofType("user")
  .withPermissions(["edit", "view"]);
// → Map { "alice" => "edit", "bob" => "view" }
```

### Find (ReadRelationships)

`find()` exposes `ReadRelationships` directly. Wildcards on the subject restrict to a type without an id:

```typescript
const aliceEditorRows = await perms
  .find()
  .relation("editor")
  .subject("user:alice")
  .execute();

// All `collaborator` relationships held by any user
const allUserCollabs = await Operations.find()
  .relation("collaborator")
  .subject("user:*")
  .execute(spicedbClient);
```

### Filtered delete

```typescript
const deleteOp = Operations.delete().where({
  resourceType: "document",
  resourceId: "doc1",
});
await perms.execute(deleteOp);
```

### Serialization and debugging

Every operation implements `toJSON()`, so you can log, persist to an audit table, or replay later:

```typescript
const op = Operations.grant("editor")
  .subject(["user:alice", "user:bob"])
  .resource("document:doc1");

JSON.stringify(op);
// {"operation":"grant","relation":"editor","subjects":["user:alice","user:bob"],"resources":["document:doc1"]}
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

#### `generateSDK(schema: AugmentedSchemaAST, parserImport?: string): string`

Generates TypeScript code for a type-safe permissions SDK. `parserImport` defaults to `@schoolai/spicedb-zed-schema-parser/builder` and lets monorepo consumers point at a local builder package or a custom re-export.

```typescript
const generatedCode = generateSDK(augmentedAst);

// or, in a monorepo:
const generatedCode = generateSDK(augmentedAst, "@myorg/spicedb-builder");
```

### Builder Classes

#### `createPermissions(client: SpiceDBClient): Permissions`

Creates a permissions instance with bound SpiceDB client.

#### `Operations` (Static Builder)

Provides static methods for creating pure operations. Each returns an `Operation<T>` that you can serialize, compose, or execute with `op.execute(client)`.

- `Operations.grant(relation: string)` → `WriteOperation`
- `Operations.revoke(relation: string)` → `WriteOperation`
- `Operations.check(permission: string)` → `CheckOperation`
- `Operations.bulkCheck(permission: string, subject: string, resources: string[])` → `BulkCheckOperation`
- `Operations.find()` → `QueryOperation` (`ReadRelationships`)
- `Operations.lookup()` → `LookupOperation` (`LookupResources` / `LookupSubjects`)
- `Operations.delete()` → `DeleteOperation`
- `Operations.batch()` → `Transaction`

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
                   │ AST          │    │ Augmented AST   │    │ Generated    │
                   │              │    │ + Type Info     │    │ permissions  │
                   └──────────────┘    └─────────────────┘    │ + dynamic*   │
                                                              └──────┬───────┘
                                                                     │
                       Generated SDK (type-safe facade) ──────────┐  │
                                                                  ▼  ▼
                       Fluent Builder ─────────────────────▶ Operation<T> ──▶ SpiceDB (gRPC)
                       (string-based, dynamic)               grant/revoke/
                                                             check/bulkCheck/
                                                             find/lookup/
                                                             delete/batch
```

Both the generated SDK and the raw fluent builder produce the same `Operation<T>` shape that ultimately drives the `@authzed/authzed-node` gRPC client. The generator just narrows the string parameters into literal types derived from your schema.

## Development

### Building

```bash
pnpm run build
```

### Testing

```bash
pnpm test
```

### Linting

```bash
pnpm run lint
pnpm run lint:fix
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes and add tests
4. Run the test suite: `pnpm test`
5. Commit your changes: `git commit -m 'Add amazing feature'`
6. Push to the branch: `git push origin feature/amazing-feature`
7. Open a Pull Request

## License

Open source under the MIT license

## Related Projects

- [SpiceDB](https://github.com/authzed/spicedb) - The authorization system this library supports
- [@authzed/authzed-node](https://github.com/authzed/authzed-node) - Official Node.js client for SpiceDB
- [Chevrotain](https://github.com/Chevrotain/chevrotain) - Parser building toolkit used for `.zed` parsing
