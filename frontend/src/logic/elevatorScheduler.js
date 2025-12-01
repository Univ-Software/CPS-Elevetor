// src/logic/elevatorScheduler.js

// LOOK 알고리즘: 진행 방향을 유지하며 요청 처리
export function buildQueueWithLook({ prevQueue, newFloors, currentFloor, direction }) {
  const stopsSet = new Set(prevQueue);
  newFloors.forEach((f) => {
    if (f !== currentFloor) {
      stopsSet.add(f);
    }
  });

  const stops = Array.from(stopsSet);
  if (stops.length === 0) return [];

  const above = stops.filter((f) => f > currentFloor).sort((a, b) => a - b);
  const below = stops.filter((f) => f < currentFloor).sort((a, b) => b - a);
  const here = stops.filter((f) => f === currentFloor);

  if (direction === "up") {
    return [...here, ...above, ...below];
  } else if (direction === "down") {
    return [...here, ...below, ...above];
  } else {
    // idle 상태일 때 가장 가까운 층으로 방향 결정
    if (above.length === 0) return [...here, ...below];
    if (below.length === 0) return [...here, ...above];

    const nearestUp = above[0] - currentFloor;
    const nearestDown = currentFloor - below[0];

    if (nearestUp <= nearestDown) {
      return [...here, ...above, ...below];
    } else {
      return [...here, ...below, ...above];
    }
  }
}