# Cloudflare Multi-Agent System

> **Status**: 🚀 MVP Development - Multi-Agent Autonomous Build
> **Timeline**: 4-6 hours automated deployment
> **Budget**: $1000 Claude Code credits

## Overview

Migration of 120-agent JS workflow to Cloudflare Workers infrastructure, creating a generic, flexible, and portable multi-agent platform that can be consumed by any authenticated application.

### Key Features

- **Hierarchical Instance Management**: Organization → Instance → Project
- **Provider-Agnostic**: Extensible framework for multiple AI providers
- **Dynamic Model Configuration**: Admin-managed AI models without code changes
- **Unified Payload Mapping**: Single interface across all providers and models
- **Autonomous Development**: 4 Team Leaders managing 16 agents building in parallel
- **Production-Ready**: Rate limiting, error handling, monitoring, CI/CD

## Architecture

```
Organization (e.g., Acme Corp.)
  └── Instance (like a VM - "production", "staging")
      ├── API Keys (shared across projects)
      ├── Rate Limits (shared pool)
      ├── Workers (dedicated deployments)
      └── Projects (logical groupings)
```

## Model Configuration System

The Model Configuration System enables flexible, admin-managed AI model configurations without requiring code changes.

### Features

- **Centralized Management**: All model configs stored in D1 database
- **Admin UI**: Manage models through Admin Panel's Models page
- **Provider Agnostic**: Support any AI provider (OpenAI, Ideogram, Gemini, etc.)
- **Dynamic Payload Mapping**: Template-based transformation of inputs to provider formats
- **Capability Tracking**: Mark models for image, video, text, audio generation
- **Pricing & Rate Limits**: Built-in metadata for billing and throttling
- **Lifecycle Management**: Active, Beta, Deprecated status tracking

### How It Works

1. **Admin Configuration**: Create model config in Admin Panel
   ```json
   {
     "model_id": "ideogram-v2",
     "provider_id": "ideogram",
     "capabilities": {"image": true},
     "payload_mapping": {
       "endpoint": "/generate",
       "headers": {"Api-Key": "{api_key}"},
       "body": {"prompt": "{user_prompt}"}
     }
   }
   ```

2. **User Selection**: User selects model in Testing GUI dropdown

3. **Dynamic Mapping**: Worker fetches config and transforms request
   ```typescript
   const config = await getModelConfig(modelId);
   const request = applyPayloadMapping(config.payload_mapping, userInputs, apiKey);
   ```

4. **Provider Execution**: Formatted request sent to provider API

### Supported Providers

- **Ideogram**: V2, V2 Turbo
- **OpenAI**: DALL-E 3, DALL-E 2
- **Gemini**: Veo 3.1 (video), 2.5 Flash Image, Imagen 3
- **Anthropic**: Claude 3.5 Sonnet (text)
- **Extensible**: Add new providers via Admin Panel

### Documentation

- [Admin Guide](./docs/MODEL_CONFIG_ADMIN_GUIDE.md) - How to add/edit model configs
- [User Guide](./docs/MODEL_CONFIG_USER_GUIDE.md) - How to use models in Testing GUI
- [API Documentation](./docs/MODEL_CONFIG_API.md) - Programmatic access
- [Payload Mapping Spec](./docs/PAYLOAD_MAPPING_SPEC.md) - Template syntax details
- [Database Schema](./docs/MODEL_CONFIG_SCHEMA.md) - Schema documentation

## MVP Scope

### In Scope
- Config Service (D1 database + worker)
- Model Configuration System (admin-managed models)
- Image Generation Worker (Ideogram provider)
- Rate Limiting (Durable Objects)
- R2 Storage Integration
- Authentication & Authorization
- Deployment Automation (GitHub Actions)
- Testing GUI & Admin Interface

### Out of Scope (Future)
- Advanced billing/usage tiers
- Multi-tenancy (single org for MVP)
- Real-time streaming generation
- Image editing/inpainting

## Multi-Agent Development Structure

```
Project Manager (Human)
├── Team Leader 1: Infrastructure (Phase 1 - Sequential)
│   ├── Agent 1.1: Database Schema
│   ├── Agent 1.2: Config Service Worker
│   ├── Agent 1.3: Authentication Middleware
│   └── Agent 1.4: Instance Lookup Logic
├── Team Leaders 2 & 3: Workers + Ops (Phase 2 - Parallel)
│   ├── Team 2: Worker Implementation
│   │   ├── Agent 2.1: Provider Adapter Framework
│   │   ├── Agent 2.2: Rate Limiter (Durable Objects)
│   │   ├── Agent 2.3: R2 Storage Manager
│   │   └── Agent 2.4: Image Generation Worker
│   └── Team 3: Operations
│       ├── Agent 3.1: Error Handling & Retries
│       ├── Agent 3.2: Logging System
│       ├── Agent 3.3: Deployment Scripts
│       └── Agent 3.4: GitHub Actions CI/CD
└── Team Leader 4: Interfaces (Phase 3 - Sequential)
    ├── Agent 4.1: Testing GUI
    ├── Agent 4.2: Admin Interface
    ├── Agent 4.3: Documentation
    └── Agent 4.4: Monitoring Dashboard
```

## Quick Start

### Prerequisites
- Node.js 18+
- Cloudflare account
- Wrangler CLI (`npm install -g wrangler`)

### Setup

```bash
# Clone repository
git clone https://github.com/CyberBrown/cloudflare-multiagent-system.git
cd cloudflare-multiagent-system

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your Cloudflare credentials

# Deploy infrastructure
npm run deploy-instance -- --config instances/production.json
```

## Project Structure

```
/
├── docs/                    # Documentation and specifications
│   └── specs/              # Shared specs for all agents
├── infrastructure/          # Core infrastructure components
│   ├── database/           # D1 schema and migrations
│   ├── config-service/     # Central config management
│   ├── auth/               # Authentication middleware
│   └── lookup/             # Instance resolution
├── workers/                 # Cloudflare Workers
│   ├── shared/             # Shared utilities
│   │   ├── provider-adapters/
│   │   ├── rate-limiter/
│   │   ├── r2-manager/
│   │   ├── error-handling/
│   │   └── logging/
│   └── image-gen/          # Image generation worker
├── interfaces/              # User-facing interfaces
│   ├── testing-gui/        # Testing interface
│   ├── admin-panel/        # Instance management
│   └── monitoring/         # Dashboard
├── scripts/                 # Deployment automation
├── tests/                   # Test suites
└── prompts/                 # Multi-agent prompts
```

## Development

### Running Tests
```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # With coverage
```

### Deploying Workers
```bash
npm run wrangler:dev    # Local development
npm run wrangler:deploy # Deploy to Cloudflare
```

### Managing Instances
```bash
npm run deploy-instance -- --config config.json
npm run deploy-all      # Deploy all instances
```

## Monitoring Progress

Track multi-agent development:

```bash
# Watch git commits from all agents
git log --all --oneline --graph

# Count completed agents
git log --all --grep="\[AGENT.*complete" | wc -l

# Check for escalations
git log --all --grep="ESCALATION"
```

## Technical Stack

- **Compute**: Cloudflare Workers
- **Database**: D1 (SQLite)
- **Storage**: R2
- **Cache**: KV
- **State**: Durable Objects
- **CI/CD**: GitHub Actions
- **Language**: TypeScript
- **Testing**: Vitest

## Success Criteria

- ✅ Config Service deployed and responding
- ✅ Model Configuration System operational
- ✅ Image Gen Worker functional with multiple providers
- ✅ Dynamic payload mapping working
- ✅ Rate limiting operational
- ✅ Testing GUI accessible with model selection
- ✅ Admin panel functional with Models page
- ✅ 2 instances deployed (production + development)
- ✅ All tests passing
- ✅ CI/CD pipeline working

## License

MIT

## Contributing

This project is built autonomously by AI agents. Human oversight for:
- Final approval before production merge
- Architectural decisions
- Credential management
- Monitoring and incident response

### Adding New Workers/Services

When creating a new worker or service:
1. **Add it to the Admin Panel Services page** - See `interfaces/admin-panel/ADDING_SERVICES.md`
2. **Follow the PR template** - Complete the "New Service Checklist"
3. **Document your API** - Include endpoints, examples, and usage instructions
4. **Create a Testing GUI** (if user-facing) - Make it easy for others to try your service

This ensures all services are discoverable and properly documented for the team.

---

**Built with Claude Code** | **Powered by Cloudflare Workers** | **Autonomous Multi-Agent Development**
