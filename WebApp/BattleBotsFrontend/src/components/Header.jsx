import React from 'react';
import '../css/Header.css';

const Header = ({
  sensorData,
  onStartClick,
  onLeaderboardClick,
  onCameraClick,
  onDebugClick,
  theme,
  onToggleTheme,
}) => {
  const { d1, m1, ir1, ir2, connected } = sensorData;

  return (
    <header className="header">
      <div className="header-left">
        <h1 className="header-title">Battle Bots</h1>
        <div className={`live-badge ${connected ? 'online' : 'offline'}`}>
          {connected ? 'Live' : 'Offline'}
        </div>
        <button type="button" className="start-battle-btn" onClick={onStartClick}>
          START BATTLE
        </button>
        <button type="button" className="leaderboard-btn" onClick={onLeaderboardClick}>
          LEADERBOARD
        </button>
        <button type="button" className="camera-feed-btn" onClick={onCameraClick}>
          CAMERA FEED
        </button>
        <button type="button" className="debug-btn" onClick={onDebugClick}>
          DEBUG
        </button>
        <button type="button" className="theme-toggle-btn" onClick={onToggleTheme}>
          {theme === 'dark' ? '☀️ LIGHT' : '🌙 DARK'}
        </button>
      </div>

      <div className="sensor-strip">
        <div className="sensor-item">
          <span className="sensor-label">Piezo:</span>
          <span className="sensor-value">{d1}</span>
        </div>
        <div className="sensor-item">
          <span className="sensor-label">MPU:</span>
          <span className="sensor-value">{m1}</span>
        </div>
        <div className="sensor-item">
          <span className="sensor-label">IR Left:</span>
          <div className={`ir-indicator ${ir1 === 1 ? 'alert' : ''}`}></div>
        </div>
        <div className="sensor-item">
          <span className="sensor-label">IR Right:</span>
          <div className={`ir-indicator ${ir2 === 1 ? 'alert' : ''}`}></div>
        </div>
      </div>
    </header>
  );
};

export default Header;