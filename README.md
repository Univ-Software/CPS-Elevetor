# CPS (Cyber-Physical-System) Project

A modular Docker-based Cyber-Physical-System built with Spring Boot backend, React-Vite frontend, PostgreSQL database, and Nginx reverse proxy.

## Architecture

```
Client (Port 80)
    ↓
Nginx Reverse Proxy (Port 80)
    ↓
    ├─→ /api/* → Spring Boot Backend (Port 8088)
    │              ↓
    │          PostgreSQL Database (Port 5432)
    │
    └─→ /* → React Frontend (Port 80)
```

## Project Structure

```
.
├── docker-compose.yml           # Docker Compose configuration
├── backend/                     # Spring Boot backend
│   ├── Dockerfile
│   ├── build.gradle
│   ├── settings.gradle
│   └── src/
│       └── main/
│           ├── java/com/cps/
│           │   └── CpsBackendApplication.java
│           └── resources/
│               └── application.yml
├── frontend/                    # React-Vite frontend
│   ├── Dockerfile
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   ├── nginx.conf
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── App.css
│       └── index.css
└── nginx/                       # Nginx reverse proxy
    ├── Dockerfile
    └── nginx.conf
```

## Technology Stack

- **Backend**: Spring Boot 3.2.0 + Java 17 + Gradle
- **Frontend**: React 18 + Vite 5
- **Database**: PostgreSQL 15
- **Reverse Proxy**: Nginx (Alpine)
- **Network**: Docker Compose with custom bridge network (app_cps_net)
- **Container Runtime**: Docker 28.4.0+

## Prerequisites

- Docker 28.4.0 or higher
- Docker Compose v2

## Quick Start

### 1. Clone and Navigate

```bash
cd /home/pray/바탕화면/Project/Univ-CPS-Module
```

### 2. Build and Run

```bash
docker compose up --build
```

### 3. Access the Application

- **Frontend**: http://localhost
- **Backend API**: http://localhost/api/health
- **Nginx Health**: http://localhost/nginx-health

### 4. Stop the Application

```bash
docker compose down
```

### 5. Clean Up (Remove volumes)

```bash
docker compose down -v
```

## Services

### 1. PostgreSQL Database (db)
- **Image**: postgres:15-alpine
- **Container Name**: cps_postgres
- **Internal Port**: 5432
- **Database**: cps_db
- **User**: cps_user
- **Password**: cps_password

### 2. Spring Boot Backend (backend)
- **Container Name**: cps_backend
- **Internal Port**: 8088
- **Endpoints**:
  - `GET /api/health` - Health check
  - `GET /api/status` - Status check

### 3. React Frontend (frontend)
- **Container Name**: cps_frontend
- **Internal Port**: 80
- **Build Tool**: Vite

### 4. Nginx Reverse Proxy (nginx)
- **Container Name**: cps_nginx
- **Exposed Port**: 80
- **Routes**:
  - `/api/*` → backend:8088
  - `/*` → frontend:80

## Network

All services are connected via a custom bridge network named `app_cps_net`. Only the Nginx service exposes port 80 to the host, providing a single entry point for all client connections.

## Development

### Backend Development

```bash
cd backend
./gradlew bootRun
```

### Frontend Development

```bash
cd frontend
npm install
npm run dev
```

## API Endpoints

### Health Check
```bash
curl http://localhost/api/health
```

### Status Check
```bash
curl http://localhost/api/status
```

## Database Connection

The backend connects to PostgreSQL using JDBC:

```
jdbc:postgresql://db:5432/cps_db
```

## Environment Variables

See `.env.example` for available configuration options.

## CPS (Cyber-Physical-System) Concepts

This modular architecture supports CPS principles:
- **Physical Layer**: Sensor/actuator integration (to be implemented)
- **Network Layer**: Docker networking with app_cps_net
- **Cyber Layer**: Backend processing and data management
- **Application Layer**: Frontend interface for monitoring and control

## License

MIT
