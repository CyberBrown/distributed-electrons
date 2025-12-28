/**
 * Gemini Runner - On-Prem Gemini CLI Execution Service
 *
 * Runs on Spark (home server) behind Cloudflare Tunnel.
 * Provides persistent auth credentials for Gemini CLI.
 *
 * Endpoints:
 * - POST /execute - Execute a Gemini CLI task
 * - GET /health - Health check
 * - GET /auth/status - Check auth credential status
 */

import express, { Request, Response, NextFunction } from 'express';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';

const app = express();
const PORT = process.env.PORT || 8790;
const RUNNER_SECRET = process.env.RUNNER_SECRET;
const REPOS_DIR = '/repos';
const NTFY_TOPIC = process.env.NTFY_TOPIC || 'nexus-oauth-expired';
const NTFY_URL = `https://ntfy.sh/${NTFY_TOPIC}`;

// Auth failure tracking
interface AuthFailureState {
  lastFailureTime: string | null;
  failureCount: number;
  lastTaskAttempted: string | null;
  lastAlertSent: string | null;
}

const authFailureState: AuthFailureState = {
  lastFailureTime: null,
  failureCount: 0,
  lastTaskAttempted: null,
  lastAlertSent: null,
};

// Auth error patterns to detect
const AUTH_ERROR_PATTERNS = [
  /oauth.*expired/i,
  /authentication.*failed/i,
  /token.*invalid/i,
  /token.*expired/i,
  /unauthorized/i,
  /401/,
  /unauthenticated/i,
  /invalid.*credentials/i,
  /refresh.*token.*failed/i,
  /login.*required/i,
  /session.*expired/i,
  /api.*key.*invalid/i,
];

/**
 * Detect if output contains auth error
 */
function detectAuthError(output: string): boolean {
  return AUTH_ERROR_PATTERNS.some(pattern => pattern.test(output));
}

/**
 * Send alert to ntfy.sh
 * DISABLED: Notifications temporarily disabled to reduce noise
 */
async function sendNtfyAlert(
  title: string,
  message: string,
  priority: 'min' | 'low' | 'default' | 'high' | 'urgent' = 'high',
  tags: string[] = ['warning']
): Promise<void> {
  // DISABLED: Uncomment to re-enable notifications
  console.log(`[NTFY DISABLED] Would send: ${title}`);
  return;

  try {
    const response = await fetch(NTFY_URL, {
      method: 'POST',
      headers: {
        'Title': title,
        'Priority': priority,
        'Tags': tags.join(','),
      },
      body: message,
    });

    if (!response.ok) {
      console.error(`Failed to send ntfy alert: ${response.status} ${response.statusText}`);
    } else {
      console.log(`Ntfy alert sent: ${title}`);
      authFailureState.lastAlertSent = new Date().toISOString();
    }
  } catch (error) {
    console.error('Error sending ntfy alert:', error);
  }
}

/**
 * Record auth failure and send alert
 */
async function recordAuthFailure(task: string, output: string): Promise<void> {
  const now = new Date();
  authFailureState.lastFailureTime = now.toISOString();
  authFailureState.failureCount++;
  authFailureState.lastTaskAttempted = task.slice(0, 100); // Truncate for storage

  // Rate limit alerts - don't spam if multiple failures in quick succession
  const lastAlert = authFailureState.lastAlertSent ? new Date(authFailureState.lastAlertSent) : null;
  const minutesSinceLastAlert = lastAlert ? (now.getTime() - lastAlert.getTime()) / (1000 * 60) : Infinity;

  if (minutesSinceLastAlert > 5) {
    // Extract relevant error from output
    const errorSnippet = output.slice(0, 200).replace(/\n/g, ' ');

    await sendNtfyAlert(
      '🔴 Gemini CLI Auth Failed',
      `Service: gemini-runner\n` +
      `Time: ${now.toISOString()}\n` +
      `Task: ${task.slice(0, 80)}...\n` +
      `Error: ${errorSnippet}\n` +
      `Failures: ${authFailureState.failureCount}\n\n` +
      `Action: Run 'gemini' on Spark to re-authenticate or check API key`,
      'urgent',
      ['rotating_light', 'key']
    );
  } else {
    console.log(`Skipping ntfy alert - last alert was ${minutesSinceLastAlert.toFixed(1)} minutes ago`);
  }
}

// Middleware
app.use(express.json({ limit: '10mb' }));

// Request logging
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Authentication middleware
function authenticate(req: Request, res: Response, next: NextFunction) {
  const secret = req.headers['x-runner-secret'] as string;

  if (!RUNNER_SECRET) {
    console.error('RUNNER_SECRET not configured!');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  if (!secret || secret !== RUNNER_SECRET) {
    return res.status(403).json({ error: 'Invalid or missing runner secret' });
  }

  next();
}

// Types
interface ExecuteRequest {
  prompt: string;
  repo_url?: string;
  working_dir?: string;
  timeout_ms?: number;
  model?: string;
  sandbox?: boolean;
}

interface ExecuteResponse {
  success: boolean;
  output?: string;
  error?: string;
  exit_code?: number;
  duration_ms: number;
}

/**
 * Get Gemini config directory path
 */
function getGeminiConfigPath(): string {
  return path.join(process.env.HOME || '/root', '.gemini');
}

/**
 * Check if Gemini CLI is authenticated
 * Gemini can use: Google login, API key, or Vertex AI
 */
async function checkAuthStatus(): Promise<{ configured: boolean; method?: string; details?: string }> {
  // Check for API key in environment
  if (process.env.GEMINI_API_KEY) {
    return {
      configured: true,
      method: 'api_key',
      details: 'Using GEMINI_API_KEY environment variable',
    };
  }

  // Check for Google Cloud / Vertex AI
  if (process.env.GOOGLE_CLOUD_PROJECT && process.env.GOOGLE_GENAI_USE_VERTEXAI) {
    return {
      configured: true,
      method: 'vertex_ai',
      details: `Vertex AI with project: ${process.env.GOOGLE_CLOUD_PROJECT}`,
    };
  }

  // Check for Gemini OAuth credentials (from `gemini` CLI login)
  const configPath = getGeminiConfigPath();
  const oauthCredsPath = path.join(configPath, 'oauth_creds.json');

  if (await fileExists(oauthCredsPath)) {
    return {
      configured: true,
      method: 'google_oauth',
      details: 'Using Google OAuth credentials from gemini CLI',
    };
  }

  // Check for application default credentials
  const adcPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (adcPath && await fileExists(adcPath)) {
    return {
      configured: true,
      method: 'service_account',
      details: 'Using service account credentials',
    };
  }

  return { configured: false };
}

/**
 * Async helper to check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fsPromises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Clone or update a git repository
 */
async function prepareRepo(repoUrl: string): Promise<string> {
  const repoHash = Buffer.from(repoUrl).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
  const repoDir = path.join(REPOS_DIR, repoHash);

  if (!await fileExists(REPOS_DIR)) {
    await fsPromises.mkdir(REPOS_DIR, { recursive: true });
  }

  if (await fileExists(repoDir)) {
    await runCommand('git', ['fetch', '--all'], repoDir);
    await runCommand('git', ['reset', '--hard', 'origin/HEAD'], repoDir);
    await runCommand('git', ['clean', '-fdx'], repoDir);
  } else {
    await runCommand('git', ['clone', repoUrl, repoDir], REPOS_DIR);
  }

  return repoDir;
}

/**
 * Run a command and return stdout
 */
function runCommand(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`${cmd} failed with code ${code}: ${stderr}`));
      }
    });

    proc.on('error', reject);
  });
}

/**
 * Execute Gemini CLI
 */
async function executeGemini(
  prompt: string,
  workingDir: string,
  timeoutMs: number,
  model?: string,
  sandbox?: boolean
): Promise<{ output: string; exitCode: number }> {
  return new Promise((resolve) => {
    // Build command arguments - spawn directly without shell to avoid injection
    const args: string[] = [];

    // Add model if specified
    if (model) {
      args.push('-m', model);
    }

    // Add sandbox mode if requested (restricts file system access)
    if (sandbox) {
      args.push('--sandbox');
    }

    // Auto-approve all actions for non-interactive execution
    args.push('--yolo');

    // Output format for easier parsing
    args.push('--output-format', 'text');

    // Prompt as positional argument (no shell escaping needed - spawn handles it safely)
    args.push(prompt);

    console.log(`Executing: gemini ${args.slice(0, -1).join(' ')} "<prompt>" in ${workingDir}`);

    // Spawn gemini directly without shell - prevents shell injection
    const proc: ChildProcess = spawn('gemini', args, {
      cwd: workingDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        HOME: process.env.HOME || '/root',
        CI: 'true',
        TERM: 'dumb',
      },
    });

    let output = '';
    let errorOutput = '';

    proc.stdout?.on('data', (data) => {
      const chunk = data.toString();
      output += chunk;
      console.log(`[stdout] ${chunk.slice(0, 100)}`);
    });

    proc.stderr?.on('data', (data) => {
      const chunk = data.toString();
      errorOutput += chunk;
      console.log(`[stderr] ${chunk.slice(0, 100)}`);
    });

    const timeout = setTimeout(() => {
      console.log(`Timeout reached (${timeoutMs}ms), killing process`);
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGKILL');
        }
      }, 5000);
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      console.log(`Process exited with code ${code}, output length: ${output.length}`);
      resolve({
        output: output || errorOutput,
        exitCode: code ?? 1,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      console.error(`Process error: ${err.message}`);
      resolve({
        output: `Process error: ${err.message}`,
        exitCode: 1,
      });
    });
  });
}

// Routes

/**
 * Health check endpoint
 */
app.get('/health', async (_req: Request, res: Response) => {
  const authStatus = await checkAuthStatus();

  res.json({
    status: 'healthy',
    service: 'gemini-runner',
    timestamp: new Date().toISOString(),
    auth: authStatus,
    auth_failures: {
      last_failure: authFailureState.lastFailureTime,
      failure_count: authFailureState.failureCount,
      last_task: authFailureState.lastTaskAttempted,
      last_alert_sent: authFailureState.lastAlertSent,
    },
    uptime_seconds: process.uptime(),
  });
});

/**
 * Auth status endpoint (authenticated)
 */
app.get('/auth/status', authenticate, async (_req: Request, res: Response) => {
  const status = await checkAuthStatus();
  res.json(status);
});

/**
 * Execute Gemini CLI task (authenticated)
 */
app.post('/execute', authenticate, async (req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    const body = req.body as ExecuteRequest;

    if (!body.prompt) {
      return res.status(400).json({ error: 'prompt is required' });
    }

    // Check auth status first
    const authStatus = await checkAuthStatus();
    if (!authStatus.configured) {
      return res.status(401).json({
        success: false,
        error: 'Gemini CLI not authenticated',
        auth_status: authStatus,
        message: 'Set GEMINI_API_KEY or run `gemini` to authenticate',
      });
    }

    // Determine working directory
    let workingDir = body.working_dir || '/tmp';

    if (body.repo_url) {
      try {
        workingDir = await prepareRepo(body.repo_url);
      } catch (error) {
        return res.status(500).json({
          success: false,
          error: `Failed to prepare repository: ${error instanceof Error ? error.message : 'Unknown error'}`,
          duration_ms: Date.now() - startTime,
        });
      }
    }

    // Execute Gemini
    const timeoutMs = body.timeout_ms || 300000; // 5 minutes default
    const result = await executeGemini(
      body.prompt,
      workingDir,
      timeoutMs,
      body.model,
      body.sandbox
    );

    const response: ExecuteResponse = {
      success: result.exitCode === 0,
      output: result.output,
      exit_code: result.exitCode,
      duration_ms: Date.now() - startTime,
    };

    // If execution failed, extract error message from output
    if (result.exitCode !== 0) {
      // Look for API error patterns in the output
      const apiErrorMatch = result.output.match(/\[API Error: ([^\]]+)\]/);
      const quotaErrorMatch = result.output.match(/exhausted your capacity.*reset after (\d+h\d+m)/i);

      if (quotaErrorMatch) {
        response.error = `Gemini API quota exhausted - resets in ${quotaErrorMatch[1]}`;
      } else if (apiErrorMatch) {
        response.error = `Gemini API error: ${apiErrorMatch[1]}`;
      } else {
        // Use first line of output as error, or generic message
        const firstLine = result.output.split('\n').find(l => l.trim()) || 'Execution failed';
        response.error = firstLine.slice(0, 200);
      }
    }

    // Check if it was an auth error using pattern detection
    if (detectAuthError(result.output)) {
      response.success = false;
      response.error = 'Authentication error - may need to re-authenticate';

      // Record failure and send ntfy alert (async, don't block response)
      recordAuthFailure(body.prompt, result.output).catch(err => {
        console.error('Failed to record auth failure:', err);
      });
    }

    res.json(response);

  } catch (error) {
    console.error('Execute error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration_ms: Date.now() - startTime,
    });
  }
});

/**
 * List cached repositories
 */
app.get('/repos', authenticate, async (_req: Request, res: Response) => {
  try {
    if (!await fileExists(REPOS_DIR)) {
      return res.json({ repos: [] });
    }

    const entries = await fsPromises.readdir(REPOS_DIR, { withFileTypes: true });
    const repos = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    res.json({ repos });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list repos' });
  }
});

/**
 * Clear cached repositories
 */
app.delete('/repos', authenticate, async (_req: Request, res: Response) => {
  try {
    if (await fileExists(REPOS_DIR)) {
      await fsPromises.rm(REPOS_DIR, { recursive: true, force: true });
      await fsPromises.mkdir(REPOS_DIR, { recursive: true });
    }
    res.json({ cleared: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear repos' });
  }
});

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, async () => {
  console.log(`Gemini Runner listening on port ${PORT}`);
  console.log(`Auth status:`, await checkAuthStatus());

  if (!RUNNER_SECRET) {
    console.warn('WARNING: RUNNER_SECRET not set - authentication disabled!');
  }
});
