interface DependencyNode {
  type: string
  name: string
  fullName: string
}

export class DependencyGraph {
  private adjacencyList: Map<string, Set<string>> = new Map()
  private nodes: Map<string, DependencyNode> = new Map()

  addNode(node: DependencyNode): void {
    this.nodes.set(node.fullName, node)
    if (!this.adjacencyList.has(node.fullName)) {
      this.adjacencyList.set(node.fullName, new Set())
    }
  }

  addEdge(from: string, to: string): void {
    if (!this.adjacencyList.has(from)) {
      this.adjacencyList.set(from, new Set())
    }
    this.adjacencyList.get(from)!.add(to)
  }

  // Find cycles via depth-first search
  findCycles(): string[][] {
    const cycles: string[][] = []
    const visited = new Set<string>()
    const recursionStack = new Set<string>()
    const path: string[] = []

    const dfs = (node: string): void => {
      visited.add(node)
      recursionStack.add(node)
      path.push(node)

      const neighbors = this.adjacencyList.get(node) || new Set()
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          dfs(neighbor)
        } else if (recursionStack.has(neighbor)) {
          // Found a cycle
          const cycleStart = path.indexOf(neighbor)
          cycles.push(path.slice(cycleStart).concat(neighbor))
        }
      }

      path.pop()
      recursionStack.delete(node)
    }

    for (const node of this.adjacencyList.keys()) {
      if (!visited.has(node)) {
        dfs(node)
      }
    }

    return cycles
  }
}
