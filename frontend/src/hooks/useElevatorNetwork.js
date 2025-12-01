// src/hooks/useElevatorNetwork.js
import { useEffect, useRef, useState } from "react";
import { Client } from "@stomp/stompjs";
import SockJS from "sockjs-client";

// 백엔드로 보낼 주기 (ms) - 0.1초마다 전송
const SEND_INTERVAL = 100;

// [수정] 두 번째 인자로 onCommandReceived(콜백 함수)를 받습니다.
export function useElevatorNetwork(elevatorState, onCommandReceived) {
  const [isConnected, setIsConnected] = useState(false);
  const [lastResponse, setLastResponse] = useState(null);
  const clientRef = useRef(null);
  
  // 콜백 함수가 바뀌어도 useEffect가 불필요하게 돌지 않도록 Ref에 저장
  const onCommandRef = useRef(onCommandReceived);
  
  useEffect(() => {
    // Connect through nginx proxy (http://localhost/ws) when in Docker
    // For local development, use backend directly (http://localhost:8088/ws)
    const wsUrl = process.env.NODE_ENV === 'production'
      ? "http://localhost/ws"
      : "http://localhost:8088/ws";

    const socket = new SockJS(wsUrl);
    const client = new Client({
      webSocketFactory: () => socket,
      reconnectDelay: 5000,
      onConnect: () => {
        console.log("✅ Backend Connected!");
        setIsConnected(true);

        // Subscribe to sensor data responses from backend
        client.subscribe("/topic/sensor-response", (message) => {
          try {
            const response = JSON.parse(message.body);
            console.log("📥 Received analysis:", response);
            setLastResponse(response);

            // Log danger level with appropriate styling
            if (response.dangerLevel === "CRITICAL") {
              console.error("🚨 CRITICAL:", response.analysisMessage);
            } else if (response.dangerLevel === "WATCH") {
              console.warn("⚠️ WATCH:", response.analysisMessage);
            } else {
              console.log("✓", response.analysisMessage);
            }
          } catch (err) {
            console.error("Failed to parse response:", err);
          }
        });
      },
      onStompError: (frame) => {
        console.error("❌ STOMP Error", frame);
      },
      onWebSocketClose: () => {
        console.log("⚠️ Connection Closed");
        setIsConnected(false);
      },
    });

    client.activate();
    clientRef.current = client;

    return () => {
      client.deactivate();
    };
  }, []);

  // 2. 데이터 전송 (기존과 동일)
  useEffect(() => {
    if (!isConnected || !clientRef.current) return;

    const intervalId = setInterval(() => {
      const payload = {
        elevatorId: "E1",
        currentFloor: elevatorState.currentFloor,
        realtimeFloor: parseFloat(elevatorState.realtimeFloor.toFixed(2)),
        speed: parseFloat(elevatorState.speedFloorsPerSec.toFixed(2)),
        doorStatus: elevatorState.doorState.toUpperCase(),
        direction: elevatorState.direction.toUpperCase(),
        isOverloaded: elevatorState.isOverload,
        isJammed: elevatorState.hasJammedOnboard,
        timestamp: new Date().toISOString(),
      };

      try {
        clientRef.current.publish({
          destination: "/app/sensor-data",
          body: JSON.stringify(payload),
        });
      } catch (err) {
        console.error("Publish Error:", err);
      }
    }, SEND_INTERVAL);

    return () => clearInterval(intervalId);
  }, [isConnected, elevatorState]);

  return { isConnected, lastResponse };
}