// src/hooks/useElevatorNetwork.js
import { useEffect, useRef, useState } from "react";
import { Client } from "@stomp/stompjs";
import SockJS from "sockjs-client";

const SEND_INTERVAL = 100; 

// [수정] 두 번째 인자로 onCommandReceived(콜백 함수)를 받습니다.
export function useElevatorNetwork(elevatorState, onCommandReceived) {
  const [isConnected, setIsConnected] = useState(false);
  const clientRef = useRef(null);
  
  // 콜백 함수가 바뀌어도 useEffect가 불필요하게 돌지 않도록 Ref에 저장
  const onCommandRef = useRef(onCommandReceived);
  
  useEffect(() => {
    onCommandRef.current = onCommandReceived;
  }, [onCommandReceived]);

  useEffect(() => {
    // 1. 소켓 연결
    const socket = new SockJS("http://localhost:8080/ws"); // 본인 백엔드 주소
    const client = new Client({
      webSocketFactory: () => socket,
      reconnectDelay: 5000,
      onConnect: () => {
        console.log("✅ Backend Connected!");
        setIsConnected(true);

        // ▼▼▼ [추가] 백엔드 명령 구독 (Subscribe) ▼▼▼
        client.subscribe("/topic/control", (message) => {
          if (onCommandRef.current) {
            try {
              const command = JSON.parse(message.body);
              console.log("📩 Command Received:", command);
              onCommandRef.current(command); // Dashboard로 명령 전달
            } catch (e) {
              console.error("JSON Parse Error:", e);
            }
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

  return { isConnected };
}