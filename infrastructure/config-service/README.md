# Config Service Worker

Central configuration service for managing instances, users, and projects in the multi-tenant system.

## Overview

The Config Service is a Cloudflare Worker that provides a RESTful API for managing:
- **Instances**: Multi-tenant instance configurations with API keys, rate limits, and worker URLs
- **Users**: User accounts and permissions within organizations
- **Projects**: Project configurations within instances

## API Endpoints

### Instances

- `GET /instance` - List all instances (optional: `?org_id={id}` to filter)
- `GET /instance/{id}` - Get instance by ID
- `POST /instance` - Create new instance
- `PUT /instance/{id}` - Update instance
- `DELETE /instance/{id}` - Delete instance

### Users

- `GET /user` - List all users (optional: `?org_id={id}` to filter)
- `GET /user/{id}` - Get user by ID
- `GET /user/email/{email}` - Get user by email
- `POST /user` - Create new user
- `PUT /user/{id}` - Update user
- `DELETE /user/{id}` - Delete user

### Projects

- `GET /project` - List all projects (optional: `?instance_id={id}` to filter)
- `GET /project/{id}` - Get project by ID
- `POST /project` - Create new project
- `PUT /project/{id}` - Update project
- `DELETE /project/{id}` - Delete project

### Health Check

- `GET /health` - Service health status

## Request/Response Format

### Success Response
```json
{
  "data": { ... },
  "request_id": "uuid"
}
```

### Error Response
```json
{
  "error": "Error message",
  "request_id": "uuid",
  "status": 404
}
```

## HTTP Status Codes

- `200` - Success
- `400` - Bad Request (invalid input)
- `403` - Forbidden (unauthorized access)
- `404` - Not Found
- `409` - Conflict (e.g., duplicate email)
- `500` - Internal Server Error (database errors)

## Example Usage

### Create an Instance
```bash
curl -X POST http://config-service/instance \
  -H "Content-Type: application/json" \
  -d '{
    "org_id": "org-123",
    "name": "production",
    "rate_limits": {
      "requests_per_minute": 100,
      "requests_per_day": 10000
    }
  }'
```

### Get an Instance
```bash
curl http://config-service/instance/inst-123
```

### Create a User
```bash
curl -X POST http://config-service/user \
  -H "Content-Type: application/json" \
  -d '{
    "org_id": "org-123",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "admin"
  }'
```

### Create a Project
```bash
curl -X POST http://config-service/project \
  -H "Content-Type: application/json" \
  -d '{
    "instance_id": "inst-123",
    "name": "My Project",
    "description": "Project description",
    "config": {
      "setting1": "value1"
    }
  }'
```

## Deployment

### Prerequisites
- Cloudflare account
- Wrangler CLI installed
- D1 database created

### Configuration

1. Create a D1 database:
```bash
wrangler d1 create multi_tenant_db
```

2. Update `wrangler.toml` with your database ID:
```toml
[[d1_databases]]
binding = "DB"
database_name = "multi_tenant_db"
database_id = "your-database-id"
```

3. Run migrations (from database service):
```bash
wrangler d1 execute multi_tenant_db --file=schema.sql
```

### Deploy

```bash
cd infrastructure/config-service
wrangler deploy
```

### Local Development

```bash
wrangler dev
```

## Testing

Unit tests and integration tests are located in `/tests/config-service/`.

Run tests:
```bash
npm test tests/config-service
```

## Architecture

```
config-service/
├── index.ts              # Main worker entry point with routing
├── types.ts              # TypeScript type definitions
├── utils.ts              # Utility functions
├── wrangler.toml         # Cloudflare Worker configuration
└── handlers/
    ├── instance-handlers.ts
    ├── user-handlers.ts
    └── project-handlers.ts
```

## Features

- **CORS Support**: Automatic CORS headers for cross-origin requests
- **Request Tracing**: Every response includes a unique `request_id` for debugging
- **Error Handling**: Consistent error responses with appropriate HTTP status codes
- **Input Validation**: Required field validation and type checking
- **JSON Parsing**: Safe JSON parsing with error handling
- **Database Integration**: D1 database binding for persistent storage

## Security Considerations

- API authentication should be added before production deployment
- Rate limiting should be implemented at the Cloudflare level
- Sensitive data should be encrypted before storage
- Consider implementing row-level security for multi-tenant isolation
