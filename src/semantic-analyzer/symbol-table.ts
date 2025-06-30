import {
  ObjectTypeDefinition,
  CaveatDefinition,
  RelationDeclaration,
  PermissionDeclaration,
} from '../schema-parser/parser'

interface SymbolInfo {
  type: 'definition' | 'caveat'
  definition: ObjectTypeDefinition | CaveatDefinition
  relations: Map<string, RelationDeclaration>
  permissions: Map<string, PermissionDeclaration>
}

export class SymbolTable {
  private symbols: Map<string, SymbolInfo> = new Map()

  addDefinition(def: ObjectTypeDefinition | CaveatDefinition): void {
    const info: SymbolInfo = {
      type: def.type === 'definition' ? 'definition' : 'caveat',
      definition: def,
      relations: new Map(),
      permissions: new Map(),
    }

    if (def.type === 'definition') {
      for (const rel of def.relations) {
        info.relations.set(rel.name, rel)
      }
      for (const perm of def.permissions) {
        info.permissions.set(perm.name, perm)
      }
    }

    this.symbols.set(def.name, info)
  }

  getDefinition(name: string): SymbolInfo | undefined {
    return this.symbols.get(name)
  }

  hasDefinition(name: string): boolean {
    return this.symbols.has(name)
  }

  getAllDefinitions(): SymbolInfo[] {
    return Array.from(this.symbols.values())
  }

  getRelation(
    typeName: string,
    relationName: string,
  ): RelationDeclaration | undefined {
    const info = this.symbols.get(typeName)
    return info?.relations.get(relationName)
  }

  getPermission(
    typeName: string,
    permissionName: string,
  ): PermissionDeclaration | undefined {
    const info = this.symbols.get(typeName)
    return info?.permissions.get(permissionName)
  }

  hasRelationOrPermission(typeName: string, name: string): boolean {
    const info = this.symbols.get(typeName)
    if (!info) return false
    return info.relations.has(name) || info.permissions.has(name)
  }
}
