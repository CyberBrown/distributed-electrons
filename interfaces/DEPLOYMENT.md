# Interface Deployment Guide

This guide covers deploying all three Team 4 interfaces to Cloudflare Pages.

## Prerequisites

- Wrangler CLI installed: `npm install -g wrangler`
- Cloudflare account with Pages enabled
- Authenticated with Wrangler: `wrangler login`

## Deployment Scripts

### Quick Deploy All Interfaces

```bash
# From repository root
cd interfaces
./deploy-all.sh
```

### Individual Deployments

#### 1. Testing GUI

```bash
cd interfaces/testing-gui

# Deploy to Pages (static site, no build needed)
wrangler pages deploy public --project-name=testing-gui

# Production deployment
wrangler pages deploy public --project-name=testing-gui --branch=main

# Development deployment
wrangler pages deploy public --project-name=testing-gui --branch=development
```

**Expected URL**: `https://testing-gui.pages.dev`

---

#### 2. Admin Panel

```bash
cd interfaces/admin-panel

# Install dependencies (if not already done)
npm install

# Build the React app
npm run build

# Deploy built files
wrangler pages deploy dist --project-name=admin-panel

# Production deployment
wrangler pages deploy dist --project-name=admin-panel --branch=main
```

**Expected URL**: `https://admin-panel.pages.dev`

---

#### 3. Monitoring Dashboard

```bash
cd interfaces/monitoring

# Install dependencies (if not already done)
npm install

# Build the React app
npm run build

# Deploy built files
wrangler pages deploy dist --project-name=monitoring-dashboard

# Production deployment
wrangler pages deploy dist --project-name=monitoring-dashboard --branch=main
```

**Expected URL**: `https://monitoring-dashboard.pages.dev`

---

## Configuration After Deployment

### Update API Endpoints

Once Teams 1 & 2 have deployed their workers, update the following:

#### Testing GUI

Edit `interfaces/testing-gui/public/app.js`:

```javascript
// Update base URL (line ~200)
const baseUrl = state.useMockApi
    ? 'http://localhost:3002/api/mock/image-gen'
    : `https://image-gen-${formData.instanceId}.YOUR_ACCOUNT.workers.dev`;
```

Replace `YOUR_ACCOUNT` with your actual Cloudflare account subdomain.

#### Admin Panel

Edit `interfaces/admin-panel/src/services/api.js`:

```javascript
// Update base URL (line ~5)
constructor() {
    this.baseUrl = 'https://config-service.YOUR_ACCOUNT.workers.dev'
}
```

#### Monitoring Dashboard

Edit `interfaces/monitoring/src/services/api.js`:

```javascript
// Update API endpoint (line ~30)
const response = await fetch(
    `https://config-service.YOUR_ACCOUNT.workers.dev/api/metrics?instance_id=${instanceId}&timeframe=${timeRange}`,
    // ...
)
```

### Redeploy After Configuration

After updating URLs, rebuild and redeploy:

```bash
# Admin Panel
cd interfaces/admin-panel
npm run build
wrangler pages deploy dist --project-name=admin-panel

# Monitoring Dashboard
cd interfaces/monitoring
npm run build
wrangler pages deploy dist --project-name=monitoring-dashboard

# Testing GUI (no build needed)
cd interfaces/testing-gui
wrangler pages deploy public --project-name=testing-gui
```

---

## Environment Variables (Optional)

You can configure environment variables in Cloudflare Pages dashboard:

1. Go to Cloudflare Dashboard → Pages
2. Select your project
3. Go to Settings → Environment Variables
4. Add variables:
   - `CONFIG_SERVICE_URL`
   - `IMAGE_GEN_URL_BASE`
   - `USE_MOCK_API` (true/false)

Then reference in code:

```javascript
const apiUrl = process.env.CONFIG_SERVICE_URL || 'fallback-url'
```

---

## Custom Domains (Optional)

To use custom domains:

1. Go to Cloudflare Pages → Your Project → Custom Domains
2. Add domain (e.g., `testing.yourdomain.com`)
3. Cloudflare will automatically provision SSL

---

## Verification Checklist

After deployment, verify each interface:

### Testing GUI
- [ ] Loads without errors
- [ ] Can enter form data
- [ ] Mock API mode works
- [ ] Console shows no errors
- [ ] Responsive on mobile

### Admin Panel
- [ ] Login page loads
- [ ] Can log in (mock mode)
- [ ] All pages accessible
- [ ] Tables display (mock data)
- [ ] Forms work

### Monitoring Dashboard
- [ ] Dashboard loads
- [ ] Stats cards display
- [ ] Charts render
- [ ] Controls work
- [ ] Auto-refresh functions

---

## Troubleshooting

### Build Failures

**Issue**: `npm run build` fails

**Solution**:
```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
npm run build
```

### Pages Deployment Fails

**Issue**: `wrangler pages deploy` fails

**Solution**:
```bash
# Re-authenticate
wrangler logout
wrangler login

# Try deployment again
wrangler pages deploy dist --project-name=YOUR_PROJECT
```

### 404 on Routes (React Apps)

**Issue**: Direct navigation to routes returns 404

**Solution**: Configure Pages with `_redirects` file:

```bash
# Create _redirects in dist/ before deployment
echo "/* /index.html 200" > dist/_redirects

# Then deploy
wrangler pages deploy dist --project-name=admin-panel
```

### CORS Errors

**Issue**: Browser console shows CORS errors

**Solution**: Workers need to include CORS headers. Check with Teams 1 & 2:

```javascript
// In worker response
response.headers.set('Access-Control-Allow-Origin', 'https://testing-gui.pages.dev')
response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
```

---

## Continuous Deployment

### GitHub Actions (Optional)

Create `.github/workflows/deploy-interfaces.yml`:

```yaml
name: Deploy Interfaces

on:
  push:
    branches: [main]
    paths:
      - 'interfaces/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'

      # Deploy Testing GUI
      - name: Deploy Testing GUI
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy interfaces/testing-gui/public --project-name=testing-gui

      # Build and Deploy Admin Panel
      - name: Build Admin Panel
        working-directory: interfaces/admin-panel
        run: |
          npm install
          npm run build

      - name: Deploy Admin Panel
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy interfaces/admin-panel/dist --project-name=admin-panel

      # Build and Deploy Monitoring Dashboard
      - name: Build Monitoring Dashboard
        working-directory: interfaces/monitoring
        run: |
          npm install
          npm run build

      - name: Deploy Monitoring Dashboard
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy interfaces/monitoring/dist --project-name=monitoring-dashboard
```

---

## Production Readiness

Before going to production:

1. **Switch to Production APIs**
   - Update all `USE_MOCK = false`
   - Update all API URLs to production workers

2. **Security Headers**
   - Verify CSP headers
   - Check CORS configuration
   - Ensure HTTPS only

3. **Performance**
   - Run Lighthouse audit
   - Optimize images
   - Enable caching headers

4. **Monitoring**
   - Set up Cloudflare Analytics
   - Configure error tracking
   - Monitor Pages metrics

---

## Deployed URLs

After deployment, update these in documentation:

- Testing GUI: `https://testing-gui.pages.dev`
- Admin Panel: `https://admin-panel.pages.dev`
- Monitoring Dashboard: `https://monitoring-dashboard.pages.dev`

**Next Steps**: See [UAT_CHECKLIST.md](./UAT_CHECKLIST.md) for testing procedures.

---

**Team 4 - Interface Team**
**Status**: Deployment configurations ready ✅
