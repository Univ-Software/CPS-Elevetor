// src/pages/Dashboard.jsx
import "./Dashboard.css"

function Dashboard() {
  return (
    <div className="Dashboard">
      <header>
        <h1>엘베 시뮬</h1>

        <div>
          <h2>엘리베이터 상태</h2>
          <p>현재 층: 3 / 상태: UP</p>
        </div>

        <div>
          <p>여기에 층 버튼, 제어 패널, 로그 등 엘리베이터 UI 넣으면 됩니다.</p>
        </div>
      </header>

      <footer>© 2025 CPS Elevator System</footer>
    </div>
  )
}

export default Dashboard
