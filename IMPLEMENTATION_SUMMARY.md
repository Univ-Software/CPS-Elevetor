# Sensor Data Processing System - Implementation Summary

## Overview
Implemented a complete backend system for parsing, analyzing, saving, and resending elevator sensor data with multi-level logging capabilities.

## Architecture Flow

```
Frontend (React)
    ↓ [WebSocket: /app/sensor-data]
Nginx Proxy (/ws)
    ↓
Backend (Spring Boot)
    ├─ Parse Request (DTO)
    ├─ Analyze Data (Danger Level Classification)
    ├─ Save to Database (PostgreSQL)
    ├─ Log with Level (LOW, NORMAL, WATCH, CRITICAL)
    └─ Send Response (/topic/sensor-response)
         ↓
Frontend receives analyzed data
```

## Components Implemented

### 1. DTOs (Data Transfer Objects)
- **`SensorDataRequest.java`**: Receives sensor data from frontend
  - Fields: elevatorId, currentFloor, realtimeFloor, speed, doorStatus, direction, isOverloaded, isJammed, timestamp
- **`SensorDataResponse.java`**: Sends analyzed data back to frontend
  - Includes: dangerLevel, analysisMessage, processedTimestamp

### 2. Entity Layer
- **`SensorData.java`**: Database entity for PostgreSQL storage
  - Auto-generated ID, timestamps, danger level, analysis results
  - Table: `sensor_data`

### 3. Repository Layer
- **`SensorDataRepository.java`**: JPA repository interface
  - Query methods: by elevator ID, danger level, timestamp range, latest N records

### 4. Service Layer

#### Logging Service
- **`DangerLevel.java`**: Enum for danger levels (LOW, NORMAL, WATCH, CRITICAL)
- **`ElevatorLoggerService.java`**: Multi-level logging service
  - Outputs formatted logs to backend console
  - Different log levels: DEBUG (LOW), INFO (NORMAL), WARN (WATCH), ERROR (CRITICAL)

#### Analysis Service
- **`SensorAnalysisService.java`**: Intelligent analysis engine
  - **CRITICAL conditions**:
    - Door jammed
    - Elevator overloaded
    - Severe position misalignment (>0.35 floors when idle)
  - **WATCH conditions**:
    - Position misalignment (>0.15 floors when idle)
    - High speed (>2.0 floors/second)
    - Door open during movement
  - **NORMAL**: Active operation with no issues
  - **LOW**: Idle state with all parameters normal

### 5. Controller Layer

#### WebSocket Controller
- **`SensorDataController.java`**: Main processing pipeline
  - Receives: `/app/sensor-data`
  - Sends: `/topic/sensor-response`
  - Flow: Validate → Parse → Analyze → Save → Log → Respond

#### REST API Controller
- **`SensorDataRestController.java`**: Query interface for saved data
  - Endpoints:
    - `GET /api/sensor-data` - Get all records
    - `GET /api/sensor-data/elevator/{id}` - Get by elevator ID
    - `GET /api/sensor-data/elevator/{id}/latest?limit=10` - Get latest N records
    - `GET /api/sensor-data/danger-level/{level}` - Get by danger level
    - `GET /api/sensor-data/stats/danger-level/{level}/count` - Count by level
    - `GET /api/sensor-data/{id}` - Get by record ID

### 6. Configuration
- **`WebSocketConfig.java`**: STOMP over WebSocket configuration
  - Endpoint: `/ws`
  - Application prefix: `/app`
  - Broker prefix: `/topic`
  - SockJS fallback enabled

### 7. Frontend Updates
- **`useElevatorNetwork.js`**: Enhanced WebSocket hook
  - Connects to nginx-proxied WebSocket endpoint
  - Subscribes to `/topic/sensor-response`
  - Logs received analysis with appropriate styling
  - Returns `lastResponse` state

### 8. Nginx Configuration
- Added dedicated WebSocket location block (`/ws`)
- Extended timeouts for long-lived WebSocket connections (3600s)
- Proper upgrade headers for WebSocket protocol

## Database Schema

```sql
CREATE TABLE sensor_data (
    id BIGSERIAL PRIMARY KEY,
    elevator_id VARCHAR(50) NOT NULL,
    current_floor INTEGER,
    realtime_floor DOUBLE PRECISION,
    speed DOUBLE PRECISION,
    door_status VARCHAR(20),
    direction VARCHAR(10),
    is_overloaded BOOLEAN,
    is_jammed BOOLEAN,
    danger_level VARCHAR(20),
    analysis_message VARCHAR(500),
    received_timestamp TIMESTAMP,
    processed_timestamp TIMESTAMP
);
```

## Usage

### Starting the System

```bash
# Build and start all services
docker compose up --build

# Or start without rebuild
docker compose up
```

### Testing WebSocket Connection

1. Open frontend: http://localhost
2. Check browser console for:
   - "✅ Backend Connected!"
   - "📥 Received analysis: {...}"
   - Danger level indicators

### Viewing Backend Logs

```bash
# View backend logs with danger levels
docker compose logs -f backend

# You'll see logs like:
# [LOW] Elevator[E1] | Floor: 1 (1.00) | ...
# [NORMAL] Elevator[E1] | Floor: 2 (1.85) | ...
# [WATCH] ⚠️ Elevator[E1] | Position misalignment detected...
# [CRITICAL] 🚨 Elevator[E1] | DOOR JAMMED...
```

### Querying Saved Data

```bash
# Get all sensor data
curl http://localhost/api/sensor-data

# Get data for elevator E1
curl http://localhost/api/sensor-data/elevator/E1

# Get latest 5 records
curl http://localhost/api/sensor-data/elevator/E1/latest?limit=5

# Get critical alerts
curl http://localhost/api/sensor-data/danger-level/CRITICAL

# Count watch-level events
curl http://localhost/api/sensor-data/stats/danger-level/WATCH/count
```

## Danger Level Classification Logic

| Condition | Danger Level | Log Type |
|-----------|--------------|----------|
| Door jammed | CRITICAL | ERROR 🚨 |
| Overloaded | CRITICAL | ERROR 🚨 |
| Severe misalignment (>0.35 floors) | CRITICAL | ERROR 🚨 |
| Misalignment (>0.15 floors) | WATCH | WARN ⚠️ |
| High speed (>2.0 f/s) | WATCH | WARN ⚠️ |
| Door open during movement | WATCH | WARN ⚠️ |
| Active operation, no issues | NORMAL | INFO |
| Idle, all normal | LOW | DEBUG |

## Files Created

### Backend
- `backend/src/main/java/com/cps/dto/SensorDataRequest.java`
- `backend/src/main/java/com/cps/dto/SensorDataResponse.java`
- `backend/src/main/java/com/cps/domain/SensorData.java`
- `backend/src/main/java/com/cps/repository/SensorDataRepository.java`
- `backend/src/main/java/com/cps/service/DangerLevel.java`
- `backend/src/main/java/com/cps/service/ElevatorLoggerService.java`
- `backend/src/main/java/com/cps/service/SensorAnalysisService.java`
- `backend/src/main/java/com/cps/config/WebSocketConfig.java`
- `backend/src/main/java/com/cps/controller/SensorDataController.java`
- `backend/src/main/java/com/cps/controller/SensorDataRestController.java`

### Frontend
- Modified: `frontend/src/hooks/useElevatorNetwork.js`

### Configuration
- Modified: `nginx/nginx.conf`

## Next Steps

1. **Test the complete flow**: Run `docker compose up --build`
2. **Monitor logs**: Watch backend logs for danger level classifications
3. **Query database**: Use REST API endpoints to verify data persistence
4. **Add visualization**: Create frontend components to display danger levels
5. **Add alerts**: Implement real-time alerts for CRITICAL events
6. **Add metrics**: Dashboard for danger level statistics

## Notes

- Frontend sends data every 100ms (configurable in `SEND_INTERVAL`)
- Database auto-creates schema on startup (JPA `ddl-auto: update`)
- WebSocket connection auto-reconnects after 5 seconds if disconnected
- All timestamps are stored in LocalDateTime format
- Danger level thresholds can be adjusted in `SensorAnalysisService.java`
