/**
 * Config Service Worker
 * Central service for managing instances, users, and configuration
 */

import { Env } from './types';
import { errorResponse } from './utils';

// Instance handlers
import {
  getInstance,
  listInstances,
  createInstance,
  updateInstance,
  deleteInstance,
} from './handlers/instance-handlers';

// User handlers
import {
  getUser,
  listUsers,
  getUserByEmail,
  createUser,
  updateUser,
  deleteUser,
} from './handlers/user-handlers';

// Project handlers
import {
  getProject,
  listProjects,
  createProject,
  updateProject,
  deleteProject,
} from './handlers/project-handlers';

// Model Config handlers
import {
  getModelConfig,
  listModelConfigs,
  createModelConfig,
  updateModelConfig,
  deleteModelConfig,
} from './handlers/model-config-handlers';

// Provider Key handlers
import {
  storeProviderKey,
  getProviderKeyStatus,
  deleteProviderKey,
  listProviderKeys,
} from './handlers/provider-key-handlers';

// Dev Credentials handlers
import {
  storeDevCredential,
  getDevCredential,
  deleteDevCredential,
  listDevCredentials,
} from './handlers/dev-credentials-handlers';

// Activity handlers
import {
  getActivityFeed,
  markActivityRead,
  getEventsForEntity,
  getEventStats,
  trackEvent,
  listEventSubscriptions,
  createEventSubscription,
  updateEventSubscription,
  deleteEventSubscription,
} from './handlers/activity-handlers';

// OAuth handlers
import {
  storeOAuthCredentials,
  getOAuthStatus,
  getOAuthCredentials,
  deleteOAuthCredentials,
  refreshOAuthCredentials,
} from './handlers/oauth-handlers';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    // Enable CORS for all requests
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Route matching
      const pathParts = pathname.split('/').filter(Boolean);

      // Health check
      if (pathname === '/health' || pathname === '/') {
        return new Response(
          JSON.stringify({ status: 'healthy', service: 'config-service' }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      // OAuth refresh page - mobile-friendly UI
      if (pathname === '/oauth/refresh' || pathname === '/oauth/refresh/') {
        const refreshPage = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Refresh Claude OAuth</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh; color: #fff; padding: 20px;
    }
    .container { max-width: 500px; margin: 0 auto; }
    h1 { font-size: 1.8rem; margin-bottom: 10px; }
    .status { background: #ff6b6b; padding: 15px; border-radius: 10px; margin: 20px 0; }
    .status.success { background: #51cf66; }
    .step { background: rgba(255,255,255,0.1); padding: 20px; border-radius: 10px; margin: 15px 0; }
    .step-num { background: #4dabf7; width: 30px; height: 30px; border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center; margin-right: 10px; }
    code { background: rgba(0,0,0,0.3); padding: 3px 8px; border-radius: 5px; font-size: 0.9rem; }
    .btn { display: block; width: 100%; padding: 18px; border: none; border-radius: 10px;
      font-size: 1.1rem; font-weight: 600; cursor: pointer; margin: 10px 0; text-decoration: none; text-align: center; }
    .btn-primary { background: #4dabf7; color: #fff; }
    .btn-success { background: #51cf66; color: #fff; }
    .btn:active { transform: scale(0.98); }
    .instructions { font-size: 0.95rem; line-height: 1.6; opacity: 0.9; }
    #result { margin-top: 20px; padding: 15px; border-radius: 10px; display: none; }
    .spinner { display: inline-block; width: 20px; height: 20px; border: 3px solid rgba(255,255,255,0.3);
      border-radius: 50%; border-top-color: #fff; animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔐 Refresh OAuth</h1>
    <div class="status" id="status">OAuth credentials have expired</div>

    <div class="step">
      <span class="step-num">1</span>
      <strong>On your computer, run:</strong>
      <p class="instructions" style="margin-top: 10px;">
        <code id="cmd1">claude login</code>
        <button onclick="copyCmd('cmd1')" style="margin-left:10px;padding:5px 10px;border-radius:5px;border:none;background:#4dabf7;color:#fff;cursor:pointer;">📋 Copy</button>
        <br><br>
        Then after login completes:<br><br>
        <code id="cmd2">cd ~/projects/nexus && bun run de-auth:deploy</code>
        <button onclick="copyCmd('cmd2')" style="margin-left:10px;padding:5px 10px;border-radius:5px;border:none;background:#4dabf7;color:#fff;cursor:pointer;">📋 Copy</button>
      </p>
    </div>

    <button class="btn btn-success" onclick="checkStatus()">
      ✓ Check Status
    </button>

    <div style="margin-top:20px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.2);">
      <p style="opacity:0.8;margin-bottom:10px;font-size:0.9rem;">Already logged in on your computer? Your existing credentials may still be valid:</p>
      <button class="btn btn-primary" onclick="checkStatus()">
        🔄 Check If Already Valid
      </button>
    </div>

    <div id="result"></div>

    <div style="margin-top: 30px; opacity: 0.7; font-size: 0.85rem; text-align: center;">
      <p>Can't access terminal? SSH into your server first.</p>
    </div>
  </div>

  <script>
    function copyCmd(id) {
      const text = document.getElementById(id).textContent;
      navigator.clipboard.writeText(text).then(() => {
        const btn = document.querySelector('#' + id + ' + button');
        const orig = btn.textContent;
        btn.textContent = '✓ Copied!';
        setTimeout(() => btn.textContent = orig, 2000);
      });
    }

    async function checkStatus() {
      const result = document.getElementById('result');
      const status = document.getElementById('status');
      result.style.display = 'block';
      result.innerHTML = '<span class="spinner"></span> Checking...';
      result.style.background = 'rgba(255,255,255,0.1)';

      try {
        const resp = await fetch('/oauth/claude/status');
        const data = await resp.json();

        if (data.data.configured && !data.data.expired) {
          status.textContent = '✅ OAuth credentials are valid!';
          status.className = 'status success';
          result.innerHTML = '🎉 All good! Credentials expire in ' + data.data.hours_remaining + ' hours.';
          result.style.background = '#51cf66';
        } else if (data.data.configured && data.data.expired) {
          result.innerHTML = '⚠️ Credentials found but expired. Please complete the steps above.';
          result.style.background = '#ff6b6b';
        } else {
          result.innerHTML = '❌ No credentials found. Please complete the steps above.';
          result.style.background = '#ff6b6b';
        }
      } catch (e) {
        result.innerHTML = '❌ Error checking status: ' + e.message;
        result.style.background = '#ff6b6b';
      }
    }

    // Check status on load
    checkStatus();
  </script>
</body>
</html>`;
        return new Response(refreshPage, {
          headers: { ...corsHeaders, 'Content-Type': 'text/html' },
        });
      }

      // Instance routes
      if (pathParts[0] === 'instance') {
        if (pathParts.length === 1) {
          // GET /instance or POST /instance
          if (method === 'GET') {
            const orgId = url.searchParams.get('org_id');
            const response = await listInstances(orgId, env);
            return addCorsHeaders(response, corsHeaders);
          } else if (method === 'POST') {
            const response = await createInstance(request, env);
            return addCorsHeaders(response, corsHeaders);
          }
        } else if (pathParts.length === 2) {
          const instanceId = pathParts[1];
          // GET /instance/{id}, PUT /instance/{id}, DELETE /instance/{id}
          if (method === 'GET') {
            const response = await getInstance(instanceId, env);
            return addCorsHeaders(response, corsHeaders);
          } else if (method === 'PUT') {
            const response = await updateInstance(instanceId, request, env);
            return addCorsHeaders(response, corsHeaders);
          } else if (method === 'DELETE') {
            const response = await deleteInstance(instanceId, env);
            return addCorsHeaders(response, corsHeaders);
          }
        }
      }

      // User routes
      if (pathParts[0] === 'user') {
        if (pathParts.length === 1) {
          // GET /user or POST /user
          if (method === 'GET') {
            const orgId = url.searchParams.get('org_id');
            const response = await listUsers(orgId, env);
            return addCorsHeaders(response, corsHeaders);
          } else if (method === 'POST') {
            const response = await createUser(request, env);
            return addCorsHeaders(response, corsHeaders);
          }
        } else if (pathParts.length === 2) {
          const userId = pathParts[1];
          // GET /user/{id}, PUT /user/{id}, DELETE /user/{id}
          if (method === 'GET') {
            const response = await getUser(userId, env);
            return addCorsHeaders(response, corsHeaders);
          } else if (method === 'PUT') {
            const response = await updateUser(userId, request, env);
            return addCorsHeaders(response, corsHeaders);
          } else if (method === 'DELETE') {
            const response = await deleteUser(userId, env);
            return addCorsHeaders(response, corsHeaders);
          }
        } else if (pathParts.length === 3 && pathParts[1] === 'email') {
          // GET /user/email/{email}
          const email = decodeURIComponent(pathParts[2]);
          if (method === 'GET') {
            const response = await getUserByEmail(email, env);
            return addCorsHeaders(response, corsHeaders);
          }
        }
      }

      // Project routes
      if (pathParts[0] === 'project') {
        if (pathParts.length === 1) {
          // GET /project or POST /project
          if (method === 'GET') {
            const instanceId = url.searchParams.get('instance_id');
            const response = await listProjects(instanceId, env);
            return addCorsHeaders(response, corsHeaders);
          } else if (method === 'POST') {
            const response = await createProject(request, env);
            return addCorsHeaders(response, corsHeaders);
          }
        } else if (pathParts.length === 2) {
          const projectId = pathParts[1];
          // GET /project/{id}, PUT /project/{id}, DELETE /project/{id}
          if (method === 'GET') {
            const response = await getProject(projectId, env);
            return addCorsHeaders(response, corsHeaders);
          } else if (method === 'PUT') {
            const response = await updateProject(projectId, request, env);
            return addCorsHeaders(response, corsHeaders);
          } else if (method === 'DELETE') {
            const response = await deleteProject(projectId, env);
            return addCorsHeaders(response, corsHeaders);
          }
        }
      }

      // Model Config routes
      if (pathParts[0] === 'model-config') {
        if (pathParts.length === 1) {
          // GET /model-config or POST /model-config
          if (method === 'GET') {
            const providerId = url.searchParams.get('provider_id');
            const status = url.searchParams.get('status');
            const response = await listModelConfigs(providerId, status, env);
            return addCorsHeaders(response, corsHeaders);
          } else if (method === 'POST') {
            const response = await createModelConfig(request, env);
            return addCorsHeaders(response, corsHeaders);
          }
        } else if (pathParts.length === 2) {
          const id = pathParts[1];
          // GET /model-config/{id}, PUT /model-config/{id}, DELETE /model-config/{id}
          if (method === 'GET') {
            const response = await getModelConfig(id, env);
            return addCorsHeaders(response, corsHeaders);
          } else if (method === 'PUT') {
            const response = await updateModelConfig(id, request, env);
            return addCorsHeaders(response, corsHeaders);
          } else if (method === 'DELETE') {
            const response = await deleteModelConfig(id, env);
            return addCorsHeaders(response, corsHeaders);
          }
        }
      }

      // Provider Key routes
      if (pathParts[0] === 'provider-key') {
        if (pathParts.length === 1) {
          // POST /provider-key
          if (method === 'POST') {
            const response = await storeProviderKey(request, env);
            return addCorsHeaders(response, corsHeaders);
          }
        } else if (pathParts.length === 2) {
          const instanceId = pathParts[1];
          // GET /provider-key/{instance_id} - list all providers
          if (method === 'GET') {
            const response = await listProviderKeys(instanceId, env);
            return addCorsHeaders(response, corsHeaders);
          }
        } else if (pathParts.length === 3) {
          const instanceId = pathParts[1];
          const provider = pathParts[2];
          // GET /provider-key/{instance_id}/{provider} - check status
          if (method === 'GET') {
            const response = await getProviderKeyStatus(instanceId, provider, env);
            return addCorsHeaders(response, corsHeaders);
          }
          // DELETE /provider-key/{instance_id}/{provider}
          if (method === 'DELETE') {
            const response = await deleteProviderKey(instanceId, provider, env);
            return addCorsHeaders(response, corsHeaders);
          }
        }
      }

      // Dev Credentials routes
      if (pathParts[0] === 'dev-credentials') {
        if (pathParts.length === 1) {
          // GET /dev-credentials - list all credentials
          if (method === 'GET') {
            const response = await listDevCredentials(request, env);
            return addCorsHeaders(response, corsHeaders);
          }
          // POST /dev-credentials - store credential
          if (method === 'POST') {
            const response = await storeDevCredential(request, env);
            return addCorsHeaders(response, corsHeaders);
          }
        } else if (pathParts.length === 2) {
          const credentialType = pathParts[1];
          // GET /dev-credentials/{type} - get credential value
          if (method === 'GET') {
            const response = await getDevCredential(credentialType, request, env);
            return addCorsHeaders(response, corsHeaders);
          }
          // DELETE /dev-credentials/{type} - delete credential
          if (method === 'DELETE') {
            const response = await deleteDevCredential(credentialType, request, env);
            return addCorsHeaders(response, corsHeaders);
          }
        }
      }

      // OAuth routes
      if (pathParts[0] === 'oauth') {
        if (pathParts.length === 2 && pathParts[1] === 'claude') {
          // POST /oauth/claude - store credentials
          if (method === 'POST') {
            const response = await storeOAuthCredentials(request, env);
            return addCorsHeaders(response, corsHeaders);
          }
          // GET /oauth/claude - get credentials (internal)
          if (method === 'GET') {
            const response = await getOAuthCredentials(request, env);
            return addCorsHeaders(response, corsHeaders);
          }
          // DELETE /oauth/claude - delete credentials
          if (method === 'DELETE') {
            const response = await deleteOAuthCredentials(request, env);
            return addCorsHeaders(response, corsHeaders);
          }
        } else if (pathParts.length === 3 && pathParts[1] === 'claude' && pathParts[2] === 'status') {
          // GET /oauth/claude/status - get status
          if (method === 'GET') {
            const response = await getOAuthStatus(request, env);
            return addCorsHeaders(response, corsHeaders);
          }
        } else if (pathParts.length === 3 && pathParts[1] === 'claude' && pathParts[2] === 'refresh') {
          // POST /oauth/claude/refresh - auto-refresh tokens
          if (method === 'POST') {
            const response = await refreshOAuthCredentials(request, env);
            return addCorsHeaders(response, corsHeaders);
          }
        }
      }

      // Activity Feed routes
      if (pathParts[0] === 'activity') {
        if (pathParts.length === 1) {
          // GET /activity - get activity feed
          if (method === 'GET') {
            const response = await getActivityFeed(request, env);
            return addCorsHeaders(response, corsHeaders);
          }
        } else if (pathParts.length === 2 && pathParts[1] === 'read') {
          // POST /activity/read - mark items as read
          if (method === 'POST') {
            const response = await markActivityRead(request, env);
            return addCorsHeaders(response, corsHeaders);
          }
        }
      }

      // Events routes
      if (pathParts[0] === 'events') {
        if (pathParts.length === 1) {
          // POST /events - track new event
          if (method === 'POST') {
            const response = await trackEvent(request, env, ctx);
            return addCorsHeaders(response, corsHeaders);
          }
        } else if (pathParts.length === 2 && pathParts[1] === 'stats') {
          // GET /events/stats - get event statistics
          if (method === 'GET') {
            const response = await getEventStats(request, env);
            return addCorsHeaders(response, corsHeaders);
          }
        } else if (pathParts.length === 2 && pathParts[1] === 'subscriptions') {
          // GET /events/subscriptions - list subscriptions
          if (method === 'GET') {
            const response = await listEventSubscriptions(request, env);
            return addCorsHeaders(response, corsHeaders);
          }
          // POST /events/subscriptions - create subscription
          if (method === 'POST') {
            const response = await createEventSubscription(request, env);
            return addCorsHeaders(response, corsHeaders);
          }
        } else if (pathParts.length === 3 && pathParts[1] === 'subscriptions') {
          const subscriptionId = pathParts[2];
          // PUT /events/subscriptions/{id} - update subscription
          if (method === 'PUT') {
            const response = await updateEventSubscription(subscriptionId, request, env);
            return addCorsHeaders(response, corsHeaders);
          }
          // DELETE /events/subscriptions/{id} - delete subscription
          if (method === 'DELETE') {
            const response = await deleteEventSubscription(subscriptionId, env);
            return addCorsHeaders(response, corsHeaders);
          }
        } else if (pathParts.length === 3) {
          // GET /events/{eventable_type}/{eventable_id} - get events for entity
          const eventableType = pathParts[1];
          const eventableId = pathParts[2];
          if (method === 'GET') {
            const response = await getEventsForEntity(eventableType, eventableId, request, env);
            return addCorsHeaders(response, corsHeaders);
          }
        }
      }

      // Route not found
      const response = errorResponse('Route not found', 404);
      return addCorsHeaders(response, corsHeaders);
    } catch (error) {
      console.error('Unhandled error:', error);
      const response = errorResponse(
        'Internal server error',
        500
      );
      return addCorsHeaders(response, corsHeaders);
    }
  },
};

/**
 * Add CORS headers to a response
 */
function addCorsHeaders(response: Response, corsHeaders: Record<string, string>): Response {
  const newHeaders = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([key, value]) => {
    newHeaders.set(key, value);
  });
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}
