/**
 * Claude Runner - On-Prem Claude Code Execution Service
 *
 * Runs on Spark (home server) behind Cloudflare Tunnel.
 * Provides persistent OAuth credentials for Claude Code CLI.
 *
 * Endpoints:
 * - POST /execute - Execute a Claude Code task
 * - GET /health - Health check
 * - GET /oauth/status - Check OAuth credential status
 * - POST /oauth/refresh - Attempt token refresh
 */

import express, { Request, Response, NextFunction } from 'express';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const app = express();
const PORT = process.env.PORT || 8787;
const RUNNER_SECRET = process.env.RUNNER_SECRET;
const REPOS_DIR = '/repos';

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
  allowed_tools?: string[];
  max_turns?: number;
}

interface ExecuteResponse {
  success: boolean;
  output?: string;
  error?: string;
  exit_code?: number;
  duration_ms: number;
}

interface OAuthCredentials {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  claudeAiOauth?: {
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
    accountUuid?: string;
  };
}

/**
 * Get OAuth credentials path
 */
function getCredentialsPath(): string {
  return path.join(process.env.HOME || '/home/node', '.claude', '.credentials.json');
}

/**
 * Read OAuth credentials
 */
function readCredentials(): OAuthCredentials | null {
  try {
    const credPath = getCredentialsPath();
    if (!fs.existsSync(credPath)) {
      return null;
    }
    const content = fs.readFileSync(credPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Error reading credentials:', error);
    return null;
  }
}

/**
 * Check if OAuth is configured and valid
 */
function checkOAuthStatus(): { configured: boolean; expired: boolean; expires_at?: string; hours_remaining?: number } {
  const creds = readCredentials();

  if (!creds) {
    return { configured: false, expired: true };
  }

  // Handle both formats
  const expiresAt = creds.claudeAiOauth?.expiresAt || creds.expiresAt;

  if (!expiresAt) {
    return { configured: true, expired: true };
  }

  const expiresDate = new Date(expiresAt);
  const now = new Date();
  const hoursRemaining = (expiresDate.getTime() - now.getTime()) / (1000 * 60 * 60);

  return {
    configured: true,
    expired: hoursRemaining <= 0,
    expires_at: expiresAt,
    hours_remaining: Math.max(0, Math.round(hoursRemaining * 10) / 10),
  };
}

/**
 * Clone or update a git repository
 */
async function prepareRepo(repoUrl: string): Promise<string> {
  // Create hash of repo URL for directory name
  const repoHash = Buffer.from(repoUrl).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
  const repoDir = path.join(REPOS_DIR, repoHash);

  if (!fs.existsSync(REPOS_DIR)) {
    fs.mkdirSync(REPOS_DIR, { recursive: true });
  }

  if (fs.existsSync(repoDir)) {
    // Update existing repo
    await runCommand('git', ['fetch', '--all'], repoDir);
    await runCommand('git', ['reset', '--hard', 'origin/HEAD'], repoDir);
    await runCommand('git', ['clean', '-fdx'], repoDir);
  } else {
    // Clone new repo
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
 * Execute Claude Code CLI
 */
async function executeClaude(
  prompt: string,
  workingDir: string,
  timeoutMs: number,
  allowedTools?: string[],
  maxTurns?: number
): Promise<{ output: string; exitCode: number }> {
  return new Promise((resolve) => {
    // Build command parts
    // --dangerously-skip-permissions bypasses all permission checks (like Gemini's --yolo)
    const cmdParts = ['claude', '-p', '--dangerously-skip-permissions', '--output-format', 'text'];

    if (allowedTools && allowedTools.length > 0) {
      cmdParts.push('--allowedTools', allowedTools.join(','));
    }

    if (maxTurns) {
      cmdParts.push('--max-turns', maxTurns.toString());
    }

    // Escape prompt for shell (replace single quotes)
    const escapedPrompt = prompt.replace(/'/g, "'\\''");
    cmdParts.push(`'${escapedPrompt}'`);

    // Redirect stderr to stdout and close stdin
    const fullCommand = `${cmdParts.join(' ')} 2>&1 </dev/null`;
    console.log(`Executing: ${fullCommand} in ${workingDir}`);

    // Use shell execution for better compatibility
    const proc: ChildProcess = spawn('sh', ['-c', fullCommand], {
      cwd: workingDir,
      stdio: ['ignore', 'pipe', 'pipe'],  // ignore stdin
      env: {
        ...process.env,
        HOME: process.env.HOME || '/home/node',
        CI: 'true',
        TERM: 'dumb',  // Disable any terminal features
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

    // Timeout handler
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
app.get('/health', (_req: Request, res: Response) => {
  const oauthStatus = checkOAuthStatus();

  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    oauth: oauthStatus,
    uptime_seconds: process.uptime(),
  });
});

/**
 * OAuth status endpoint (authenticated)
 */
app.get('/oauth/status', authenticate, (_req: Request, res: Response) => {
  const status = checkOAuthStatus();
  res.json(status);
});

/**
 * OAuth refresh endpoint (authenticated)
 * This triggers a re-read of credentials - actual refresh happens via CLI
 */
app.post('/oauth/refresh', authenticate, (_req: Request, res: Response) => {
  // Re-read credentials to see if they've been updated externally
  const status = checkOAuthStatus();

  if (!status.configured) {
    return res.status(404).json({
      error: 'No OAuth credentials configured',
      message: 'Run `claude login` on this machine to configure OAuth',
    });
  }

  if (status.expired) {
    return res.status(401).json({
      error: 'OAuth credentials expired',
      message: 'Run `claude login` on this machine to re-authenticate',
    });
  }

  res.json({
    refreshed: true,
    ...status,
  });
});

/**
 * Execute Claude Code task (authenticated)
 */
app.post('/execute', authenticate, async (req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    const body = req.body as ExecuteRequest;

    if (!body.prompt) {
      return res.status(400).json({ error: 'prompt is required' });
    }

    // Check OAuth status first
    const oauthStatus = checkOAuthStatus();
    if (!oauthStatus.configured || oauthStatus.expired) {
      return res.status(401).json({
        success: false,
        error: 'OAuth credentials not configured or expired',
        oauth_status: oauthStatus,
        message: 'Run `claude login` on this machine',
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

    // Execute Claude
    const timeoutMs = body.timeout_ms || 300000; // 5 minutes default
    const result = await executeClaude(
      body.prompt,
      workingDir,
      timeoutMs,
      body.allowed_tools,
      body.max_turns
    );

    const response: ExecuteResponse = {
      success: result.exitCode === 0,
      output: result.output,
      exit_code: result.exitCode,
      duration_ms: Date.now() - startTime,
    };

    // Check if it was an auth error
    if (result.output.includes('authentication') || result.output.includes('oauth') || result.output.includes('401')) {
      response.success = false;
      response.error = 'Authentication error - may need to re-login';
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
app.get('/repos', authenticate, (_req: Request, res: Response) => {
  try {
    if (!fs.existsSync(REPOS_DIR)) {
      return res.json({ repos: [] });
    }

    const repos = fs.readdirSync(REPOS_DIR).filter((name) => {
      const stat = fs.statSync(path.join(REPOS_DIR, name));
      return stat.isDirectory();
    });

    res.json({ repos });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list repos' });
  }
});

/**
 * Clear cached repositories
 */
app.delete('/repos', authenticate, (_req: Request, res: Response) => {
  try {
    if (fs.existsSync(REPOS_DIR)) {
      fs.rmSync(REPOS_DIR, { recursive: true, force: true });
      fs.mkdirSync(REPOS_DIR, { recursive: true });
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
app.listen(PORT, () => {
  console.log(`Claude Runner listening on port ${PORT}`);
  console.log(`OAuth status:`, checkOAuthStatus());

  if (!RUNNER_SECRET) {
    console.warn('WARNING: RUNNER_SECRET not set - authentication disabled!');
  }
});
