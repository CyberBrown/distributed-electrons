/**
 * Mock D1 Database for testing
 */

export class MockD1Database {
  private data: Map<string, any[]> = new Map();

  constructor() {
    // Initialize with empty tables
    this.data.set('instances', []);
    this.data.set('users', []);
    this.data.set('projects', []);
  }

  prepare(query: string): MockD1PreparedStatement {
    return new MockD1PreparedStatement(query, this.data);
  }

  dump(): Promise<ArrayBuffer> {
    throw new Error('dump not implemented in mock');
  }

  batch<T = unknown>(_statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    throw new Error('batch not implemented in mock');
  }

  exec(_query: string): Promise<D1ExecResult> {
    throw new Error('exec not implemented in mock');
  }

  // Helper methods for testing
  _setData(table: string, data: any[]) {
    this.data.set(table, data);
  }

  _getData(table: string): any[] {
    return this.data.get(table) || [];
  }

  _clear() {
    this.data.clear();
    this.data.set('instances', []);
    this.data.set('users', []);
    this.data.set('projects', []);
  }
}

class MockD1PreparedStatement {
  private bindings: any[] = [];

  constructor(
    private query: string,
    private data: Map<string, any[]>
  ) {}

  bind(...values: any[]): MockD1PreparedStatement {
    this.bindings = values;
    return this;
  }

  async first<T = unknown>(colName?: string): Promise<T | null> {
    const result = await this.all<T>();
    if (result.results.length === 0) {
      return null;
    }
    if (colName) {
      return (result.results[0] as any)[colName];
    }
    return result.results[0];
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    const query = this.query.toLowerCase().trim();

    if (query.startsWith('insert into instances')) {
      const instances = this.data.get('instances') || [];
      const [instance_id, org_id, name, api_keys, rate_limits, worker_urls, r2_bucket, created_at, updated_at] = this.bindings;
      instances.push({
        instance_id,
        org_id,
        name,
        api_keys,
        rate_limits,
        worker_urls,
        r2_bucket,
        created_at,
        updated_at,
      });
      this.data.set('instances', instances);
      return { success: true, meta: { changes: 1 } } as any;
    }

    if (query.startsWith('insert into users')) {
      const users = this.data.get('users') || [];
      const [user_id, org_id, email, name, role, created_at, updated_at] = this.bindings;
      users.push({
        user_id,
        org_id,
        email,
        name,
        role,
        created_at,
        updated_at,
      });
      this.data.set('users', users);
      return { success: true, meta: { changes: 1 } } as any;
    }

    if (query.startsWith('insert into projects')) {
      const projects = this.data.get('projects') || [];
      const [project_id, instance_id, name, description, config, created_at, updated_at] = this.bindings;
      projects.push({
        project_id,
        instance_id,
        name,
        description,
        config,
        created_at,
        updated_at,
      });
      this.data.set('projects', projects);
      return { success: true, meta: { changes: 1 } } as any;
    }

    if (query.startsWith('update instances')) {
      const instances = this.data.get('instances') || [];
      const instanceId = this.bindings[this.bindings.length - 1];
      const index = instances.findIndex(i => i.instance_id === instanceId);
      if (index !== -1) {
        // Simple update - in real implementation, parse SET clause
        return { success: true, meta: { changes: 1 } } as any;
      }
      return { success: true, meta: { changes: 0 } } as any;
    }

    if (query.startsWith('update users')) {
      const users = this.data.get('users') || [];
      const userId = this.bindings[this.bindings.length - 1];
      const index = users.findIndex(u => u.user_id === userId);
      if (index !== -1) {
        return { success: true, meta: { changes: 1 } } as any;
      }
      return { success: true, meta: { changes: 0 } } as any;
    }

    if (query.startsWith('update projects')) {
      const projects = this.data.get('projects') || [];
      const projectId = this.bindings[this.bindings.length - 1];
      const index = projects.findIndex(p => p.project_id === projectId);
      if (index !== -1) {
        return { success: true, meta: { changes: 1 } } as any;
      }
      return { success: true, meta: { changes: 0 } } as any;
    }

    if (query.startsWith('delete from instances')) {
      const instances = this.data.get('instances') || [];
      const instanceId = this.bindings[0];
      const filtered = instances.filter(i => i.instance_id !== instanceId);
      const changes = instances.length - filtered.length;
      this.data.set('instances', filtered);
      return { success: true, meta: { changes } } as any;
    }

    if (query.startsWith('delete from users')) {
      const users = this.data.get('users') || [];
      const userId = this.bindings[0];
      const filtered = users.filter(u => u.user_id !== userId);
      const changes = users.length - filtered.length;
      this.data.set('users', filtered);
      return { success: true, meta: { changes } } as any;
    }

    if (query.startsWith('delete from projects')) {
      const projects = this.data.get('projects') || [];
      const projectId = this.bindings[0];
      const filtered = projects.filter(p => p.project_id !== projectId);
      const changes = projects.length - filtered.length;
      this.data.set('projects', filtered);
      return { success: true, meta: { changes } } as any;
    }

    return { success: true, meta: { changes: 0 } } as any;
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    const query = this.query.toLowerCase().trim();

    if (query.includes('from instances')) {
      const instances = this.data.get('instances') || [];

      if (query.includes('where instance_id')) {
        const instanceId = this.bindings[0];
        const filtered = instances.filter(i => i.instance_id === instanceId);
        return { success: true, results: filtered as T[], meta: {} } as any;
      }

      if (query.includes('where org_id')) {
        const orgId = this.bindings[0];
        const filtered = instances.filter(i => i.org_id === orgId);
        return { success: true, results: filtered as T[], meta: {} } as any;
      }

      return { success: true, results: instances as T[], meta: {} } as any;
    }

    if (query.includes('from users')) {
      const users = this.data.get('users') || [];

      if (query.includes('where user_id')) {
        const userId = this.bindings[0];
        const filtered = users.filter(u => u.user_id === userId);
        return { success: true, results: filtered as T[], meta: {} } as any;
      }

      if (query.includes('where email =') && !query.includes('and user_id')) {
        const email = this.bindings[0];
        const filtered = users.filter(u => u.email === email);
        return { success: true, results: filtered as T[], meta: {} } as any;
      }

      if (query.includes('where email') && query.includes('and user_id')) {
        const [email, userId] = this.bindings;
        const filtered = users.filter(u => u.email === email && u.user_id !== userId);
        return { success: true, results: filtered as T[], meta: {} } as any;
      }

      if (query.includes('where org_id')) {
        const orgId = this.bindings[0];
        const filtered = users.filter(u => u.org_id === orgId);
        return { success: true, results: filtered as T[], meta: {} } as any;
      }

      return { success: true, results: users as T[], meta: {} } as any;
    }

    if (query.includes('from projects')) {
      const projects = this.data.get('projects') || [];

      if (query.includes('where project_id')) {
        const projectId = this.bindings[0];
        const filtered = projects.filter(p => p.project_id === projectId);
        return { success: true, results: filtered as T[], meta: {} } as any;
      }

      if (query.includes('where instance_id')) {
        const instanceId = this.bindings[0];
        const filtered = projects.filter(p => p.instance_id === instanceId);
        return { success: true, results: filtered as T[], meta: {} } as any;
      }

      return { success: true, results: projects as T[], meta: {} } as any;
    }

    return { success: true, results: [] as T[], meta: {} } as any;
  }

  async raw<T = unknown>(_options?: { columnNames?: boolean }): Promise<T[]> {
    const result = await this.all<T>();
    return result.results;
  }
}
