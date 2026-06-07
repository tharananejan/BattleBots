import React, { useEffect, useRef, useState } from 'react';
import { HALL_FREEZE_THRESHOLD, TANK_FREEZE_DURATION_MS } from '../constants/botPowers';
import {
  TANK_SENSOR_MAP,
  RANGE_DAMAGE_SOURCES,
  DEBUG_DAMAGE_PATHS,
  inferTankDamageCause,
  inferRangeDamageCause,
} from '../constants/damageRules';
import '../css/DebugPage.css';

const MAX_LOG_ENTRIES = 15;

function formatTime(date) {
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 1,
  });
}

function SensorCard({ sensor, value, connected }) {
  const triggered = connected && sensor.isTriggered(value);
  const displayValue =
    sensor.key === 'hall'
      ? value
      : sensor.key === 'm1'
        ? `${Number(value).toFixed(1)}°`
        : value;

  return (
    <div className={`debug-sensor-card ${triggered ? 'triggered' : ''}`}>
      <div className="debug-sensor-card-header">
        <span className="debug-sensor-key">{sensor.key}</span>
        <span className={`debug-sensor-status ${triggered ? 'active' : 'idle'}`}>
          {triggered ? 'TRIGGERED' : 'IDLE'}
        </span>
      </div>
      <h4 className="debug-sensor-label">{sensor.label}</h4>
      <p className="debug-sensor-value">{displayValue}</p>
      <p className="debug-sensor-desc">{sensor.description}</p>
      <div className="debug-sensor-meta">
        <span>{sensor.damageMethod}</span>
        {sensor.damageAmount > 0 && (
          <span className="debug-damage-tag">-{sensor.damageAmount} HP</span>
        )}
      </div>
    </div>
  );
}

const DebugPage = ({ telemetry, bots, debugDamage, setDebugDamagePath, onClose }) => {
  const [damageLog, setDamageLog] = useState([]);
  const prevHealthRef = useRef({ range: 100, tank: 100 });

  const rangeBot = bots?.find((b) => b.color === 'red');
  const tankBot = bots?.find((b) => b.color === 'blue');
  const connected = telemetry?.connected ?? false;

  useEffect(() => {
    if (!rangeBot || !tankBot) return;

    const prev = prevHealthRef.current;
    const rangeHp = rangeBot.currentHealth;
    const tankHp = tankBot.currentHealth;

    const entries = [];

    if (rangeHp < prev.range) {
      const damage = prev.range - rangeHp;
      const cause = inferRangeDamageCause(damage, tankBot.powers);
      entries.push({
        id: `${Date.now()}-range-${damage}`,
        time: formatTime(new Date()),
        bot: 'Range Bot',
        botColor: 'red',
        damage,
        healthAfter: rangeHp,
        ...cause,
      });
    }

    if (tankHp < prev.tank) {
      const damage = prev.tank - tankHp;
      const cause = inferTankDamageCause(telemetry, damage);
      entries.push({
        id: `${Date.now()}-tank-${damage}`,
        time: formatTime(new Date()),
        bot: 'Tank Bot',
        botColor: 'blue',
        damage,
        healthAfter: tankHp,
        ...cause,
      });
    }

    if (entries.length > 0) {
      setDamageLog((prevLog) => [...entries, ...prevLog].slice(0, MAX_LOG_ENTRIES));
    }

    prevHealthRef.current = { range: rangeHp, tank: tankHp };
  }, [rangeBot, tankBot, telemetry]);

  const hallTriggered = connected && telemetry.hall < HALL_FREEZE_THRESHOLD;
  const tankFrozen = tankBot?.isFrozen ?? false;

  return (
    <div className="debug-overlay" onClick={onClose}>
      <div className="debug-container" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="debug-close" onClick={onClose} aria-label="Close debug panel">
          ×
        </button>

        <header className="debug-header">
          <div>
            <h2 className="debug-title">Damage Debug</h2>
            <p className="debug-subtitle">TEMPORARY — LIVE SENSOR & DAMAGE MAPPING</p>
          </div>
          <div className={`debug-connection ${connected ? 'online' : 'offline'}`}>
            {connected ? 'WebSocket Live' : 'WebSocket Offline'}
          </div>
        </header>

        <div className="debug-content">
          <section className="debug-section">
            <h3 className="debug-section-title">Bot Health</h3>
            <div className="debug-health-row">
              <div className="debug-health-card range">
                <span className="debug-health-label">Range Bot</span>
                <span className="debug-health-value">{rangeBot?.currentHealth ?? '--'} HP</span>
              </div>
              <div className="debug-health-card tank">
                <span className="debug-health-label">Tank Bot</span>
                <span className="debug-health-value">{tankBot?.currentHealth ?? '--'} HP</span>
                {tankFrozen && <span className="debug-freeze-badge">FROZEN</span>}
              </div>
            </div>
          </section>

          <section className="debug-section">
            <h3 className="debug-section-title">Tank Bot Sensors (from serial telemetry)</h3>
            <div className="debug-sensor-grid">
              {TANK_SENSOR_MAP.map((sensor) => (
                <SensorCard
                  key={sensor.key}
                  sensor={sensor}
                  value={telemetry[sensor.key]}
                  connected={connected}
                />
              ))}
            </div>
            {hallTriggered && (
              <p className="debug-hall-alert">
                Hall below {HALL_FREEZE_THRESHOLD} — frontend freeze active ({TANK_FREEZE_DURATION_MS / 1000}s)
              </p>
            )}
          </section>

          <section className="debug-section">
            <h3 className="debug-section-title">Damage Controls (BattleGround firmware)</h3>
            <p className="debug-note debug-controls-note">
              Toggle OFF to disable HP damage for that path on BattleGround — affects remotes and web app.
            </p>
            <div className="debug-controls-grid">
              {DEBUG_DAMAGE_PATHS.map((path) => {
                const enabled = debugDamage?.[path.flagKey] ?? true;
                return (
                  <div
                    key={path.id}
                    className={`debug-control-card ${path.botColor} ${enabled ? 'enabled' : 'disabled'}`}
                  >
                    <div className="debug-control-header">
                      <span className="debug-control-bot">{path.bot}</span>
                      <span className={`debug-control-status ${enabled ? 'on' : 'off'}`}>
                        {enabled ? 'DAMAGE ON' : 'DAMAGE OFF'}
                      </span>
                    </div>
                    <h4 className="debug-control-label">{path.label}</h4>
                    <p className="debug-control-method">{path.method}()</p>
                    <div className="debug-control-footer">
                      <span className="debug-damage-tag">-{path.damageAmount} HP</span>
                      <button
                        type="button"
                        className={`debug-toggle-btn ${enabled ? 'active' : ''}`}
                        onClick={() => setDebugDamagePath(path.flagKey, !enabled)}
                        aria-pressed={enabled}
                      >
                        {enabled ? 'Disable' : 'Enable'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="debug-section">
            <h3 className="debug-section-title">Range Bot Damage Sources (BattleGround firmware)</h3>
            <div className="debug-rules-grid">
              {RANGE_DAMAGE_SOURCES.map((rule) => (
                <div key={rule.id} className="debug-rule-card">
                  <h4>{rule.label}</h4>
                  <p className="debug-rule-method">{rule.method}()</p>
                  <p className="debug-rule-sensors">{rule.sensors}</p>
                  <span className="debug-damage-tag">-{rule.amount} HP</span>
                </div>
              ))}
            </div>
            <p className="debug-note">
              Range Bot sensor values (piezo, humidityHit) are not streamed to the web app yet.
              Damage is inferred from HP drops and active powers.
            </p>
          </section>

          <section className="debug-section">
            <div className="debug-log-header">
              <h3 className="debug-section-title">Damage Event Log</h3>
              <button
                type="button"
                className="debug-clear-btn"
                onClick={() => setDamageLog([])}
              >
                Clear Log
              </button>
            </div>
            <div className="debug-log-list">
              {damageLog.length === 0 ? (
                <p className="debug-log-empty">No damage events recorded yet.</p>
              ) : (
                damageLog.map((entry) => (
                  <div key={entry.id} className={`debug-log-entry ${entry.botColor}`}>
                    <div className="debug-log-top">
                      <span className="debug-log-time">{entry.time}</span>
                      <span className="debug-log-bot">{entry.bot}</span>
                      <span className="debug-log-damage">-{entry.damage} HP</span>
                    </div>
                    <p className="debug-log-source">
                      Source: <strong>{entry.source}</strong>
                    </p>
                    <p className="debug-log-method">
                      Method: <code>{entry.method}()</code>
                    </p>
                    {entry.sensors?.length > 0 && (
                      <p className="debug-log-sensors">
                        Sensors: {entry.sensors.join(', ')}
                      </p>
                    )}
                    <p className="debug-log-health">Health after: {entry.healthAfter} HP</p>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default DebugPage;
