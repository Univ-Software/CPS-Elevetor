# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a modular Docker-based Cyber-Physical-System (CPS) with Spring Boot backend, React-Vite frontend, PostgreSQL database, and Nginx reverse proxy. The architecture follows a three-tier pattern with a reverse proxy layer for routing.

## Common Commands

### Docker Operations (Primary workflow)

```bash
# Build and start all services
docker compose up --build

# Start services (without rebuild)
docker compose up

# Stop all services
docker compose down

# Stop and remove volumes (clean database)
docker compose down -v

# View logs for specific service
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f nginx
```

### Backend Development

```bash
# Build the backend
cd backend
./gradlew build

# Run backend locally (outside Docker)
./gradlew bootRun

# Run tests
./gradlew test

# Clean build artifacts
./gradlew clean
```

### Frontend Development

```bash
# Install dependencies
cd frontend
npm install

# Run dev server locally (port 5173)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

### Testing the Application

```bash
# Health check endpoints
curl http://localhost/api/health
curl http://localhost/api/status
curl http://localhost/nginx-health

# Access frontend
open http://localhost
```

## Architecture

### Request Flow

```
Client (Port 80)
    ↓
Nginx Reverse Proxy (cps_nginx)
    ├─→ /api/* → Spring Boot Backend (cps_backend:8088)
    │              ↓
    │          PostgreSQL (cps_postgres:5432)
    └─→ /* → React Frontend (cps_frontend:80)
```

### Network Architecture

- **Custom bridge network**: `app_cps_net` - all containers communicate via Docker DNS
- **Single entry point**: Only nginx exposes port 80 to host
- **Internal communication**: Backend connects to database via `db:5432`, nginx proxies to `backend:8088` and `frontend:80`
- **Dependency management**: Backend starts only after PostgreSQL health check passes

### Container Build Strategy

All services use **multi-stage Docker builds** for production optimization:

- **Backend**: Gradle build stage (JDK 17) → Runtime stage (JRE 17 Alpine)
- **Frontend**: Node build stage (npm ci + vite build) → Nginx static serving (Alpine)
- **Nginx**: Single-stage with custom configuration

### Database Configuration

- **Connection**: `jdbc:postgresql://db:5432/cps_db`
- **Credentials**: `cps_user` / `cps_password` (defined in docker-compose.yml)
- **JPA DDL mode**: `update` - schema auto-updates without dropping data
- **Volume**: `postgres_data` for persistence

## Key Configuration Files

### backend/src/main/resources/application.yml
Spring Boot configuration with environment variable substitution. Key settings:
- Database connection uses `${DB_HOST:db}`, `${DB_NAME:cps_db}`, `${DB_USER:cps_user}`
- JPA hibernate ddl-auto: update
- Server port: 8088
- SQL logging enabled in DEBUG mode

### nginx/nginx.conf
Reverse proxy routing configuration:
- Upstream definitions point to `backend:8088` and `frontend:80`
- Path-based routing: `/api/*` to backend, all else to frontend
- WebSocket upgrade support enabled for future CPS real-time communication
- Security headers: X-Frame-Options, X-Content-Type-Options, X-XSS-Protection
- Gzip compression for text/JSON responses
- 60s proxy timeouts

### frontend/nginx.conf
Static file server for built React app with SPA routing (`try_files` fallback to index.html)

### docker-compose.yml
Service orchestration with:
- 4 services: db, backend, frontend, nginx
- Health check on PostgreSQL (`pg_isready`) ensures backend waits for database
- Restart policy: `unless-stopped`
- Named volume for database persistence

## Code Organization

### Backend (Spring Boot)
- **Single application file**: `backend/src/main/java/com/cps/CpsBackendApplication.java`
- All REST endpoints, business logic in one file (current simple structure)
- Package: `com.cps.*`
- REST endpoints use `/api/*` prefix
- Health check endpoints: `/api/health`, `/api/status`

### Frontend (React)
- **Entry point**: `src/main.jsx` - React 18 with `createRoot`
- **Main component**: `src/App.jsx` - top-level application component
- **Styling**: Component-specific CSS (`App.css`) + global styles (`index.css`)
- **API calls**: Use Axios with relative paths (e.g., `/api/health`) - nginx proxies to backend
- Build output: `dist/` directory served by nginx in production

### Configuration Patterns
- Environment variables with defaults: `${VAR_NAME:default_value}` in application.yml
- No hardcoded secrets - credentials injected via docker-compose
- Docker Compose provides configuration layer

## CPS Architecture Layers

This project follows Cyber-Physical-System principles with four conceptual layers:

1. **Physical Layer**: Sensor/actuator integration (to be implemented - future work)
2. **Network Layer**: Docker networking (`app_cps_net`) represents the CPS communication fabric
3. **Cyber Layer**: Backend (Spring Boot) provides data processing and persistence
4. **Application Layer**: Frontend (React) provides monitoring and control interface

WebSocket support is pre-configured in nginx for future real-time sensor data streaming.

## Development Workflow

### Making Backend Changes
1. Edit Java files in `backend/src/main/java/com/cps/`
2. For Docker deployment: `docker compose up --build backend`
3. For local testing: `cd backend && ./gradlew bootRun`

### Making Frontend Changes
1. Edit React components in `frontend/src/`
2. For Docker deployment: `docker compose up --build frontend nginx`
3. For local development with hot-reload: `cd frontend && npm run dev` (port 5173)

### Database Schema Changes
- JPA entities auto-update schema (hibernate.ddl-auto=update)
- For clean state: `docker compose down -v` (removes volume)
- Database persists in named volume `postgres_data`

## Debugging

### View Container Logs
```bash
docker compose logs -f [service-name]
```

### Check Service Health
```bash
# Database health
docker compose exec db pg_isready -U cps_user -d cps_db

# Backend health
curl http://localhost/api/health

# Nginx configuration test
docker compose exec nginx nginx -t
```

### Access Container Shell
```bash
docker compose exec backend sh
docker compose exec frontend sh
docker compose exec db psql -U cps_user -d cps_db
```

### Common Issues
- **Backend can't connect to database**: Check if PostgreSQL health check is passing with `docker compose ps`
- **404 on /api/ routes**: Check nginx upstream configuration and backend service status
- **Frontend not updating**: Clear browser cache or rebuild with `docker compose up --build frontend`
- **Port 80 already in use**: Stop other services using port 80 or modify docker-compose.yml ports mapping

## File Locations

- **Backend application logic**: `backend/src/main/java/com/cps/CpsBackendApplication.java`
- **Backend config**: `backend/src/main/resources/application.yml`
- **Backend build**: `backend/build.gradle`
- **Frontend entry point**: `frontend/src/main.jsx`
- **Frontend main component**: `frontend/src/App.jsx`
- **Frontend build config**: `frontend/vite.config.js`, `frontend/package.json`
- **Nginx routing**: `nginx/nginx.conf`
- **Frontend static server**: `frontend/nginx.conf`
- **Service orchestration**: `docker-compose.yml` (root)
- **Environment template**: `.env.example` (root)
