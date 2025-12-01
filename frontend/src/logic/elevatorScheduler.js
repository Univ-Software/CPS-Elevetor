// src/logic/elevatorScheduler.js

/**
 * LOOK 알고리즘 (실시간 위치 기반)
 * - currentPos(실수)를 기준으로 위/아래를 판단합니다.
 * - 이미 지나친 층은 진행 방향의 큐가 끝난 뒤(회차)에 배치합니다.
 */
export function buildQueueWithLook({ prevQueue, newFloors, currentPos, direction }) {
  // 1. 중복 제거 및 층 목록 합치기
  const floorSet = new Set([...prevQueue, ...newFloors]);
  const floors = Array.from(floorSet);

  if (floors.length === 0) return [];

  // 오차 범위 (지나쳤는지 판단용)
  const buffer = 0.05; 

  // 2. 현재 실시간 위치(currentPos)를 기준으로 그룹 나누기
  // above: 내 위치보다 확실히 위에 있는 층들 (오름차순 1->5)
  const above = floors
    .filter((f) => f > currentPos + buffer)
    .sort((a, b) => a - b);

  // below: 내 위치보다 확실히 아래에 있는 층들 (내림차순 5->1)
  const below = floors
    .filter((f) => f < currentPos - buffer)
    .sort((a, b) => b - a);

  // here: 지금 딱 걸쳐있는 층 (거의 도착)
  const here = floors.filter((f) => f >= currentPos - buffer && f <= currentPos + buffer);

  // 3. 방향에 따른 우선순위 조합
  if (direction === "up") {
    // [현재위치] -> [더 위로 쭉] -> [아래로 훑기]
    return [...here, ...above, ...below];
  } else if (direction === "down") {
    // [현재위치] -> [더 아래로 쭉] -> [위로 훑기]
    return [...here, ...below, ...above];
  } else {
    // 대기(idle) 중일 땐 가장 가까운 층으로
    if (above.length === 0) return [...here, ...below];
    if (below.length === 0) return [...here, ...above];

    const distUp = Math.abs(above[0] - currentPos);
    const distDown = Math.abs(below[0] - currentPos);

    if (distUp <= distDown) {
      return [...here, ...above, ...below];
    } else {
      return [...here, ...below, ...above];
    }
  }
}