/**
 * Database Query Helpers for D1
 * @description Common query functions for the Cloudflare multi-agent system
 * @author Agent 1.1
 * @date 2025-11-20
 */

// Type definitions for database entities
export interface Organization {
  org_id: string;
  name: string;
  billing_email: string;
  created_at: string;
}

export interface Instance {
  instance_id: string;
  org_id: string;
  name: string;
  config: InstanceConfig;
  created_at: string;
}

export interface InstanceConfig {
  instance_id: string;
  org_id: string;
  api_keys: Record<string, string>;
  rate_limits: Record<string, RateLimit>;
  worker_urls: Record<string, string>;
  r2_bucket: string;
  authorized_users: string[];
}

export interface RateLimit {
  rpm: number; // Requests per minute
  tpm: number; // Tokens per minute
}

export interface User {
  user_id: string;
  email: string;
  role: 'user' | 'admin' | 'superadmin';
  org_id: string;
  created_at: string;
}

export interface UserInstanceAccess {
  user_id: string;
  instance_id: string;
  granted_at: string;
}

export interface Project {
  project_id: string;
  instance_id: string;
  name: string;
  settings: Record<string, any>;
  created_at: string;
}

export interface ApiKey {
  key_id: string;
  user_id: string | null;
  project_id: string | null;
  key_hash: string;
  created_at: string;
  expires_at: string | null;
}

export interface UsageLog {
  log_id: string;
  instance_id: string;
  timestamp: string;
  provider: string;
  tokens_used: number;
  cost: number;
  request_id: string | null;
}

/**
 * Database query helper class
 * @description Provides type-safe query methods for D1 database operations
 */
export class DatabaseQueries {
  constructor(private db: D1Database) {}

  // ============================================================================
  // INSTANCE QUERIES
  // ============================================================================

  /**
   * Get instance by ID
   * @param instanceId - The instance ID to lookup
   * @returns Instance object or null if not found
   */
  async getInstanceById(instanceId: string): Promise<Instance | null> {
    const result = await this.db
      .prepare('SELECT * FROM instances WHERE instance_id = ?')
      .bind(instanceId)
      .first<Omit<Instance, 'config'> & { config: string }>();

    if (!result) return null;

    return {
      ...result,
      config: JSON.parse(result.config),
    };
  }

  /**
   * Get all instances for an organization
   * @param orgId - The organization ID
   * @returns Array of instances
   */
  async getInstancesByOrgId(orgId: string): Promise<Instance[]> {
    const results = await this.db
      .prepare('SELECT * FROM instances WHERE org_id = ? ORDER BY created_at DESC')
      .bind(orgId)
      .all<Omit<Instance, 'config'> & { config: string }>();

    return (results.results || []).map(row => ({
      ...row,
      config: JSON.parse(row.config),
    }));
  }

  // ============================================================================
  // USER QUERIES
  // ============================================================================

  /**
   * Get user by ID
   * @param userId - The user ID to lookup
   * @returns User object or null if not found
   */
  async getUserById(userId: string): Promise<User | null> {
    return await this.db
      .prepare('SELECT * FROM users WHERE user_id = ?')
      .bind(userId)
      .first<User>();
  }

  /**
   * Get user by email
   * @param email - The email address to lookup
   * @returns User object or null if not found
   */
  async getUserByEmail(email: string): Promise<User | null> {
    return await this.db
      .prepare('SELECT * FROM users WHERE email = ?')
      .bind(email)
      .first<User>();
  }

  /**
   * Get all users in an organization
   * @param orgId - The organization ID
   * @returns Array of users
   */
  async getUsersByOrgId(orgId: string): Promise<User[]> {
    const results = await this.db
      .prepare('SELECT * FROM users WHERE org_id = ? ORDER BY created_at DESC')
      .bind(orgId)
      .all<User>();

    return results.results || [];
  }

  // ============================================================================
  // USER INSTANCE ACCESS QUERIES
  // ============================================================================

  /**
   * Get all instances accessible by a user
   * @param userId - The user ID
   * @returns Array of instance IDs
   */
  async getInstancesByUserId(userId: string): Promise<string[]> {
    const results = await this.db
      .prepare('SELECT instance_id FROM user_instance_access WHERE user_id = ?')
      .bind(userId)
      .all<{ instance_id: string }>();

    return (results.results || []).map(row => row.instance_id);
  }

  /**
   * Check if user has access to instance
   * @param userId - The user ID
   * @param instanceId - The instance ID
   * @returns True if user has access, false otherwise
   */
  async hasInstanceAccess(userId: string, instanceId: string): Promise<boolean> {
    const result = await this.db
      .prepare('SELECT 1 FROM user_instance_access WHERE user_id = ? AND instance_id = ?')
      .bind(userId, instanceId)
      .first();

    return result !== null;
  }

  /**
   * Grant user access to instance
   * @param userId - The user ID
   * @param instanceId - The instance ID
   */
  async grantInstanceAccess(userId: string, instanceId: string): Promise<void> {
    await this.db
      .prepare('INSERT INTO user_instance_access (user_id, instance_id) VALUES (?, ?)')
      .bind(userId, instanceId)
      .run();
  }

  /**
   * Revoke user access to instance
   * @param userId - The user ID
   * @param instanceId - The instance ID
   */
  async revokeInstanceAccess(userId: string, instanceId: string): Promise<void> {
    await this.db
      .prepare('DELETE FROM user_instance_access WHERE user_id = ? AND instance_id = ?')
      .bind(userId, instanceId)
      .run();
  }

  // ============================================================================
  // PROJECT QUERIES
  // ============================================================================

  /**
   * Get project by ID
   * @param projectId - The project ID to lookup
   * @returns Project object or null if not found
   */
  async getProjectById(projectId: string): Promise<Project | null> {
    const result = await this.db
      .prepare('SELECT * FROM projects WHERE project_id = ?')
      .bind(projectId)
      .first<Omit<Project, 'settings'> & { settings: string }>();

    if (!result) return null;

    return {
      ...result,
      settings: JSON.parse(result.settings),
    };
  }

  /**
   * Get all projects for an instance
   * @param instanceId - The instance ID
   * @returns Array of projects
   */
  async getProjectsByInstanceId(instanceId: string): Promise<Project[]> {
    const results = await this.db
      .prepare('SELECT * FROM projects WHERE instance_id = ? ORDER BY created_at DESC')
      .bind(instanceId)
      .all<Omit<Project, 'settings'> & { settings: string }>();

    return (results.results || []).map(row => ({
      ...row,
      settings: JSON.parse(row.settings),
    }));
  }

  // ============================================================================
  // API KEY QUERIES
  // ============================================================================

  /**
   * Authenticate user by API key hash
   * @param keyHash - SHA-256 hash of the API key
   * @returns ApiKey object with associated user/project or null if not found
   */
  async authenticateByKeyHash(keyHash: string): Promise<ApiKey | null> {
    const result = await this.db
      .prepare(
        'SELECT * FROM api_keys WHERE key_hash = ? AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)'
      )
      .bind(keyHash)
      .first<ApiKey>();

    return result;
  }

  /**
   * Get all API keys for a user
   * @param userId - The user ID
   * @returns Array of API keys
   */
  async getApiKeysByUserId(userId: string): Promise<ApiKey[]> {
    const results = await this.db
      .prepare('SELECT * FROM api_keys WHERE user_id = ? ORDER BY created_at DESC')
      .bind(userId)
      .all<ApiKey>();

    return results.results || [];
  }

  /**
   * Get all API keys for a project
   * @param projectId - The project ID
   * @returns Array of API keys
   */
  async getApiKeysByProjectId(projectId: string): Promise<ApiKey[]> {
    const results = await this.db
      .prepare('SELECT * FROM api_keys WHERE project_id = ? ORDER BY created_at DESC')
      .bind(projectId)
      .all<ApiKey>();

    return results.results || [];
  }

  // ============================================================================
  // USAGE LOG QUERIES
  // ============================================================================

  /**
   * Log API usage
   * @param log - Usage log entry
   */
  async createUsageLog(log: Omit<UsageLog, 'log_id' | 'timestamp'>): Promise<void> {
    const logId = `log_${crypto.randomUUID()}`;

    await this.db
      .prepare(
        'INSERT INTO usage_logs (log_id, instance_id, provider, tokens_used, cost, request_id) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .bind(logId, log.instance_id, log.provider, log.tokens_used, log.cost, log.request_id)
      .run();
  }

  /**
   * Get usage logs for an instance
   * @param instanceId - The instance ID
   * @param limit - Maximum number of logs to return (default: 100)
   * @returns Array of usage logs
   */
  async getUsageLogsByInstanceId(instanceId: string, limit: number = 100): Promise<UsageLog[]> {
    const results = await this.db
      .prepare(
        'SELECT * FROM usage_logs WHERE instance_id = ? ORDER BY timestamp DESC LIMIT ?'
      )
      .bind(instanceId, limit)
      .all<UsageLog>();

    return results.results || [];
  }

  /**
   * Get usage summary for an instance within a time range
   * @param instanceId - The instance ID
   * @param startDate - Start date (ISO string)
   * @param endDate - End date (ISO string)
   * @returns Usage summary with totals by provider
   */
  async getUsageSummary(
    instanceId: string,
    startDate: string,
    endDate: string
  ): Promise<{ provider: string; total_tokens: number; total_cost: number }[]> {
    const results = await this.db
      .prepare(
        `SELECT
          provider,
          SUM(tokens_used) as total_tokens,
          SUM(cost) as total_cost
        FROM usage_logs
        WHERE instance_id = ?
          AND timestamp BETWEEN ? AND ?
        GROUP BY provider
        ORDER BY total_cost DESC`
      )
      .bind(instanceId, startDate, endDate)
      .all<{ provider: string; total_tokens: number; total_cost: number }>();

    return results.results || [];
  }

  // ============================================================================
  // ORGANIZATION QUERIES
  // ============================================================================

  /**
   * Get organization by ID
   * @param orgId - The organization ID to lookup
   * @returns Organization object or null if not found
   */
  async getOrganizationById(orgId: string): Promise<Organization | null> {
    return await this.db
      .prepare('SELECT * FROM organizations WHERE org_id = ?')
      .bind(orgId)
      .first<Organization>();
  }

  /**
   * Get all organizations
   * @returns Array of all organizations
   */
  async getAllOrganizations(): Promise<Organization[]> {
    const results = await this.db
      .prepare('SELECT * FROM organizations ORDER BY created_at DESC')
      .all<Organization>();

    return results.results || [];
  }
}

/**
 * Helper function to create SHA-256 hash of API key
 * @param apiKey - The plaintext API key
 * @returns Hex-encoded SHA-256 hash
 */
export async function hashApiKey(apiKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(apiKey);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Helper function to generate a new UUID for IDs
 * @returns UUID string with appropriate prefix
 */
export function generateId(prefix: 'org' | 'inst' | 'user' | 'proj' | 'key' | 'log'): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
