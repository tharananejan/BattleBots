import React, { useEffect, useRef, useState } from 'react';
import {
  buildTankSensorMap,
  buildRangeDamageSources,
  buildDebugDamagePaths,
  inferTankDamageCause,
  inferRangeDamageCause,
} from '../constants/damageRules';
import {
  DAMAGE_SETTING_FIELDS,
  POWER_SETTING_FIELDS,
  RELAY_SETTING_FIELDS,
} from '../constants/gameSettings';
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

function formatMs(ms) {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function SettingInput({ label, value, unit, min, max, step, onChange }) {
  return (
    <label className="debug-setting-field">
      <span className="debug-setting-label">{label}</span>
      <div className="debug-setting-input-row">
        <input
          type="number"
          className="debug-setting-input"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        {unit && <span className="debug-setting-unit">{unit}</span>}
      </div>
    </label>
  );
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

const DebugPage = ({
  telemetry,
  bots,
  debugDamage,
  setDebugDamagePath,
  battleStarted,
  testMode,
  toggleTestMode,
  gameSettings,
  updateGameSettings,
  activatePowerManually,
  onClose,
}) => {
  const [damageLog, setDamageLog] = useState([]);
  const [draftSettings, setDraftSettings] = useState(gameSettings);
  const prevHealthRef = useRef({ range: 100, tank: 100 });

  useEffect(() => {
    setDraftSettings(gameSettings);
  }, [gameSettings]);

  const rangeBot = bots?.find((b) => b.color === 'red');
  const tankBot = bots?.find((b) => b.color === 'blue');
  const connected = telemetry?.connected ?? false;

  const tankSensorMap = buildTankSensorMap(gameSettings);
  const rangeDamageSources = buildRangeDamageSources(gameSettings);
  const debugDamagePaths = buildDebugDamagePaths(gameSettings);
  const hallThreshold = gameSettings.damage.hallFreezeThreshold;
  const freezeDurationMs = gameSettings.damage.tankFreezeDurationMs;

  useEffect(() => {
    if (!rangeBot || !tankBot) return;

    const prev = prevHealthRef.current;
    const rangeHp = rangeBot.currentHealth;
    const tankHp = tankBot.currentHealth;

    const entries = [];

    if (rangeHp < prev.range) {
      const damage = prev.range - rangeHp;
      const cause = inferRangeDamageCause(damage, tankBot.powers, gameSettings);
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
      const cause = inferTankDamageCause(telemetry, damage, gameSettings);
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
  }, [rangeBot, tankBot, telemetry, gameSettings]);

  const hallTriggered = connected && telemetry.hall < hallThreshold;
  const tankFrozen = tankBot?.isFrozen ?? false;
  const combatUnlocked = battleStarted || testMode;

  const updateDamageSetting = (key, value) => {
    setDraftSettings((prev) => ({
      ...prev,
      damage: { ...prev.damage, [key]: value },
    }));
  };

  const updatePowerSetting = (powerId, field, value) => {
    setDraftSettings((prev) => ({
      ...prev,
      powers: {
        ...prev.powers,
        [powerId]: { ...prev.powers[powerId], [field]: value },
      },
    }));
  };

  const updateRelaySetting = (key, value) => {
    setDraftSettings((prev) => ({
      ...prev,
      relayActiveMs: { ...prev.relayActiveMs, [key]: value },
    }));
  };

  const applySettings = () => {
    updateGameSettings(draftSettings);
  };

  const resetDraft = () => {
    setDraftSettings(gameSettings);
  };

  const settingsDirty =
    JSON.stringify(draftSettings) !== JSON.stringify(gameSettings);

  return (
    <div className="debug-overlay" onClick={onClose}>
      <div className="debug-container" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="debug-close" onClick={onClose} aria-label="Close debug panel">
          ×
        </button>

        <header className="debug-header">
          <div>
            <h2 className="debug-title">Debug & Game Settings</h2>
            <p className="debug-subtitle">LIVE TELEMETRY, DAMAGE MAPPING & CUSTOMIZATION</p>
          </div>
          <div className={`debug-connection ${connected ? 'online' : 'offline'}`}>
            {connected ? 'WebSocket Live' : 'WebSocket Offline'}
          </div>
        </header>

        <div className="debug-content">
          <section className="debug-section">
            <h3 className="debug-section-title">Game State</h3>
            <div className="debug-game-state-row">
              <div className={`debug-game-state-card ${battleStarted ? 'active' : 'idle'}`}>
                <span className="debug-game-state-label">Battle Started</span>
                <span className={`debug-game-state-badge ${battleStarted ? 'on' : 'off'}`}>
                  {battleStarted ? 'YES' : 'NO'}
                </span>
              </div>
              <div className={`debug-game-state-card ${testMode ? 'active' : 'idle'}`}>
                <span className="debug-game-state-label">Test Mode</span>
                <span className={`debug-game-state-badge ${testMode ? 'on' : 'off'}`}>
                  {testMode ? 'ON' : 'OFF'}
                </span>
              </div>
              <div className={`debug-game-state-card ${combatUnlocked ? 'active' : 'locked'}`}>
                <span className="debug-game-state-label">Combat Unlocked</span>
                <span className={`debug-game-state-badge ${combatUnlocked ? 'on' : 'off'}`}>
                  {combatUnlocked ? 'YES' : 'LOCKED'}
                </span>
              </div>
            </div>
            <div className="debug-test-mode-panel">
              <div>
                <h4 className="debug-test-mode-title">Test Mode</h4>
                <p className="debug-note">
                  When enabled, damage, relays, powers, and Python automation run even before
                  Start Battle. Use for hardware testing only.
                </p>
              </div>
              <button
                type="button"
                className={`debug-toggle-btn debug-test-mode-btn ${testMode ? 'active' : ''}`}
                onClick={() => toggleTestMode(!testMode)}
                aria-pressed={testMode}
              >
                {testMode ? 'Disable Test Mode' : 'Enable Test Mode'}
              </button>
            </div>
          </section>

          <section className="debug-section debug-settings-section">
            <div className="debug-settings-header">
              <h3 className="debug-section-title">Game Settings</h3>
              <div className="debug-settings-actions">
                <button
                  type="button"
                  className="debug-clear-btn"
                  onClick={resetDraft}
                  disabled={!settingsDirty}
                >
                  Reset
                </button>
                <button
                  type="button"
                  className="debug-apply-btn"
                  onClick={applySettings}
                  disabled={!settingsDirty}
                >
                  Apply Settings
                </button>
              </div>
            </div>
            <p className="debug-note debug-controls-note">
              Customize damage, power timings, and relay durations. Settings are saved on the Python
              backend and synced to BattleGround firmware. Editable anytime.
            </p>

            <h4 className="debug-settings-subtitle">Damage & Sensors</h4>
            <div className="debug-settings-grid">
              {DAMAGE_SETTING_FIELDS.map((field) => (
                <SettingInput
                  key={field.key}
                  label={field.label}
                  value={draftSettings.damage[field.key]}
                  unit={field.unit}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  onChange={(value) => updateDamageSetting(field.key, value)}
                />
              ))}
            </div>

            <h4 className="debug-settings-subtitle">Power Timings</h4>
            <div className="debug-power-settings-grid">
              {POWER_SETTING_FIELDS.map((power) => (
                <div key={power.id} className={`debug-power-setting-card ${power.color}`}>
                  <div className="debug-power-setting-header">
                    <span className="debug-control-bot">{power.bot}</span>
                    <span className="debug-power-setting-name">{power.label}</span>
                  </div>
                  <SettingInput
                    label="Active Time"
                    value={draftSettings.powers[power.id].activeMs}
                    unit="ms"
                    min={0}
                    max={60000}
                    step={500}
                    onChange={(value) => updatePowerSetting(power.id, 'activeMs', value)}
                  />
                  <SettingInput
                    label="Cooldown"
                    value={draftSettings.powers[power.id].cooldownMs}
                    unit="ms"
                    min={0}
                    max={120000}
                    step={500}
                    onChange={(value) => updatePowerSetting(power.id, 'cooldownMs', value)}
                  />
                  <p className="debug-power-setting-summary">
                    {formatMs(draftSettings.powers[power.id].activeMs)} active /{' '}
                    {formatMs(draftSettings.powers[power.id].cooldownMs)} cooldown
                  </p>
                  <button
                    type="button"
                    className="debug-test-power-btn"
                    onClick={() => activatePowerManually(power.id)}
                  >
                    Test Power
                  </button>
                </div>
              ))}
            </div>

            <h4 className="debug-settings-subtitle">Relay Active Times (BattleGround)</h4>
            <div className="debug-settings-grid">
              {RELAY_SETTING_FIELDS.map((field) => (
                <SettingInput
                  key={field.key}
                  label={field.label}
                  value={draftSettings.relayActiveMs[field.key]}
                  unit={field.unit}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  onChange={(value) => updateRelaySetting(field.key, value)}
                />
              ))}
            </div>
          </section>

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
              {tankSensorMap.map((sensor) => (
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
                Hall below {hallThreshold} — frontend freeze active ({freezeDurationMs / 1000}s)
              </p>
            )}
          </section>

          <section className="debug-section">
            <h3 className="debug-section-title">Damage Controls (BattleGround firmware)</h3>
            <p className="debug-note debug-controls-note">
              Toggle OFF to disable HP damage for that path on BattleGround — affects remotes and web app.
            </p>
            <div className="debug-controls-grid">
              {debugDamagePaths.map((path) => {
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
              {rangeDamageSources.map((rule) => (
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
