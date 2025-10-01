# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

WAHA (WhatsApp HTTP API) is a NestJS-based REST API that provides HTTP endpoints for WhatsApp messaging. The project supports multiple WhatsApp engines (WEBJS, NOWEB, GOWS) and can be deployed as either a Core (free) or Plus (premium) version.

## Development Commands

### Initial Setup
```bash
# Install dependencies
yarn install

# Fetch and compile proto files (required for GOWS engine)
yarn gows:proto

# Run in development mode with hot reload
yarn start:dev

# Run in production mode
yarn start:prod
```

### Building and Testing
```bash
# Build the project
yarn build

# Run tests
yarn test

# Run tests in watch mode
yarn test:watch

# Run e2e tests
yarn test:e2e

# Check test coverage
yarn test:cov
```

### Linting and Formatting
```bash
# Lint code (uses oxlint)
yarn lint

# Lint and auto-fix issues
yarn lint-fix

# Format code (uses prettier)
yarn format
```

### Docker Commands
```bash
# Build different variants
make build          # Core version
make build-plus     # Plus version
make build-chrome   # Chrome browser variant
make build-noweb    # NOWEB engine (no browser)
make build-gows     # GOWS engine (Go WhatsApp Server)
```

### Update Dependencies
```bash
# Update NOWEB engine (Baileys)
make up-noweb

# Update WEBJS engine
make up-webjs

# Update libsignal dependency
make up-noweb-libsignal
```

## Architecture

### Core Structure

- **Entry Point**: `src/main.ts` - Bootstraps the NestJS application with Pino logging, WebSocket support, and dynamic module loading based on version (Core vs Plus)
- **Module System**: `src/core/app.module.core.ts` - Main NestJS module with all imports, controllers, and providers
- **Path Aliases**: Uses `@waha/*` alias mapping to `./src/*` (configured in tsconfig.json)

### WhatsApp Engines

Three engine implementations in `src/core/engines/`:
- **WEBJS** (`webjs/`) - Uses puppeteer with whatsapp-web.js library
- **NOWEB** (`noweb/`) - Uses @adiwajshing/baileys (no browser required)
- **GOWS** (`gows/`) - Go-based WhatsApp server with gRPC/protobuf communication

Default engine is set via `WHATSAPP_DEFAULT_ENGINE` environment variable.

### Key Components

- **Session Management** (`src/core/manager.core.ts`): Manages WhatsApp session lifecycle
- **Storage Layer** (`src/core/storage/`): Abstracts session storage with interfaces for auth, config, and worker repositories. Supports local, PostgreSQL, and MongoDB backends
- **Media Storage** (`src/core/media/`): Handles file storage with support for local filesystem, S3, and PostgreSQL
- **Apps/Integrations** (`src/apps/`): Extensible app system including ChatWoot integration
- **API Controllers** (`src/api/`): REST endpoints for sessions, chatting, groups, contacts, etc.
- **DTOs/Structures** (`src/structures/`): Request/response DTOs and webhook definitions

### Configuration

Environment configuration via `.env` file (see `.env.example`):
- API authentication (WAHA_API_KEY, dashboard/swagger credentials)
- Engine selection (WHATSAPP_DEFAULT_ENGINE)
- Media storage backend (WAHA_MEDIA_STORAGE: LOCAL/S3/POSTGRESQL)
- Session storage backend (PostgreSQL/MongoDB URLs)
- Webhooks, proxy, logging settings

### Dependencies

**Core Libraries**:
- Uses forked versions of key libraries: `@adiwajshing/baileys` (fork-master-2025-09-21), `whatsapp-web.js` (fork-main-2025-09-10)
- NestJS v11 with modules for Bull queues, Redis, Swagger, WebSockets
- Database: better-sqlite3, knex, pg, mongodb
- Media: sharp, puppeteer, file-type

**Key Resolutions**: Project enforces specific versions via yarn resolutions for libsignal, axios, puppeteer, and ws.

### Testing

- Test files use `.test.ts` extension
- Tests located in `src/` alongside source files (e.g., `src/apps/chatwoot/text.test.ts`)
- E2E tests in `tests/` directory with separate jest config
- Run single test: `yarn test <test-file-pattern>`

## Development Notes

- **Node Version**: Uses Node 22+ (see `.nvmrc`)
- **Package Manager**: Yarn 3.6.3 with Plug'n'Play (see `.yarnrc.yml`)
- **Pre-commit**: Uses pre-commit hooks (`.pre-commit-config.yaml`)
- **Logging**: Structured logging with Pino. Format controlled by `WAHA_LOG_FORMAT` (JSON/PRETTY), level by `WAHA_LOG_LEVEL`
- **Swagger**: API documentation available at `/api` when enabled
- **Dashboard**: Web UI at `/dashboard` when enabled (requires authentication)
- **Port**: Default port is 3000, configurable via `WHATSAPP_API_PORT`

## Common Workflows

### Adding a New API Endpoint
1. Define DTOs in `src/structures/<domain>.dto.ts`
2. Create/update controller in `src/api/<domain>.controller.ts`
3. Add business logic to engine implementation or session manager
4. Register controller in `CONTROLLERS` array in `app.module.core.ts`

### Adding a New WhatsApp Engine
1. Create engine directory in `src/core/engines/<engine-name>/`
2. Implement engine interface with required methods
3. Add engine config service in `src/core/config/`
4. Update engine selection logic in session manager

### Working with Proto Files (GOWS)
- Proto files are fetched and compiled via `scripts/gows-proto.js`
- Run `yarn gows:proto:fetch` to download proto definitions
- Run `yarn gows:proto:build` to compile them to TypeScript
