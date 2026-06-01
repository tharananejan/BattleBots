import React, { useState, useEffect } from 'react';
import '../css/LaunchScreen.css';

const LaunchScreen = ({ onClose, onLaunch }) => {
  const [tankName, setTankName] = useState('');
  const [rangeName, setRangeName] = useState('');
  const [tankMode, setTankMode] = useState('Auto');
  const [countdown, setCountdown] = useState(null);

  useEffect(() => {
    if (countdown === null) return;

    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }

    const timer = setTimeout(() => {
      onLaunch({ tankName, rangeName, tankMode });
    }, 1000);
    return () => clearTimeout(timer);
  }, [countdown, onLaunch, tankName, rangeName, tankMode]);

  const handleStart = (e) => {
    e.preventDefault();
    if (!tankName.trim() || !rangeName.trim()) return;
    setCountdown(3);
  };

  const isGo = countdown === 0;

  const staticAvatar = 'https://robohash.org/battle-bot?set=set3';

  return (
    <div className="launch-overlay" role="dialog" aria-modal="true" aria-labelledby="launch-title">
      <div className="launch-backdrop" onClick={countdown === null ? onClose : undefined} />

      {countdown !== null ? (
        <div className={`countdown-stage ${isGo ? 'countdown-go' : ''}`}>
          <div className="countdown-backdrop-grid" />
          <div className="countdown-glow-effect" />
          <div className="countdown-ring" />
          <div className="countdown-inner-ring" />
          <h1 className="countdown-text">{countdown > 0 ? countdown : 'GO!'}</h1>
          <div className="countdown-telemetry">
            <div className="tel-line"><span className="tel-check">✔</span> BOTS DETECTED</div>
            <div className="tel-line"><span className="tel-check">✔</span> SYSTEMS READY</div>
            <div className="tel-line"><span className="tel-check">✔</span> GAME CONNECTION OK</div>
            <div className="tel-line blinking"><span className="tel-warn">▲</span> PREPARING BATTLE...</div>
          </div>
        </div>
      ) : (
        <div className="launch-modal">
          <button type="button" className="launch-close" onClick={onClose} aria-label="Close">
            ×
          </button>

          <div className="launch-modal-header">
            <span className="launch-tag">SYS // GAME SETUP</span>
            <h2 id="launch-title" className="launch-title">
              BATTLE SETTINGS
            </h2>
            <p className="launch-subtitle">Enter pilot names and choose a control mode</p>
          </div>

          <form onSubmit={handleStart} className="launch-form">
            <div className="launch-split-layout">
              {/* Left Column: Red Team (Range Bot) */}
              <div className="launch-column column-red">
                <div className="pilot-avatar-hud">
                  <div className="hud-scanner" />
                  <img
                    src={staticAvatar}
                    alt="Range Bot Avatar"
                    className="pilot-img"
                  />
                  <div className="hud-bracket top-left" />
                  <div className="hud-bracket top-right" />
                  <div className="hud-bracket bottom-left" />
                  <div className="hud-bracket bottom-right" />
                </div>
                
                <div className="launch-field">
                  <label htmlFor="range-name">
                    <span className="field-prefix">[RED PILOT]</span> RANGE BOT NAME
                  </label>
                  <input
                    id="range-name"
                    type="text"
                    value={rangeName}
                    onChange={(e) => setRangeName(e.target.value)}
                    placeholder="ENTER PILOT NAME..."
                    required
                    autoComplete="off"
                  />
                </div>
              </div>

              {/* Center VS Emblem */}
              <div className="vs-container">
                <div className="vs-line-top" />
                <div className="vs-emblem">
                  <span className="vs-glow">VS</span>
                </div>
                <div className="vs-line-bottom" />
              </div>

              {/* Right Column: Blue Team (Tank Bot) */}
              <div className="launch-column column-blue">
                <div className="pilot-avatar-hud">
                  <div className="hud-scanner" />
                  <img
                    src={staticAvatar}
                    alt="Tank Bot Avatar"
                    className="pilot-img"
                  />
                  <div className="hud-bracket top-left" />
                  <div className="hud-bracket top-right" />
                  <div className="hud-bracket bottom-left" />
                  <div className="hud-bracket bottom-right" />
                </div>

                <div className="launch-field">
                  <label htmlFor="tank-name">
                    <span className="field-prefix">[BLUE PILOT]</span> TANK BOT NAME
                  </label>
                  <input
                    id="tank-name"
                    type="text"
                    value={tankName}
                    onChange={(e) => setTankName(e.target.value)}
                    placeholder="ENTER PILOT NAME..."
                    required
                    autoComplete="off"
                  />
                </div>

                <div className="launch-field mode-field">
                  <span className="field-label">
                    <span className="field-prefix">&gt;</span> TANK CONTROL MODE
                  </span>
                  <div className="mode-toggle">
                    <button
                      type="button"
                      className={`mode-btn ${tankMode === 'Auto' ? 'active' : ''}`}
                      onClick={() => setTankMode('Auto')}
                    >
                      AUTO
                    </button>
                    <button
                      type="button"
                      className={`mode-btn ${tankMode === 'Manual' ? 'active' : ''}`}
                      onClick={() => setTankMode('Manual')}
                    >
                      MANUAL
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <button type="submit" className="initialize-btn">
              START BATTLE
            </button>
          </form>
        </div>
      )}
    </div>
  );
};

export default LaunchScreen;
