# Elevator Control System - Frontend-Backend API Documentation

This document describes the WebSocket-based communication interface between the React Frontend and Spring Boot Backend for the Cyber-Physical Elevator Control System.

---

## 1. Connection Details

### WebSocket Configuration

- **WebSocket URL**: `ws://localhost:8088/ws`
  - For Docker deployments via nginx: `ws://localhost/api/ws`
- **Protocol**: STOMP over WebSocket
- **Connection Library**: Use a STOMP client library (e.g., `@stomp/stompjs` for JavaScript/React)

### STOMP Configuration

| Configuration | Value | Description |
|--------------|-------|-------------|
| **WebSocket Endpoint** | `/ws` | Initial connection endpoint |
| **Application Destination Prefix** | `/app` | Prefix for client→server messages |
| **Broker Prefix** | `/topic` | Prefix for server→client broadcasts |

### Connection Example (JavaScript/React)

```javascript
import { Client } from '@stomp/stompjs';

const client = new Client({
  brokerURL: 'ws://localhost:8088/ws',
  reconnectDelay: 5000,
  onConnect: () => {
    console.log('Connected to WebSocket');
    // Subscribe to topics here
  },
  onStompError: (frame) => {
    console.error('STOMP error:', frame);
  }
});

client.activate();
```

---

## 2. Data Flow - The CPS Control Loop

The elevator system follows a continuous **Sense-Think-Act** cycle:

```
┌─────────────────────────────────────────────────────────────┐
│                    CPS CONTROL LOOP                          │
└─────────────────────────────────────────────────────────────┘

Step 1: SENSE (Frontend → Backend)
   Frontend reports current elevator status via /app/status-report
   ├─ Current floor position
   ├─ Door status (OPEN/CLOSED/OPENING/CLOSING)
   ├─ Obstruction detection (safety)
   ├─ Passenger count
   └─ Current direction (UP/DOWN/IDLE)

                    ↓

Step 2: THINK (Backend Processing)
   Backend processes status through LOOK Algorithm (ElevatorScheduler)
   ├─ Evaluates pending hall calls (buttons pressed outside)
   ├─ Evaluates pending car calls (buttons pressed inside)
   ├─ Applies LOOK scheduling algorithm (optimized elevator movement)
   └─ Generates optimal control command

                    ↓

Step 3: ACT (Backend → Frontend)
   Backend broadcasts control command via /topic/control
   ├─ Motor control: MOTOR_UP, MOTOR_DOWN, STOP
   ├─ Door control: OPEN, CLOSE
   ├─ Wait state: WAIT
   └─ Frontend actuates elevator hardware accordingly

                    ↓ (Loop continues)

AUXILIARY EVENTS:
   - Button Presses: /app/press-button → Adds requests to scheduler
   - Emergency Stop: /app/emergency-stop → Clears all pending requests
   - State Query: /app/get-state → Returns current scheduler state
```

---

## 3. API Endpoints & JSON Payloads

### 3.1 Status Reporting (Primary Control Loop)

**Destination**: `/app/status-report`  
**Direction**: Frontend → Backend  
**Response Topic**: `/topic/control`  
**Response Direction**: Backend → Frontend (broadcast)

#### Frontend Sends (ElevatorStatus):

```json
{
  "currentFloor": 3,
  "doorStatus": "CLOSED",
  "isObstructed": false,
  "passengerCount": 2,
  "direction": "UP"
}
```

**Field Descriptions**:
- `currentFloor` (integer): Current floor number (e.g., 1, 2, 3...)
- `doorStatus` (string): Door state - `"OPEN"`, `"CLOSED"`, `"OPENING"`, `"CLOSING"`
- `isObstructed` (boolean): Door obstruction sensor (true = blocked, false = clear)
- `passengerCount` (integer): Number of passengers detected in elevator
- `direction` (string): Current movement direction - `"UP"`, `"DOWN"`, `"IDLE"`

#### Backend Responds (ControlCommand):

The backend broadcasts a `ControlCommand` to all subscribers of `/topic/control`.

```json
{
  "commandType": "MOTOR_UP",
  "message": "Moving up to floor 5"
}
```

**Field Descriptions**:
- `commandType` (string): Command to execute
  - `"MOTOR_UP"` - Activate motor to move elevator upward
  - `"MOTOR_DOWN"` - Activate motor to move elevator downward
  - `"STOP"` - Stop motor (reached target floor)
  - `"OPEN"` - Open doors
  - `"CLOSE"` - Close doors
  - `"WAIT"` - Hold position (idle state)
- `message` (string): Human-readable explanation of the command

#### Usage Example (JavaScript/React):

```javascript
// Send status to backend
client.publish({
  destination: '/app/status-report',
  body: JSON.stringify({
    currentFloor: 3,
    doorStatus: 'CLOSED',
    isObstructed: false,
    passengerCount: 2,
    direction: 'UP'
  })
});

// Subscribe to receive control commands
client.subscribe('/topic/control', (message) => {
  const command = JSON.parse(message.body);
  console.log('Received command:', command.commandType);
  // Execute command on elevator hardware
  executeCommand(command.commandType);
});
```

---

### 3.2 Button Press Events

**Destination**: `/app/press-button`  
**Direction**: Frontend → Backend  
**Response Topic**: `/topic/button-ack`  
**Response Direction**: Backend → Frontend (broadcast)

#### Scenario A: Hall Call (Button Pressed Outside Elevator)

**Frontend Sends**:
```json
{
  "floor": 5,
  "type": "HALL_CALL",
  "direction": "UP"
}
```

**Field Descriptions**:
- `floor` (integer): Floor number where button was pressed
- `type` (string): `"HALL_CALL"` - button pressed outside elevator
- `direction` (string): Desired direction - `"UP"` or `"DOWN"`

**Backend Responds**:
```json
{
  "success": true,
  "message": "Hall call registered for floor 5 going UP",
  "floor": 5,
  "type": "HALL_CALL"
}
```

#### Scenario B: Car Call (Button Pressed Inside Elevator)

**Frontend Sends**:
```json
{
  "floor": 7,
  "type": "CAR_CALL"
}
```

**Field Descriptions**:
- `floor` (integer): Destination floor selected inside elevator
- `type` (string): `"CAR_CALL"` - button pressed inside elevator
- `direction`: Not required for car calls

**Backend Responds**:
```json
{
  "success": true,
  "message": "Car call registered for floor 7",
  "floor": 7,
  "type": "CAR_CALL"
}
```

#### Usage Example:

```javascript
// Hall call (outside elevator) - User on floor 5 wants to go UP
client.publish({
  destination: '/app/press-button',
  body: JSON.stringify({
    floor: 5,
    type: 'HALL_CALL',
    direction: 'UP'
  })
});

// Car call (inside elevator) - Passenger wants to go to floor 7
client.publish({
  destination: '/app/press-button',
  body: JSON.stringify({
    floor: 7,
    type: 'CAR_CALL'
  })
});

// Subscribe to acknowledgments
client.subscribe('/topic/button-ack', (message) => {
  const ack = JSON.parse(message.body);
  if (ack.success) {
    console.log('Button registered:', ack.message);
    // Update UI to show button is active
  }
});
```

---

### 3.3 Emergency Stop

**Destination**: `/app/emergency-stop`  
**Direction**: Frontend → Backend  
**Response Topic**: `/topic/emergency`  
**Response Direction**: Backend → Frontend (broadcast)

#### Frontend Sends:

No payload required - simply send to the destination.

#### Backend Responds:

```json
{
  "success": true,
  "message": "Emergency stop activated - all requests cleared",
  "timestamp": 1700000000000
}
```

**Field Descriptions**:
- `success` (boolean): Always `true` for emergency stop
- `message` (string): Confirmation message
- `timestamp` (long): Unix timestamp in milliseconds

#### Usage Example:

```javascript
// Trigger emergency stop
client.publish({
  destination: '/app/emergency-stop',
  body: JSON.stringify({})  // Empty payload
});

// Subscribe to emergency notifications
client.subscribe('/topic/emergency', (message) => {
  const emergency = JSON.parse(message.body);
  console.error('EMERGENCY STOP:', emergency.message);
  // Update UI to show emergency state
  // Halt all elevator operations
  stopAllMotors();
  displayEmergencyAlert();
});
```

---

### 3.4 State Query (Monitoring/Debugging)

**Destination**: `/app/get-state`  
**Direction**: Frontend → Backend  
**Response Topic**: `/topic/state`  
**Response Direction**: Backend → Frontend (broadcast)

#### Frontend Sends:

No payload required - simply send to the destination.

#### Backend Responds:

```json
{
  "currentFloor": 4,
  "currentDirection": "UP",
  "timestamp": 1700000000000
}
```

**Field Descriptions**:
- `currentFloor` (integer): Floor tracked by backend scheduler
- `currentDirection` (string): Direction tracked by backend - `"UP"`, `"DOWN"`, `"IDLE"`
- `timestamp` (long): Unix timestamp in milliseconds

#### Usage Example:

```javascript
// Request current state
client.publish({
  destination: '/app/get-state',
  body: JSON.stringify({})
});

// Subscribe to state updates
client.subscribe('/topic/state', (message) => {
  const state = JSON.parse(message.body);
  console.log('Backend state:', state);
  // Use for debugging or synchronization
});
```

---

## 4. Complete Integration Example

### React Frontend Component Example

```javascript
import { useEffect, useState } from 'react';
import { Client } from '@stomp/stompjs';

function ElevatorControl() {
  const [client, setClient] = useState(null);
  const [currentFloor, setCurrentFloor] = useState(1);
  const [doorStatus, setDoorStatus] = useState('CLOSED');
  const [command, setCommand] = useState(null);

  useEffect(() => {
    // Initialize STOMP client
    const stompClient = new Client({
      brokerURL: 'ws://localhost:8088/ws',
      reconnectDelay: 5000,
      onConnect: () => {
        console.log('Connected to elevator control system');

        // Subscribe to control commands
        stompClient.subscribe('/topic/control', (message) => {
          const cmd = JSON.parse(message.body);
          setCommand(cmd);
          console.log('Received command:', cmd.commandType);
          executeCommand(cmd.commandType);
        });

        // Subscribe to button acknowledgments
        stompClient.subscribe('/topic/button-ack', (message) => {
          const ack = JSON.parse(message.body);
          console.log('Button acknowledged:', ack.message);
        });

        // Subscribe to emergency notifications
        stompClient.subscribe('/topic/emergency', (message) => {
          const emergency = JSON.parse(message.body);
          alert('EMERGENCY STOP: ' + emergency.message);
        });

        // Start status reporting loop
        startStatusReporting(stompClient);
      },
      onStompError: (frame) => {
        console.error('STOMP error:', frame);
      }
    });

    stompClient.activate();
    setClient(stompClient);

    return () => {
      stompClient.deactivate();
    };
  }, []);

  function startStatusReporting(client) {
    // Send status every 1 second
    setInterval(() => {
      client.publish({
        destination: '/app/status-report',
        body: JSON.stringify({
          currentFloor: currentFloor,
          doorStatus: doorStatus,
          isObstructed: false,
          passengerCount: 0,
          direction: 'IDLE'
        })
      });
    }, 1000);
  }

  function executeCommand(commandType) {
    // Simulate hardware actuation
    switch (commandType) {
      case 'MOTOR_UP':
        setCurrentFloor(f => f + 1);
        break;
      case 'MOTOR_DOWN':
        setCurrentFloor(f => f - 1);
        break;
      case 'OPEN':
        setDoorStatus('OPEN');
        break;
      case 'CLOSE':
        setDoorStatus('CLOSED');
        break;
      case 'STOP':
        console.log('Motor stopped');
        break;
      case 'WAIT':
        console.log('Waiting...');
        break;
    }
  }

  function pressFloorButton(floor) {
    if (client) {
      client.publish({
        destination: '/app/press-button',
        body: JSON.stringify({
          floor: floor,
          type: 'CAR_CALL'
        })
      });
    }
  }

  function emergencyStop() {
    if (client) {
      client.publish({
        destination: '/app/emergency-stop',
        body: JSON.stringify({})
      });
    }
  }

  return (
    <div>
      <h1>Elevator Control Panel</h1>
      <p>Current Floor: {currentFloor}</p>
      <p>Door Status: {doorStatus}</p>
      <p>Last Command: {command?.commandType}</p>
      
      <div>
        {[1, 2, 3, 4, 5].map(floor => (
          <button key={floor} onClick={() => pressFloorButton(floor)}>
            Floor {floor}
          </button>
        ))}
      </div>
      
      <button onClick={emergencyStop} style={{ background: 'red' }}>
        EMERGENCY STOP
      </button>
    </div>
  );
}

export default ElevatorControl;
```

---

## 5. Error Handling

### Connection Errors

- **Reconnection**: STOMP client should be configured with automatic reconnection (e.g., `reconnectDelay: 5000`)
- **Heartbeat**: Configure heartbeats to detect disconnections early

### Invalid Payloads

If the frontend sends invalid data (e.g., wrong types, missing required fields), the backend will:
- Log an error
- Return an error response in the acknowledgment topic
- Continue operating (non-blocking)

Example error response:
```json
{
  "success": false,
  "message": "Error processing button press: Unknown button type: INVALID_TYPE"
}
```

---

## 6. Security Considerations

### Current Configuration (Development)

- **CORS**: All origins allowed (`setAllowedOrigins("*")`)
- **Authentication**: None

### Production Recommendations

1. **Restrict Origins**: Update `WebSocketConfig.java` to allow only specific origins
   ```java
   registry.addEndpoint("/ws")
           .setAllowedOrigins("https://yourdomain.com");
   ```

2. **Add Authentication**: Implement token-based authentication
   - Use JWT tokens in WebSocket handshake
   - Validate tokens in STOMP interceptors

3. **Use WSS**: Enable TLS/SSL for WebSocket connections (`wss://`)

---

## 7. Performance Considerations

### Status Reporting Frequency

- **Recommended**: 500ms - 1000ms intervals
- **Trade-off**: Faster = more responsive, but higher network/CPU load

### Message Size

- Keep payloads minimal (both DTOs are already optimized)
- Avoid sending unnecessary data

### Connection Pooling

- STOMP supports multiple subscriptions over a single WebSocket connection
- Reuse the same client instance for all operations

---

## 8. Testing

### Manual Testing with Browser Console

```javascript
// In browser console (after loading page with STOMP library)
const client = new StompJs.Client({
  brokerURL: 'ws://localhost:8088/ws',
  onConnect: () => {
    console.log('Connected');
    
    // Subscribe to control commands
    client.subscribe('/topic/control', (msg) => {
      console.log('Command:', JSON.parse(msg.body));
    });
    
    // Send status report
    client.publish({
      destination: '/app/status-report',
      body: JSON.stringify({
        currentFloor: 1,
        doorStatus: 'CLOSED',
        isObstructed: false,
        passengerCount: 0,
        direction: 'IDLE'
      })
    });
  }
});
client.activate();
```

### Backend Logs

Monitor backend logs to see incoming messages:
```bash
docker compose logs -f backend
```

Expected log output:
```
INFO  c.c.c.ElevatorSocketController - Received status report: Floor=1, Direction=IDLE, Door=CLOSED, Obstructed=false, Passengers=0
INFO  c.c.c.ElevatorSocketController - Sending control command: WAIT - No pending requests
```

---

## 9. LOOK Algorithm Behavior

The backend uses the **LOOK elevator scheduling algorithm**:

1. **Directional Sweep**: Elevator continues in current direction until no more requests
2. **Request Prioritization**:
   - Services all requests in current direction
   - Reverses direction only when current direction has no pending requests
3. **Idle Behavior**: Stays at current floor when no requests pending (command: `WAIT`)

This algorithm minimizes average waiting time and is commonly used in real elevator systems.

---

## 10. Quick Reference

| Operation | Frontend Action | Backend Response |
|-----------|----------------|------------------|
| **Report Status** | `POST /app/status-report` | Broadcast to `/topic/control` |
| **Press Floor (Inside)** | `POST /app/press-button` (CAR_CALL) | Acknowledge to `/topic/button-ack` |
| **Press Floor (Outside)** | `POST /app/press-button` (HALL_CALL) | Acknowledge to `/topic/button-ack` |
| **Emergency Stop** | `POST /app/emergency-stop` | Broadcast to `/topic/emergency` |
| **Query State** | `POST /app/get-state` | Respond to `/topic/state` |

---

## Appendix: Dependencies

### Frontend (React)
```bash
npm install @stomp/stompjs
```

### Backend (Spring Boot)
Already configured in `build.gradle`:
- `spring-boot-starter-websocket`
- `spring-boot-starter-messaging`

---

**Document Version**: 1.0  
**Last Updated**: 2025-11-26  
**Maintained By**: CPS-Elevator Development Team
