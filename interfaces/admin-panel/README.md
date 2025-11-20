# Admin Panel

React-based admin interface for managing the Cloudflare Multi-Agent System.

## Features

- **Instance Management**: Create, update, and delete worker instances
- **User Management**: Add users and assign instance access
- **API Key Generation**: Generate and revoke API keys
- **Log Viewer**: Filter and search system logs
- **Mock API Support**: Test interface without backend dependencies

## Tech Stack

- **React 18** - UI library
- **React Router 6** - Client-side routing
- **Tailwind CSS** - Styling
- **Vite** - Build tool
- **Cloudflare Pages** - Deployment

## Local Development

### Prerequisites
- Node.js 18+
- npm or yarn

### Installation

```bash
# Install dependencies
npm install
```

### Run Development Server

```bash
npm run dev
```

The app will be available at `http://localhost:3000`

## Building

```bash
npm run build
```

Build output will be in the `dist/` directory.

## Deployment

### Deploy to Cloudflare Pages

```bash
# Build and deploy
npm run deploy

# Or manually:
npm run build
wrangler pages deploy dist --project-name=admin-panel
```

### Cloudflare Pages Configuration

- **Build command**: `npm run build`
- **Output directory**: `dist`
- **Environment variables**: None required

## Features

### 1. Instances Page

Manage Cloudflare Worker instances:

- View all instances with status, rate limits, and metadata
- Create new instances with configuration
- Edit instance settings (rate limits, etc.)
- Delete instances (with confirmation)

### 2. Users Page

Manage users and API keys:

- View all users with roles and instance access
- Create new users with email and role
- Assign instances to users
- Generate API keys for users
- Revoke API keys
- View API key usage (last used timestamp)

### 3. Logs Page

View and filter system logs:

- Filter by instance, log level, and search text
- View timestamp, level, instance, message, and request ID
- Color-coded log levels (error, warn, info, debug)
- Real-time log viewing

## Authentication

Currently uses simple API key authentication:

- Admin API key stored in localStorage
- Mock mode accepts any non-empty key
- Production mode validates against backend

## Mock API Mode

The admin panel includes a comprehensive mock API for parallel development:

- **Mock Data**: Realistic sample instances, users, API keys, and logs
- **Mock Operations**: Full CRUD support with simulated delays
- **Toggle**: Set `USE_MOCK = false` in `src/services/api.js` to use real APIs

## File Structure

```
admin-panel/
├── public/              # Static assets
├── src/
│   ├── components/      # Reusable components
│   │   ├── Navbar.jsx
│   │   └── Footer.jsx
│   ├── pages/           # Page components
│   │   ├── Login.jsx
│   │   ├── Instances.jsx
│   │   ├── Users.jsx
│   │   └── Logs.jsx
│   ├── services/        # API service
│   │   └── api.js
│   ├── App.jsx          # Main app component
│   ├── main.jsx         # Entry point
│   └── index.css        # Global styles
├── index.html           # HTML template
├── vite.config.js       # Vite configuration
├── tailwind.config.js   # Tailwind configuration
└── package.json         # Dependencies and scripts
```

## API Integration

The admin panel expects the following API endpoints:

### Config Service
- `GET /api/instances` - List instances
- `POST /api/instances` - Create instance
- `PATCH /api/instances/:id` - Update instance
- `DELETE /api/instances/:id` - Delete instance
- `GET /api/users` - List users
- `POST /api/users` - Create user
- `GET /api/keys` - List API keys
- `POST /api/keys` - Generate API key
- `DELETE /api/keys/:id` - Revoke API key
- `GET /api/logs` - Query logs

See `/docs/specs/api-contracts.md` for full API specification.

## Styling

Uses Tailwind CSS with utility-first approach:

- Responsive design (mobile-first)
- Consistent color scheme (blue primary, gray neutrals)
- Hover states and transitions
- Loading states and spinners
- Modal dialogs for forms

## Security Considerations

- API keys stored in localStorage (client-side only)
- HTTPS enforced via Cloudflare Pages
- Input validation on all forms
- Confirmation dialogs for destructive actions
- No sensitive data in URLs or query parameters

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Mobile responsive

## Future Enhancements

- [ ] Dark mode
- [ ] Export logs to CSV
- [ ] Metrics dashboard integration
- [ ] Real-time log streaming
- [ ] User permissions management
- [ ] Instance health checks
- [ ] Bulk operations
- [ ] Advanced filtering

## Team 4 - Agent 4.2

This component was built by Agent 4.2 as part of the Team 4 Interface Team, led by Team Leader 4.

**Status**: ✅ Complete and ready for deployment
