/**
 * Spark Gateway Client
 *
 * Queries the Spark Gateway to determine if local GPU resources
 * are available before routing to cloud providers.
 */

export interface SparkAvailability {
  available: boolean;
  service: string;
  reason: string;
  gpu_memory_free_mb: number;
  gpu_utilization_pct: number;
  recommendation: 'use_local' | 'use_cloud' | 'queue';
}

export interface SparkServiceStatus {
  name: string;
  type: string;
  container_running: boolean;
  healthy: boolean;
  port: number;
  vram_gb: number;
  description: string;
  response_time_ms?: number;
  error?: string;
}

export interface SparkGPUStatus {
  gpu_name: string;
  gpu_utilization_pct: number;
  memory_used_mb: number;
  memory_total_mb: number;
  memory_free_mb: number;
  temperature_c: number;
  processes: Array<{ pid: number; gpu_memory_mb: number; process_name: string }>;
}

/**
 * Check if a service type is available on Spark.
 * Returns quickly (3s timeout) so it doesn't block routing.
 */
export async function checkSparkAvailability(
  gatewayUrl: string,
  serviceType: string,
  mode: 'waterfall' | 'queue' = 'waterfall'
): Promise<SparkAvailability> {
  try {
    const response = await fetch(
      `${gatewayUrl}/available/${serviceType}?mode=${mode}`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(3000), // 3s timeout - don't block routing
      }
    );

    if (!response.ok) {
      return {
        available: false,
        service: serviceType,
        reason: `Spark Gateway returned ${response.status}`,
        gpu_memory_free_mb: 0,
        gpu_utilization_pct: 0,
        recommendation: 'use_cloud',
      };
    }

    return await response.json() as SparkAvailability;
  } catch (err) {
    // Gateway unreachable - Spark is probably down or tunnel is off
    return {
      available: false,
      service: serviceType,
      reason: `Spark Gateway unreachable: ${err instanceof Error ? err.message : 'timeout'}`,
      gpu_memory_free_mb: 0,
      gpu_utilization_pct: 0,
      recommendation: 'use_cloud',
    };
  }
}

/**
 * Get full service listing from Spark.
 */
export async function getSparkServices(
  gatewayUrl: string
): Promise<Record<string, SparkServiceStatus> | null> {
  try {
    const response = await fetch(`${gatewayUrl}/services`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    const data = await response.json() as { services: Record<string, SparkServiceStatus> };
    return data.services;
  } catch {
    return null;
  }
}

/**
 * Get GPU status from Spark.
 */
export async function getSparkGPU(
  gatewayUrl: string
): Promise<SparkGPUStatus | null> {
  try {
    const response = await fetch(`${gatewayUrl}/gpu`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    return await response.json() as SparkGPUStatus;
  } catch {
    return null;
  }
}
