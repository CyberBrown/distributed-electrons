/**
 * Reauth UI - OAuth Reauth Web Interface
 *
 * Mobile-friendly web UI for managing OAuth credentials for
 * Claude Code CLI and Gemini CLI on Spark server.
 *
 * Endpoints:
 * - GET / - Serve the web UI
 * - GET /status - Get OAuth status for both services
 * - POST /reauth/claude - Trigger Claude Code reauth
 * - POST /reauth/gemini - Trigger Gemini CLI reauth
 */

import express, { Request, Response, NextFunction } from 'express';
import * as fs from 'fs';
import * as path from 'path';

const app = express();
const PORT = process.env.PORT || 8791;
const REAUTH_PASSWORD = process.env.REAUTH_PASSWORD;

// Paths to credential files
const CLAUDE_CREDS_PATH = path.join(process.env.HOME || '/home/chris', '.claude', '.credentials.json');
const GEMINI_CREDS_PATH = path.join(process.env.HOME || '/home/chris', '.gemini', 'oauth_creds.json');

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Request logging
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Simple password auth middleware
function authenticate(req: Request, res: Response, next: NextFunction) {
  // Skip auth if no password configured (rely on CF Access)
  if (!REAUTH_PASSWORD) {
    return next();
  }

  const authHeader = req.headers.authorization;
  const password = req.query.password as string || req.body?.password;

  // Check Authorization header (Basic auth)
  if (authHeader) {
    const [type, credentials] = authHeader.split(' ');
    if (type === 'Basic') {
      const decoded = Buffer.from(credentials, 'base64').toString();
      const [, pwd] = decoded.split(':');
      if (pwd === REAUTH_PASSWORD) {
        return next();
      }
    }
  }

  // Check query/body password
  if (password === REAUTH_PASSWORD) {
    return next();
  }

  // Check session cookie
  const sessionCookie = req.headers.cookie?.split(';')
    .find(c => c.trim().startsWith('reauth_session='));
  if (sessionCookie) {
    const sessionValue = sessionCookie.split('=')[1];
    if (sessionValue === REAUTH_PASSWORD) {
      return next();
    }
  }

  res.status(401).json({ error: 'Unauthorized' });
}

// Types
interface ClaudeCredentials {
  claudeAiOauth?: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    scopes?: string[];
    subscriptionType?: string;
  };
}

interface GeminiCredentials {
  access_token?: string;
  refresh_token?: string;
  expiry?: string;
}

interface ServiceStatus {
  valid: boolean;
  configured: boolean;
  hours_remaining: number | null;
  expires_at: string | null;
  method?: string;
}

/**
 * Get Claude Code OAuth status
 */
function getClaudeStatus(): ServiceStatus {
  try {
    if (!fs.existsSync(CLAUDE_CREDS_PATH)) {
      return { valid: false, configured: false, hours_remaining: null, expires_at: null };
    }

    const content = fs.readFileSync(CLAUDE_CREDS_PATH, 'utf-8');
    const creds: ClaudeCredentials = JSON.parse(content);

    if (!creds.claudeAiOauth?.expiresAt) {
      return { valid: false, configured: true, hours_remaining: null, expires_at: null };
    }

    const expiresAt = new Date(creds.claudeAiOauth.expiresAt);
    const now = new Date();
    const hoursRemaining = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60);

    return {
      valid: hoursRemaining > 0,
      configured: true,
      hours_remaining: Math.round(hoursRemaining * 10) / 10,
      expires_at: expiresAt.toISOString(),
      method: 'oauth',
    };
  } catch (error) {
    console.error('Error reading Claude credentials:', error);
    return { valid: false, configured: false, hours_remaining: null, expires_at: null };
  }
}

/**
 * Get Gemini CLI auth status
 */
function getGeminiStatus(): ServiceStatus {
  try {
    if (!fs.existsSync(GEMINI_CREDS_PATH)) {
      return { valid: false, configured: false, hours_remaining: null, expires_at: null };
    }

    const content = fs.readFileSync(GEMINI_CREDS_PATH, 'utf-8');
    const creds: GeminiCredentials = JSON.parse(content);

    // Gemini OAuth tokens typically have an expiry field
    if (creds.expiry) {
      const expiresAt = new Date(creds.expiry);
      const now = new Date();
      const hoursRemaining = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60);

      return {
        valid: hoursRemaining > 0,
        configured: true,
        hours_remaining: Math.round(hoursRemaining * 10) / 10,
        expires_at: expiresAt.toISOString(),
        method: 'google_oauth',
      };
    }

    // If no expiry but credentials exist, assume valid (long-lived)
    if (creds.access_token || creds.refresh_token) {
      return {
        valid: true,
        configured: true,
        hours_remaining: null,
        expires_at: null,
        method: 'google_oauth',
      };
    }

    return { valid: false, configured: false, hours_remaining: null, expires_at: null };
  } catch (error) {
    console.error('Error reading Gemini credentials:', error);
    return { valid: false, configured: false, hours_remaining: null, expires_at: null };
  }
}

/**
 * Trigger Claude reauth
 * Since OAuth requires interactive terminal, provide instructions
 */
async function triggerClaudeReauth(): Promise<{ success: boolean; oauth_url?: string; message: string; instructions?: string[] }> {
  const status = getClaudeStatus();

  if (status.valid && status.hours_remaining && status.hours_remaining > 1) {
    return {
      success: true,
      message: `Claude is already authenticated (${status.hours_remaining}h remaining)`,
    };
  }

  // OAuth requires interactive terminal - provide instructions
  return {
    success: false,
    message: status.valid
      ? `Token expires soon (${status.hours_remaining}h). Re-authenticate to refresh.`
      : 'Claude OAuth expired or not configured.',
    instructions: [
      'SSH into Spark: ssh chris@spark',
      'Run: claude',
      'Follow the OAuth prompt in your browser',
      'Return here and refresh to verify',
    ],
  };
}

/**
 * Trigger Gemini reauth
 * Since OAuth requires interactive terminal, provide instructions
 */
async function triggerGeminiReauth(): Promise<{ success: boolean; oauth_url?: string; message: string; instructions?: string[] }> {
  const status = getGeminiStatus();

  if (status.valid) {
    return {
      success: true,
      message: 'Gemini is already authenticated',
    };
  }

  // OAuth requires interactive terminal - provide instructions
  return {
    success: false,
    message: 'Gemini OAuth expired or not configured.',
    instructions: [
      'SSH into Spark: ssh chris@spark',
      'Run: gemini',
      'Follow the Google OAuth prompt in your browser',
      'Return here and refresh to verify',
    ],
  };
}

// Routes

/**
 * Login endpoint - set session cookie
 */
app.post('/login', (req: Request, res: Response) => {
  const { password } = req.body;

  if (!REAUTH_PASSWORD) {
    return res.json({ success: true, message: 'No password required' });
  }

  if (password === REAUTH_PASSWORD) {
    res.cookie('reauth_session', REAUTH_PASSWORD, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    });
    return res.json({ success: true });
  }

  res.status(401).json({ success: false, error: 'Invalid password' });
});

/**
 * Status endpoint
 */
app.get('/status', authenticate, (_req: Request, res: Response) => {
  const claude = getClaudeStatus();
  const gemini = getGeminiStatus();

  res.json({
    timestamp: new Date().toISOString(),
    claude,
    gemini,
  });
});

/**
 * Trigger Claude reauth
 */
app.post('/reauth/claude', authenticate, async (_req: Request, res: Response) => {
  const result = await triggerClaudeReauth();
  res.json(result);
});

/**
 * Trigger Gemini reauth
 */
app.post('/reauth/gemini', authenticate, async (_req: Request, res: Response) => {
  const result = await triggerGeminiReauth();
  res.json(result);
});

/**
 * Health check (no auth required)
 */
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    service: 'reauth-ui',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Serve index.html for root
 */
app.get('/', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Reauth UI listening on port ${PORT}`);
  console.log(`Password protection: ${REAUTH_PASSWORD ? 'enabled' : 'disabled (using CF Access)'}`);
});
