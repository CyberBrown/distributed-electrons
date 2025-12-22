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
import * as path from 'path';

const app = express();
const PORT = process.env.PORT || 8790;
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
function checkAuthStatus(): { configured: boolean; method?: string; details?: string } {
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

  if (fs.existsSync(oauthCredsPath)) {
    return {
      configured: true,
      method: 'google_oauth',
      details: 'Using Google OAuth credentials from gemini CLI',
    };
  }

  // Check for application default credentials
  const adcPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (adcPath && fs.existsSync(adcPath)) {
    return {
      configured: true,
      method: 'service_account',
      details: 'Using service account credentials',
    };
  }

  return { configured: false };
}

/**
 * Clone or update a git repository
 */
async function prepareRepo(repoUrl: string): Promise<string> {
  const repoHash = Buffer.from(repoUrl).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
  const repoDir = path.join(REPOS_DIR, repoHash);

  if (!fs.existsSync(REPOS_DIR)) {
    fs.mkdirSync(REPOS_DIR, { recursive: true });
  }

  if (fs.existsSync(repoDir)) {
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
    // Build command parts - Gemini uses positional prompt, not -p flag
    const cmdParts = ['gemini'];

    // Add model if specified
    if (model) {
      cmdParts.push('-m', model);
    }

    // Add sandbox mode if requested (restricts file system access)
    if (sandbox) {
      cmdParts.push('--sandbox');
    }

    // Auto-approve all actions for non-interactive execution
    cmdParts.push('--yolo');

    // Output format for easier parsing
    cmdParts.push('--output-format', 'text');

    // Escape prompt for shell - positional argument at end
    const escapedPrompt = prompt.replace(/'/g, "'\\''");
    cmdParts.push(`'${escapedPrompt}'`);

    // Redirect stderr to stdout and close stdin
    const fullCommand = `${cmdParts.join(' ')} 2>&1 </dev/null`;
    console.log(`Executing: ${fullCommand} in ${workingDir}`);

    const proc: ChildProcess = spawn('sh', ['-c', fullCommand], {
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
app.get('/health', (_req: Request, res: Response) => {
  const authStatus = checkAuthStatus();

  res.json({
    status: 'healthy',
    service: 'gemini-runner',
    timestamp: new Date().toISOString(),
    auth: authStatus,
    uptime_seconds: process.uptime(),
  });
});

/**
 * Auth status endpoint (authenticated)
 */
app.get('/auth/status', authenticate, (_req: Request, res: Response) => {
  const status = checkAuthStatus();
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
    const authStatus = checkAuthStatus();
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

    // Check if it was an auth error
    if (result.output.includes('authentication') || result.output.includes('401') || result.output.includes('unauthenticated')) {
      response.success = false;
      response.error = 'Authentication error - may need to re-authenticate';
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
  console.log(`Gemini Runner listening on port ${PORT}`);
  console.log(`Auth status:`, checkAuthStatus());

  if (!RUNNER_SECRET) {
    console.warn('WARNING: RUNNER_SECRET not set - authentication disabled!');
  }
});
