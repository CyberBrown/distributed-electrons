# User Acceptance Testing Checklist

## Testing GUI

### Basic Functionality
- [ ] Can navigate to testing GUI
- [ ] Can enter API key
- [ ] API key is masked/hidden by default
- [ ] Can toggle API key visibility
- [ ] Can enter prompt (supports multi-line)
- [ ] Prompt character count updates in real-time
- [ ] Can select instance from dropdown
- [ ] Can select model (optional)
- [ ] Can expand advanced options
- [ ] Can select aspect ratio
- [ ] Can select style
- [ ] Generate button is clickable
- [ ] Generate button shows loading state during generation

### Image Generation
- [ ] Can generate image with valid inputs
- [ ] Loading spinner appears during generation
- [ ] Loading messages cycle during generation
- [ ] Image displays correctly when complete
- [ ] CDN URL is populated
- [ ] R2 path is displayed
- [ ] Metadata shows provider, model, dimensions, time
- [ ] Request ID is displayed
- [ ] Can click image to open in new tab

### Copy Functionality
- [ ] Can copy CDN URL to clipboard
- [ ] Copy button shows "Copied!" feedback
- [ ] Clipboard functionality works

### Error Handling
- [ ] Invalid API key shows 401 error
- [ ] Rate limit exceeded shows 429 with retry time
- [ ] Malformed request shows appropriate error
- [ ] Network errors display user-friendly message
- [ ] Error messages are clear and helpful
- [ ] Status messages auto-dismiss after 5 seconds

### Mock API Mode
- [ ] Mock API toggle exists
- [ ] Can switch between mock and production
- [ ] Mock mode generates placeholder images
- [ ] Mock mode simulates loading delays
- [ ] Mock errors work (10% failure rate)

### Responsive Design
- [ ] Works on mobile (375px)
- [ ] Works on tablet (768px)
- [ ] Works on desktop (1920px)
- [ ] No horizontal scrolling
- [ ] All buttons are touch-friendly
- [ ] Text is readable on all sizes

### Persistence
- [ ] API key saved to localStorage
- [ ] Instance ID saved to localStorage
- [ ] Settings persist across page reloads

---

## Admin Panel

### Authentication
- [ ] Can access login page
- [ ] Can enter admin API key
- [ ] Login validates non-empty key (mock mode)
- [ ] Login redirects to instances page
- [ ] Logout button visible in navbar
- [ ] Logout clears session and returns to login

### Navigation
- [ ] Navbar shows all menu items (Instances, Users, Logs)
- [ ] Active page highlighted in navbar
- [ ] Can navigate between all pages
- [ ] Navigation works on mobile

### Instances Page
- [ ] Can view all instances in table
- [ ] Table shows instance ID, name, status, rate limit
- [ ] Can click "Create Instance" button
- [ ] Create modal appears with form
- [ ] Form validates all required fields
- [ ] Can create new instance
- [ ] New instance appears in table
- [ ] Can click "Edit" on instance
- [ ] Edit modal shows current values
- [ ] Can update instance configuration
- [ ] Changes persist after save
- [ ] Can click "Delete" on instance
- [ ] Delete shows confirmation dialog
- [ ] Can cancel delete
- [ ] Delete removes instance from table
- [ ] Empty state shows when no instances
- [ ] Loading spinner shows while fetching data

### Users Page
- [ ] Users table displays all users
- [ ] Shows email, role, instances, created date
- [ ] Can click "Create User" button
- [ ] Create user modal appears
- [ ] Form validates email format
- [ ] Can select role (user/admin)
- [ ] Can enter comma-separated instances
- [ ] User creation succeeds
- [ ] New user appears in table
- [ ] Admin role badge styled differently

### API Keys Section
- [ ] API keys table displays all keys
- [ ] Shows name, key (masked), status, last used
- [ ] Can click "Generate API Key"
- [ ] Generate modal appears
- [ ] Can enter key name
- [ ] Can select user from dropdown
- [ ] Can select instance
- [ ] Can set expiration days
- [ ] Key generation succeeds
- [ ] Generated key shows in modal (one-time display)
- [ ] Warning about saving key appears
- [ ] Can copy key to clipboard
- [ ] Can click "Done" to close
- [ ] New key appears in table (masked)
- [ ] Can click "Revoke" on key
- [ ] Revoke shows confirmation
- [ ] Revoked key removed from table

### Logs Page
- [ ] Logs table displays log entries
- [ ] Shows timestamp, level, instance, message, request ID
- [ ] Can filter by instance
- [ ] Can filter by level (error, warn, info, debug)
- [ ] Can search logs by text
- [ ] Filters apply correctly
- [ ] Log levels color-coded
- [ ] Empty state shows when no logs match
- [ ] Loading spinner while fetching

### General UI
- [ ] All forms validate input
- [ ] Success messages display
- [ ] Error messages display
- [ ] Modals close on cancel
- [ ] Modals close on successful action
- [ ] Footer shows status indicator
- [ ] "Mock API Active" indicator visible
- [ ] Responsive on mobile
- [ ] All buttons have hover states
- [ ] Loading states work throughout

---

## Monitoring Dashboard

### Page Load
- [ ] Dashboard loads without errors
- [ ] Header displays correctly
- [ ] Stats cards display with correct values
- [ ] Charts render correctly
- [ ] Footer displays last updated time

### Stats Cards
- [ ] Total Requests shows number
- [ ] Avg Response Time shows milliseconds
- [ ] Error Rate shows percentage
- [ ] Rate Limit Hits shows count
- [ ] All cards have appropriate icons
- [ ] Cards are color-coded

### Controls
- [ ] Instance selector displays options (Production, Development, Staging)
- [ ] Can change instance selection
- [ ] Instance change triggers data reload
- [ ] Time range selector shows options (24h, 7d, 30d)
- [ ] Can change time range
- [ ] Time range change updates charts
- [ ] Auto-refresh toggle exists
- [ ] Auto-refresh is enabled by default
- [ ] Can disable auto-refresh
- [ ] Manual refresh button exists
- [ ] Manual refresh triggers data reload

### Charts
- [ ] Requests Over Time chart displays
- [ ] Line chart shows data points
- [ ] X-axis shows time labels
- [ ] Y-axis shows request counts
- [ ] Chart is responsive

- [ ] Error Rate chart displays
- [ ] Shows error trends over time
- [ ] Red color scheme for errors
- [ ] Chart responsive

- [ ] Rate Limit Hits chart displays
- [ ] Bar chart format
- [ ] Shows rate limit events
- [ ] Yellow/amber color scheme
- [ ] Chart responsive

- [ ] Provider Usage Distribution chart displays
- [ ] Pie chart format
- [ ] Shows provider breakdown
- [ ] Legend displays correctly
- [ ] Total requests shown below chart
- [ ] Colors distinct for each provider

### Auto-Refresh
- [ ] Auto-refresh enabled by default
- [ ] Data refreshes every 30 seconds
- [ ] Charts update smoothly
- [ ] No flickering during refresh
- [ ] Can disable auto-refresh
- [ ] Refresh stops when disabled
- [ ] Can re-enable auto-refresh

### Responsive Design
- [ ] Dashboard works on mobile
- [ ] Charts resize correctly
- [ ] Controls stack on mobile
- [ ] All text readable
- [ ] No horizontal scroll

### Data Display
- [ ] Mock data displays correctly
- [ ] Charts show realistic patterns
- [ ] No console errors
- [ ] Loading state shows on first load
- [ ] Empty states handled gracefully

---

## Cross-Cutting Concerns

### Performance
- [ ] All pages load in < 3 seconds
- [ ] No layout shift during load
- [ ] Images load progressively
- [ ] No memory leaks (check DevTools)
- [ ] Smooth animations

### Accessibility
- [ ] Keyboard navigation works
- [ ] Tab order is logical
- [ ] Focus indicators visible
- [ ] Form labels associated correctly
- [ ] Color contrast meets WCAG AA
- [ ] Screen reader friendly
- [ ] ARIA labels present

### Browser Compatibility
- [ ] Works in Chrome
- [ ] Works in Firefox
- [ ] Works in Safari
- [ ] Works in Edge
- [ ] Works in Mobile Chrome
- [ ] Works in Mobile Safari
- [ ] No console errors in any browser

### Security
- [ ] API keys not exposed in URLs
- [ ] API keys not logged to console
- [ ] localStorage used appropriately
- [ ] No XSS vulnerabilities
- [ ] HTTPS enforced (when deployed)
- [ ] CORS configured correctly

---

## Deployment Validation

### Testing GUI
- [ ] Deployed to Cloudflare Pages
- [ ] Accessible via public URL
- [ ] HTTPS enabled
- [ ] Static assets load correctly
- [ ] No 404 errors
- [ ] Favicon loads

### Admin Panel
- [ ] Deployed to Cloudflare Pages
- [ ] Accessible via public URL
- [ ] HTTPS enabled
- [ ] React app builds correctly
- [ ] All routes work
- [ ] No 404 on refresh

### Monitoring Dashboard
- [ ] Deployed to Cloudflare Pages
- [ ] Accessible via public URL
- [ ] HTTPS enabled
- [ ] Charts load correctly
- [ ] No build errors

---

## Integration Testing (with Real Backend)

### Testing GUI → Image Gen Worker
- [ ] Can generate real images
- [ ] Real provider API called
- [ ] Images stored in R2
- [ ] CDN URLs work
- [ ] Metadata accurate

### Admin Panel → Config Service
- [ ] CRUD operations work with D1
- [ ] Instance config persists
- [ ] Users created in database
- [ ] API keys stored encrypted
- [ ] Logs queried correctly

### Monitoring Dashboard → Metrics API
- [ ] Real metrics displayed
- [ ] D1 queries execute
- [ ] Chart data accurate
- [ ] Time ranges filter correctly

---

## Final Sign-Off

- [ ] All critical issues resolved
- [ ] All medium issues documented
- [ ] Low-priority issues logged for future
- [ ] Team Lead approval
- [ ] Ready for production use

**Tested By**: _______________
**Date**: _______________
**Approved By**: _______________
**Date**: _______________

---

**Status**: All interfaces tested and validated ✅
