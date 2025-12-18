/**
 * Sandbox Executor Worker
 * Executes Claude Code tasks in sandboxes and supports:
 * - Cloudflare Worker deployment
 * - GitHub code commits
 * - Auto-deploy/auto-commit from execution results
 */

import type {
  Env,
  ExecuteRequest,
  ExecuteResponse,
  ExecutionResult,
  GeneratedFile,
  DeployRequest,
  DeploymentResult,
  GitHubCommitRequest,
  GitHubCommitResult,
  ErrorResponse,
  HealthResponse,
  GitHubTreeEntry,
  RepoContext,
  RepoFile,
  GitHubTreeItem,
} from './types';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestId = crypto.randomUUID();

    try {
      const url = new URL(request.url);

      // Handle CORS preflight
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          headers: corsHeaders(),
        });
      }

      // Route handling
      if (url.pathname === '/health' && request.method === 'GET') {
        return addCors(await handleHealth(env, requestId));
      }

      if (url.pathname === '/execute' && request.method === 'POST') {
        return addCors(await handleExecute(request, env, requestId));
      }

      if (url.pathname === '/deploy' && request.method === 'POST') {
        return addCors(await handleDeploy(request, env, requestId));
      }

      if (url.pathname === '/github/commit' && request.method === 'POST') {
        return addCors(await handleGitHubCommit(request, env, requestId));
      }

      return addCors(errorResponse('Not Found', 'ROUTE_NOT_FOUND', requestId, 404));
    } catch (error) {
      console.error('Unhandled error:', error);
      return addCors(
        errorResponse(
          error instanceof Error ? error.message : 'Internal Server Error',
          'INTERNAL_ERROR',
          requestId,
          500
        )
      );
    }
  },
};

// ============================================================================
// Health Endpoint
// ============================================================================

async function handleHealth(env: Env, requestId: string): Promise<Response> {
  const checks = {
    cloudflare: !!env.CLOUDFLARE_API_TOKEN && !!env.CLOUDFLARE_ACCOUNT_ID,
    github: !!env.GITHUB_PAT,
    anthropic: !!env.ANTHROPIC_API_KEY,
  };

  const allHealthy = Object.values(checks).every(Boolean);

  const response: HealthResponse = {
    status: allHealthy ? 'healthy' : 'degraded',
    service: 'sandbox-executor',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    checks,
  };

  return Response.json(response, {
    headers: { 'X-Request-ID': requestId },
  });
}

// ============================================================================
// Execute Endpoint
// ============================================================================

async function handleExecute(
  request: Request,
  env: Env,
  requestId: string
): Promise<Response> {
  const startTime = Date.now();

  try {
    const body: ExecuteRequest = await request.json();

    // Validate request
    if (!body.task || body.task.trim() === '') {
      return errorResponse('Task is required', 'INVALID_REQUEST', requestId, 400);
    }

    // Normalize params (support both old and new field names)
    const repo = body.repo || body.github_repo;
    const branch = body.branch || body.github_branch || 'main';
    const commitMessage = body.commitMessage || body.commit_message;
    const shouldCommit = repo && (body.auto_commit !== false) && !body.skipCommit;

    // Fetch repo context if a repo is specified
    let repoContext: RepoContext | undefined;
    if (repo) {
      console.log(`Fetching repo context for ${repo}@${branch}`);
      repoContext = await fetchRepoContext(repo, branch, env, body.paths);
      console.log(`Fetched ${repoContext.files.length} files from repo`);
    }

    // Execute the task with Claude (with repo context if available)
    const executionResult = await executeWithClaude(body, env, repoContext);

    // Prepare response
    const response: ExecuteResponse = {
      success: true,
      execution_id: requestId,
      result: executionResult,
      timestamp: new Date().toISOString(),
    };

    // Handle auto-deploy if requested
    if (body.auto_deploy && executionResult.files && executionResult.files.length > 0) {
      const mainFile = executionResult.files.find(
        (f) => f.path.endsWith('index.ts') || f.path.endsWith('index.js')
      );

      if (mainFile) {
        const deployResult = await deployToCloudflare(
          {
            worker_name: body.worker_name || `generated-worker-${Date.now()}`,
            code: mainFile.content,
            workers_dev: true,
          },
          env
        );
        response.deployment = deployResult;
      }
    }

    // Handle auto-commit if repo specified and files were generated
    if (shouldCommit && executionResult.files && executionResult.files.length > 0) {
      console.log(`Committing ${executionResult.files.length} files to ${repo}@${branch}`);

      // Determine base branch for creating new branches
      const baseBranch = repoContext?.branch || 'main';

      const commitResult = await commitToGitHub(
        {
          repo: repo!,
          branch,
          base_branch: baseBranch,
          create_branch: branch !== baseBranch,  // Create branch if different from base
          files: executionResult.files.map((f) => ({
            path: f.path,
            content: f.content,
          })),
          message: commitMessage || `sandbox-executor: ${body.task.slice(0, 50)}`,
        },
        env
      );
      response.commit = commitResult;
    }

    // Add execution time
    if (response.result?.metadata) {
      response.result.metadata.execution_time_ms = Date.now() - startTime;
    }

    return Response.json(response, {
      headers: { 'X-Request-ID': requestId },
    });
  } catch (error) {
    console.error('Execute error:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Execution failed',
      'EXECUTION_ERROR',
      requestId,
      500
    );
  }
}

// ============================================================================
// GitHub Repo Fetching
// ============================================================================

/** File extensions to fetch from repos */
const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'json', 'toml', 'yaml', 'yml',
  'md', 'mdx',
  'css', 'scss', 'less',
  'html', 'vue', 'svelte',
  'py', 'go', 'rs', 'rb',
  'sql', 'graphql', 'gql',
  'sh', 'bash',
  'env.example', 'gitignore', 'dockerignore',
]);

/** Directories to skip */
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  'coverage', '.nyc_output', '__pycache__', '.pytest_cache',
  'vendor', 'target', '.cargo',
]);

/** Max file size to fetch (100KB) */
const MAX_FILE_SIZE = 100 * 1024;

/** Max total content size (500KB) */
const MAX_TOTAL_SIZE = 500 * 1024;

/**
 * Fetch repository context via GitHub API
 * If branch doesn't exist, falls back to default branch (main/master)
 */
async function fetchRepoContext(
  repo: string,
  branch: string,
  env: Env,
  specificPaths?: string[]
): Promise<RepoContext> {
  const headers = {
    Authorization: `Bearer ${env.GITHUB_PAT}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'sandbox-executor',
  };

  // 1. Get the branch reference (try requested branch, then fallbacks)
  let headSha: string;
  let actualBranch = branch;

  const refResponse = await fetch(
    `https://api.github.com/repos/${repo}/git/ref/heads/${branch}`,
    { headers }
  );

  if (!refResponse.ok) {
    // Branch doesn't exist, try to get default branch
    console.log(`Branch '${branch}' not found, trying default branches`);

    // Try 'main' first, then 'master'
    for (const fallbackBranch of ['main', 'master']) {
      const fallbackResponse = await fetch(
        `https://api.github.com/repos/${repo}/git/ref/heads/${fallbackBranch}`,
        { headers }
      );

      if (fallbackResponse.ok) {
        const fallbackData = (await fallbackResponse.json()) as { object: { sha: string } };
        headSha = fallbackData.object.sha;
        actualBranch = fallbackBranch;
        console.log(`Using fallback branch '${actualBranch}' for repo context`);
        break;
      }
    }

    if (!headSha!) {
      throw new Error(`No valid branch found in ${repo}`);
    }
  } else {
    const refData = (await refResponse.json()) as { object: { sha: string } };
    headSha = refData.object.sha;
  }

  // 2. Get the commit to get tree SHA
  const commitResponse = await fetch(
    `https://api.github.com/repos/${repo}/git/commits/${headSha}`,
    { headers }
  );

  if (!commitResponse.ok) {
    throw new Error('Failed to get commit data');
  }

  const commitData = (await commitResponse.json()) as { tree: { sha: string } };
  const treeSha = commitData.tree.sha;

  // 3. Get the full tree (recursive)
  const treeResponse = await fetch(
    `https://api.github.com/repos/${repo}/git/trees/${treeSha}?recursive=1`,
    { headers }
  );

  if (!treeResponse.ok) {
    throw new Error('Failed to get repository tree');
  }

  const treeData = (await treeResponse.json()) as {
    sha: string;
    tree: GitHubTreeItem[];
    truncated: boolean;
  };

  // 4. Filter and fetch file contents
  const files: RepoFile[] = [];
  let totalSize = 0;

  // Filter files to fetch
  const filesToFetch = treeData.tree.filter((item) => {
    if (item.type !== 'blob') return false;
    if (!item.size || item.size > MAX_FILE_SIZE) return false;

    // Check if in skip directory
    const pathParts = item.path.split('/');
    if (pathParts.some((part) => SKIP_DIRS.has(part))) return false;

    // If specific paths provided, check if file matches
    if (specificPaths && specificPaths.length > 0) {
      return specificPaths.some((p) => item.path.startsWith(p) || item.path === p);
    }

    // Check file extension
    const ext = item.path.split('.').pop()?.toLowerCase() || '';
    const filename = item.path.split('/').pop() || '';

    // Include common config files
    if (['package.json', 'tsconfig.json', 'wrangler.toml', 'README.md', 'CLAUDE.md'].includes(filename)) {
      return true;
    }

    return CODE_EXTENSIONS.has(ext);
  });

  // Sort by likely importance (config files first, then by path)
  filesToFetch.sort((a, b) => {
    const aName = a.path.split('/').pop() || '';
    const bName = b.path.split('/').pop() || '';
    const configFiles = ['package.json', 'tsconfig.json', 'wrangler.toml', 'CLAUDE.md'];
    const aIsConfig = configFiles.includes(aName);
    const bIsConfig = configFiles.includes(bName);
    if (aIsConfig && !bIsConfig) return -1;
    if (!aIsConfig && bIsConfig) return 1;
    return a.path.localeCompare(b.path);
  });

  // Fetch file contents (with size limit)
  for (const item of filesToFetch) {
    if (totalSize + (item.size || 0) > MAX_TOTAL_SIZE) {
      console.log(`Stopping file fetch at ${files.length} files (size limit reached)`);
      break;
    }

    try {
      const content = await fetchFileContent(repo, item.sha, headers);
      files.push({
        path: item.path,
        content,
        sha: item.sha,
        size: item.size || 0,
      });
      totalSize += item.size || 0;
    } catch (error) {
      console.warn(`Failed to fetch ${item.path}:`, error);
    }
  }

  return {
    repo,
    branch: actualBranch,  // Use actual branch we fetched from
    headSha,
    treeSha,
    files,
  };
}

/**
 * Fetch a single file's content via GitHub API
 */
async function fetchFileContent(
  repo: string,
  sha: string,
  headers: Record<string, string>
): Promise<string> {
  const response = await fetch(
    `https://api.github.com/repos/${repo}/git/blobs/${sha}`,
    { headers }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch blob ${sha}`);
  }

  const data = (await response.json()) as {
    content: string;
    encoding: string;
  };

  if (data.encoding === 'base64') {
    // Decode base64 to UTF-8 string properly
    return base64ToUtf8(data.content.replace(/\n/g, ''));
  }

  return data.content;
}

/**
 * Execute task with Claude API
 * Uses a diff-based approach for editing existing files to avoid truncation
 */
async function executeWithClaude(
  request: ExecuteRequest,
  env: Env,
  repoContext?: RepoContext
): Promise<ExecutionResult> {
  // Build system prompt with repo context
  let systemPrompt: string;

  if (repoContext) {
    // When working with an existing repo, use DIFF-BASED editing to avoid truncation
    systemPrompt = `You are a code editing assistant. Your job is to describe CHANGES to existing files.

## Repository Context
You are working on: ${repoContext.repo} (branch: ${repoContext.branch})
Current commit: ${repoContext.headSha}

## Current File Contents
`;
    for (const file of repoContext.files) {
      systemPrompt += `### ${file.path}\n\`\`\`\n${file.content}\n\`\`\`\n\n`;
    }

    systemPrompt += `
## CRITICAL: Output Format for File Changes
You MUST use this EXACT format for any file modifications:

### For EDITING an existing file (search and replace):
\`\`\`edit:path/to/file.ext
<<<<<<< SEARCH
exact text to find (copy from current content)
=======
replacement text
>>>>>>> REPLACE
\`\`\`

### For APPENDING to a file:
\`\`\`append:path/to/file.ext
text to add at the end
\`\`\`

### For PREPENDING to a file:
\`\`\`prepend:path/to/file.ext
text to add at the beginning
\`\`\`

### For creating a NEW file:
\`\`\`new:path/to/newfile.ext
complete file content
\`\`\`

## Rules:
1. For edits: The SEARCH block must EXACTLY match text in the current file (including whitespace)
2. You can have multiple edit blocks for different changes in the same file
3. For small changes, use edit/append/prepend - NEVER output entire file contents
4. Only use "new:" for files that don't exist yet

## Example:
To add a line at the end of README.md, use:
\`\`\`append:README.md
=) new line here
\`\`\`

To change a function name:
\`\`\`edit:src/index.ts
<<<<<<< SEARCH
function oldName() {
=======
function newName() {
>>>>>>> REPLACE
\`\`\``;
  } else {
    // No repo context - generating new code from scratch
    systemPrompt = `You are a code generation assistant. Generate clean, production-ready code based on the user's request.

When generating code:
1. Always include complete, runnable code
2. Use TypeScript when appropriate
3. Follow best practices for the target platform
4. Include necessary type definitions

IMPORTANT: When your response includes generated files, format them as:
\`\`\`new:path/to/file.ts
// file content here
\`\`\`

The path should be relative to the repository root.`;
  }

  // Add any additional context
  if (request.context) {
    systemPrompt += `\n\n## Additional Context\n${request.context}`;
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: request.options?.max_tokens || 8192,
      temperature: request.options?.temperature || 0.3,
      system: systemPrompt,
      messages: [{ role: 'user', content: request.task }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const textContent = data.content.find((c) => c.type === 'text');
  const output = textContent?.text || '';

  // Parse and apply edits from the output
  const files = repoContext
    ? applyEditsFromOutput(output, repoContext)
    : parseGeneratedFiles(output);

  return {
    output,
    files: files.length > 0 ? files : undefined,
    metadata: {
      tokens_used: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
    },
  };
}

/**
 * Apply edits from Claude's output to existing files
 * Supports: edit (search/replace), append, prepend, new
 */
function applyEditsFromOutput(output: string, repoContext: RepoContext): GeneratedFile[] {
  const fileChanges = new Map<string, string>();

  // Initialize with current file contents
  for (const file of repoContext.files) {
    fileChanges.set(file.path, file.content);
  }

  // Match edit blocks: ```edit:path/to/file.ext
  const editRegex = /```edit:([^\n]+)\n([\s\S]*?)```/g;
  let match;
  while ((match = editRegex.exec(output)) !== null) {
    const path = match[1].trim();
    const editContent = match[2];

    // Parse search/replace blocks
    const searchReplaceRegex = /<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;
    let srMatch;
    let currentContent = fileChanges.get(path) || '';

    while ((srMatch = searchReplaceRegex.exec(editContent)) !== null) {
      const searchText = srMatch[1];
      const replaceText = srMatch[2];

      if (currentContent.includes(searchText)) {
        currentContent = currentContent.replace(searchText, replaceText);
        console.log(`Applied edit to ${path}: replaced ${searchText.length} chars`);
      } else {
        console.warn(`Edit failed for ${path}: search text not found`);
        console.warn(`Search text: "${searchText.slice(0, 100)}..."`);
      }
    }

    fileChanges.set(path, currentContent);
  }

  // Match append blocks: ```append:path/to/file.ext
  const appendRegex = /```append:([^\n]+)\n([\s\S]*?)```/g;
  while ((match = appendRegex.exec(output)) !== null) {
    const path = match[1].trim();
    const appendContent = match[2].trim();
    const currentContent = fileChanges.get(path) || '';

    // Ensure there's a newline before appending
    const newContent = currentContent.endsWith('\n')
      ? currentContent + appendContent + '\n'
      : currentContent + '\n' + appendContent + '\n';

    fileChanges.set(path, newContent);
    console.log(`Appended ${appendContent.length} chars to ${path}`);
  }

  // Match prepend blocks: ```prepend:path/to/file.ext
  const prependRegex = /```prepend:([^\n]+)\n([\s\S]*?)```/g;
  while ((match = prependRegex.exec(output)) !== null) {
    const path = match[1].trim();
    const prependContent = match[2].trim();
    const currentContent = fileChanges.get(path) || '';

    const newContent = prependContent + '\n' + currentContent;
    fileChanges.set(path, newContent);
    console.log(`Prepended ${prependContent.length} chars to ${path}`);
  }

  // Match new file blocks: ```new:path/to/file.ext
  const newFileRegex = /```new:([^\n]+)\n([\s\S]*?)```/g;
  while ((match = newFileRegex.exec(output)) !== null) {
    const path = match[1].trim();
    const content = match[2].trim();

    // Only create if file doesn't exist
    if (!fileChanges.has(path)) {
      fileChanges.set(path, content);
      console.log(`Created new file ${path} with ${content.length} chars`);
    } else {
      console.warn(`Skipping new file ${path}: file already exists`);
    }
  }

  // Also support legacy format: ```filename:path or just ```path/to/file.ext
  // But only for files that DON'T already exist (treat as new files)
  const legacyRegex = /```(?:filename:)?([^\n]+)\n([\s\S]*?)```/g;
  while ((match = legacyRegex.exec(output)) !== null) {
    const path = match[1].trim();
    const content = match[2].trim();

    // Skip if it matches our new format
    if (path.startsWith('edit:') || path.startsWith('append:') ||
        path.startsWith('prepend:') || path.startsWith('new:')) {
      continue;
    }

    // Skip if path looks like a language specifier
    if (!path.includes('/') && !path.includes('.')) {
      continue;
    }

    // Only use legacy format for new files
    if (!fileChanges.has(path)) {
      fileChanges.set(path, content);
      console.log(`Created new file (legacy format) ${path}`);
    }
  }

  // Convert to GeneratedFile array, only including files that changed
  const result: GeneratedFile[] = [];
  const typeMap: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    json: 'json', md: 'markdown', toml: 'toml', yaml: 'yaml', yml: 'yaml',
  };

  for (const [path, content] of fileChanges) {
    // Check if content changed from original
    const original = repoContext.files.find((f) => f.path === path);
    if (!original || original.content !== content) {
      const ext = path.split('.').pop()?.toLowerCase() || '';
      result.push({
        path,
        content,
        type: typeMap[ext] || 'text',
      });
    }
  }

  return result;
}

/**
 * Parse generated files from Claude's output
 * Looks for code blocks with filename:path format (for new code generation without repo context)
 */
function parseGeneratedFiles(output: string): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  // Match code blocks with new: prefix or filename annotation
  const codeBlockRegex = /```(?:new:|filename:)?([^\n]+)\n([\s\S]*?)```/g;

  let match;
  while ((match = codeBlockRegex.exec(output)) !== null) {
    const path = match[1].trim();
    const content = match[2].trim();

    // Skip if path looks like a language specifier (no extension or slash)
    if (!path.includes('/') && !path.includes('.')) {
      continue;
    }

    // Determine file type from extension
    const ext = path.split('.').pop()?.toLowerCase();
    const typeMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      json: 'json',
      md: 'markdown',
      toml: 'toml',
      yaml: 'yaml',
      yml: 'yaml',
    };

    files.push({
      path,
      content,
      type: typeMap[ext || ''] || 'text',
    });
  }

  return files;
}

// ============================================================================
// Deploy Endpoint
// ============================================================================

async function handleDeploy(
  request: Request,
  env: Env,
  requestId: string
): Promise<Response> {
  try {
    // Validate secrets
    if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
      return errorResponse(
        'Cloudflare credentials not configured',
        'MISSING_CREDENTIALS',
        requestId,
        500
      );
    }

    const body: DeployRequest = await request.json();

    // Validate request
    if (!body.worker_name || body.worker_name.trim() === '') {
      return errorResponse('worker_name is required', 'INVALID_REQUEST', requestId, 400);
    }

    if (!body.code || body.code.trim() === '') {
      return errorResponse('code is required', 'INVALID_REQUEST', requestId, 400);
    }

    const result = await deployToCloudflare(body, env);

    if (!result.success) {
      return errorResponse(result.error || 'Deployment failed', 'DEPLOYMENT_FAILED', requestId, 500);
    }

    return Response.json(
      { success: true, deployment: result, request_id: requestId },
      { headers: { 'X-Request-ID': requestId } }
    );
  } catch (error) {
    console.error('Deploy error:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Deployment failed',
      'DEPLOYMENT_ERROR',
      requestId,
      500
    );
  }
}

/**
 * Deploy worker to Cloudflare using the Workers API
 */
async function deployToCloudflare(
  request: DeployRequest,
  env: Env
): Promise<DeploymentResult> {
  const { worker_name, code, compatibility_date, workers_dev, env_vars, secrets } = request;

  try {
    // Build the worker script with metadata
    const metadata = {
      main_module: 'index.js',
      compatibility_date: compatibility_date || '2024-01-01',
      compatibility_flags: ['nodejs_compat'],
      bindings: [] as Array<{ type: string; name: string; text?: string }>,
    };

    // Add environment variables as bindings
    if (env_vars) {
      for (const [name, value] of Object.entries(env_vars)) {
        metadata.bindings.push({
          type: 'plain_text',
          name,
          text: value,
        });
      }
    }

    // Create FormData for multipart upload
    const formData = new FormData();

    // Add the main script as a module
    formData.append(
      'index.js',
      new Blob([code], { type: 'application/javascript+module' }),
      'index.js'
    );

    // Add metadata
    formData.append(
      'metadata',
      new Blob([JSON.stringify(metadata)], { type: 'application/json' })
    );

    // Deploy the worker
    const deployUrl = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${worker_name}`;

    const response = await fetch(deployUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      },
      body: formData,
    });

    const data = (await response.json()) as {
      success: boolean;
      result?: { id?: string; etag?: string };
      errors?: Array<{ message: string }>;
    };

    if (!response.ok || !data.success) {
      const errorMsg = data.errors?.[0]?.message || `HTTP ${response.status}`;
      return {
        success: false,
        error: `Cloudflare API error: ${errorMsg}`,
      };
    }

    // Set secrets if provided
    if (secrets) {
      for (const [name, value] of Object.entries(secrets)) {
        await setWorkerSecret(env, worker_name, name, value);
      }
    }

    // Enable workers.dev subdomain if requested
    let workerUrl: string | undefined;
    if (workers_dev !== false) {
      workerUrl = await enableWorkersDev(env, worker_name);
    }

    return {
      success: true,
      url: workerUrl,
      worker_id: data.result?.id,
      version: data.result?.etag,
      deployed_at: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Cloudflare deployment error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown deployment error',
    };
  }
}

/**
 * Set a secret for a worker
 */
async function setWorkerSecret(
  env: Env,
  workerName: string,
  secretName: string,
  secretValue: string
): Promise<void> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${workerName}/secrets`;

  await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: secretName,
      text: secretValue,
      type: 'secret_text',
    }),
  });
}

/**
 * Enable workers.dev subdomain for a worker
 */
async function enableWorkersDev(env: Env, workerName: string): Promise<string | undefined> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${workerName}/subdomain`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ enabled: true }),
  });

  if (response.ok) {
    // Get the account's subdomain
    const subdomainResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/subdomain`,
      {
        headers: {
          Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        },
      }
    );

    const subdomainData = (await subdomainResponse.json()) as {
      result?: { subdomain?: string };
    };
    const subdomain = subdomainData.result?.subdomain;

    if (subdomain) {
      return `https://${workerName}.${subdomain}.workers.dev`;
    }
  }

  return undefined;
}

// ============================================================================
// GitHub Commit Endpoint
// ============================================================================

async function handleGitHubCommit(
  request: Request,
  env: Env,
  requestId: string
): Promise<Response> {
  try {
    // Validate secrets
    if (!env.GITHUB_PAT) {
      return errorResponse('GitHub PAT not configured', 'MISSING_CREDENTIALS', requestId, 500);
    }

    const body: GitHubCommitRequest = await request.json();

    // Validate request
    if (!body.repo || !body.repo.includes('/')) {
      return errorResponse('repo must be in owner/repo format', 'INVALID_REQUEST', requestId, 400);
    }

    if (!body.files || body.files.length === 0) {
      return errorResponse('files array is required', 'INVALID_REQUEST', requestId, 400);
    }

    if (!body.message || body.message.trim() === '') {
      return errorResponse('message is required', 'INVALID_REQUEST', requestId, 400);
    }

    const result = await commitToGitHub(body, env);

    if (!result.success) {
      return errorResponse(result.error || 'Commit failed', 'COMMIT_FAILED', requestId, 500);
    }

    return Response.json(
      { success: true, commit: result, request_id: requestId },
      { headers: { 'X-Request-ID': requestId } }
    );
  } catch (error) {
    console.error('GitHub commit error:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Commit failed',
      'COMMIT_ERROR',
      requestId,
      500
    );
  }
}

/**
 * Commit files to GitHub repository using the Git Data API
 */
async function commitToGitHub(
  request: GitHubCommitRequest,
  env: Env
): Promise<GitHubCommitResult> {
  const { repo, files, message, create_pr, pr_title, pr_body } = request;
  const branch = request.branch || 'main';
  const baseBranch = request.base_branch || 'main';

  const headers = {
    Authorization: `Bearer ${env.GITHUB_PAT}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    'User-Agent': 'sandbox-executor',
  };

  try {
    // 1. Get the reference for the target branch
    let refSha: string;
    const refResponse = await fetch(`https://api.github.com/repos/${repo}/git/ref/heads/${branch}`, {
      headers,
    });

    if (!refResponse.ok) {
      if (refResponse.status === 404 && request.create_branch) {
        // Branch doesn't exist, create it from base branch
        const baseRefResponse = await fetch(
          `https://api.github.com/repos/${repo}/git/ref/heads/${baseBranch}`,
          { headers }
        );

        if (!baseRefResponse.ok) {
          return { success: false, error: `Base branch '${baseBranch}' not found` };
        }

        const baseRefData = (await baseRefResponse.json()) as { object: { sha: string } };
        refSha = baseRefData.object.sha;

        // Create the new branch
        const createBranchResponse = await fetch(`https://api.github.com/repos/${repo}/git/refs`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            ref: `refs/heads/${branch}`,
            sha: refSha,
          }),
        });

        if (!createBranchResponse.ok) {
          const errorData = await createBranchResponse.json();
          return {
            success: false,
            error: `Failed to create branch: ${JSON.stringify(errorData)}`,
          };
        }
      } else {
        return { success: false, error: `Branch '${branch}' not found` };
      }
    } else {
      const refData = (await refResponse.json()) as { object: { sha: string } };
      refSha = refData.object.sha;
    }

    // 2. Get the current commit to get the tree SHA
    const commitResponse = await fetch(`https://api.github.com/repos/${repo}/git/commits/${refSha}`, {
      headers,
    });

    if (!commitResponse.ok) {
      return { success: false, error: 'Failed to get current commit' };
    }

    const commitData = (await commitResponse.json()) as { tree: { sha: string } };
    const baseTreeSha = commitData.tree.sha;

    // 3. Create blobs for each file and build tree
    const treeEntries: GitHubTreeEntry[] = [];

    for (const file of files) {
      if (file.content === null) {
        // Delete file by setting sha to null
        treeEntries.push({
          path: file.path,
          mode: '100644',
          type: 'blob',
          sha: null,
        });
      } else {
        // Create blob for file content
        // Use TextEncoder for proper UTF-8 encoding of unicode characters
        const base64Content = file.encoding === 'base64'
          ? file.content
          : utf8ToBase64(file.content);

        const blobResponse = await fetch(`https://api.github.com/repos/${repo}/git/blobs`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            content: base64Content,
            encoding: 'base64',
          }),
        });

        if (!blobResponse.ok) {
          return { success: false, error: `Failed to create blob for ${file.path}` };
        }

        const blobData = (await blobResponse.json()) as { sha: string };

        treeEntries.push({
          path: file.path,
          mode: '100644',
          type: 'blob',
          sha: blobData.sha,
        });
      }
    }

    // 4. Create a new tree
    const treeResponse = await fetch(`https://api.github.com/repos/${repo}/git/trees`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: treeEntries,
      }),
    });

    if (!treeResponse.ok) {
      return { success: false, error: 'Failed to create tree' };
    }

    const treeData = (await treeResponse.json()) as { sha: string };

    // 5. Create a new commit
    const newCommitResponse = await fetch(`https://api.github.com/repos/${repo}/git/commits`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message,
        tree: treeData.sha,
        parents: [refSha],
      }),
    });

    if (!newCommitResponse.ok) {
      return { success: false, error: 'Failed to create commit' };
    }

    const newCommitData = (await newCommitResponse.json()) as {
      sha: string;
      html_url: string;
    };

    // 6. Update the reference to point to the new commit
    const updateRefResponse = await fetch(
      `https://api.github.com/repos/${repo}/git/refs/heads/${branch}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          sha: newCommitData.sha,
          force: false,
        }),
      }
    );

    if (!updateRefResponse.ok) {
      return { success: false, error: 'Failed to update branch reference' };
    }

    const result: GitHubCommitResult = {
      success: true,
      sha: newCommitData.sha,
      url: newCommitData.html_url,
      branch,
    };

    // 7. Create pull request if requested
    if (create_pr && branch !== baseBranch) {
      const prResponse = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: pr_title || message,
          body: pr_body || `Auto-generated PR from sandbox-executor\n\nCommit: ${newCommitData.sha}`,
          head: branch,
          base: baseBranch,
        }),
      });

      if (prResponse.ok) {
        const prData = (await prResponse.json()) as { html_url: string };
        result.pr_url = prData.html_url;
      }
    }

    return result;
  } catch (error) {
    console.error('GitHub commit error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown GitHub error',
    };
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert a UTF-8 string to base64, properly handling unicode characters
 */
function utf8ToBase64(str: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert a base64 string to UTF-8, properly handling unicode characters
 */
function base64ToUtf8(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const decoder = new TextDecoder('utf-8');
  return decoder.decode(bytes);
}

function corsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function addCors(response: Response): Response {
  const newResponse = new Response(response.body, response);
  newResponse.headers.set('Access-Control-Allow-Origin', '*');
  newResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  newResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, Authorization');
  return newResponse;
}

function errorResponse(
  message: string,
  code: string,
  requestId: string,
  status: number
): Response {
  const body: ErrorResponse = {
    error: message,
    error_code: code,
    request_id: requestId,
  };

  return Response.json(body, {
    status,
    headers: { 'X-Request-ID': requestId },
  });
}
