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
} from '../constants/gameSettings';
import '../css/DebugPage.css';

const MAX_LOG_ENTRIES = 15;

const TABS = [
  { id: 'tank', label: 'Tank Bot' },
  { id: 'range', label: 'Range Bot' },
  { id: 'battleground', label: 'Battleground' },
];

const SHORT_DAMAGE_LABELS = {
  rangePiezoIr: 'Piezo / IR',
  rangeHumidity: 'Humidity',
  tankLaser: 'Laser',
  tankLaserGrid: 'Laser Grid',
  tankIr: 'IR Proximity',
  piezoHitThreshold: 'Piezo Limit',
  hallFreezeThreshold: 'Hall Limit',
  tankFreezeDurationMs: 'Freeze Time',
};

const TANK_DAMAGE_KEYS = [
  'tankLaser',
  'tankLaserGrid',
  'tankIr',
  'hallFreezeThreshold',
  'tankFreezeDurationMs',
];
const RANGE_DAMAGE_KEYS = ['rangePiezoIr', 'rangeHumidity', 'piezoHitThreshold'];

function formatTime(date) {
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 1,
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function ValueControl({ label, value, unit, min, max, step, accent = 'cyan', onChange }) {
  const nudge = (delta) => {
    onChange(clamp(value + delta, min, max));
  };

  return (
    <div className={`debug-value-row debug-value-row--${accent}`}>
      <span className="debug-value-label">{label}</span>
      <div className="debug-value-actions">
        <button
          type="button"
          className="debug-value-btn"
          onClick={() => nudge(-step)}
          disabled={value <= min}
          aria-label={`Decrease ${label}`}
        >
          −
        </button>
        <span className="debug-value-display">
          {value}
          {unit ? <span className="debug-value-unit">{unit}</span> : null}
        </span>
        <button
          type="button"
          className="debug-value-btn"
          onClick={() => nudge(step)}
          disabled={value >= max}
          aria-label={`Increase ${label}`}
        >
          +
        </button>
      </div>
    </div>
  );
}

function PillSwitch({ label, checked, onChange }) {
  return (
    <label className="debug-pill-switch">
      <span className="debug-pill-switch-label">{label}</span>
      <button
        type="button"
        role="switch"
        className={`debug-pill-switch-track ${checked ? 'on' : ''}`}
        aria-checked={checked}
        onClick={() => onChange(!checked)}
      >
        <span className="debug-pill-switch-thumb" />
      </button>
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
        <span className="debug-sensor-label">{sensor.label}</span>
        <span className={`debug-sensor-status ${triggered ? 'active' : 'idle'}`}>
          {triggered ? 'ON' : 'OFF'}
        </span>
      </div>
      <p className="debug-sensor-value">{displayValue}</p>
      {sensor.damageAmount > 0 && (
        <span className="debug-damage-tag">−{sensor.damageAmount} HP</span>
      )}
    </div>
  );
}

function HealthGauge({ label, hp, accent, frozen }) {
  return (
    <div className={`debug-health-gauge debug-health-gauge--${accent}`}>
      <span className="debug-health-gauge-label">{label}</span>
      <span className="debug-health-gauge-value">{hp ?? '--'}</span>
      <span className="debug-health-gauge-unit">HP</span>
      <div className="debug-health-gauge-bar">
        <div className="debug-health-gauge-fill" style={{ height: `${hp ?? 0}%` }} />
      </div>
      {frozen && <span className="debug-freeze-badge">FROZEN</span>}
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
  tankInLaserGrid = false,
  onClose,
}) => {
  const [damageLog, setDamageLog] = useState([]);
  const [draftSettings, setDraftSettings] = useState(gameSettings);
  const [activeTab, setActiveTab] = useState('tank');
  const [isMinimized, setIsMinimized] = useState(false);
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

  const tankDamagePaths = debugDamagePaths.filter((p) => p.botColor === 'blue');
  const rangeDamagePaths = debugDamagePaths.filter((p) => p.botColor === 'red');
  const tankPowers = POWER_SETTING_FIELDS.filter((p) => p.color === 'blue');
  const rangePowers = POWER_SETTING_FIELDS.filter((p) => p.color === 'red');

  const tankDamageFields = DAMAGE_SETTING_FIELDS.filter((f) => TANK_DAMAGE_KEYS.includes(f.key));
  const rangeDamageFields = DAMAGE_SETTING_FIELDS.filter((f) => RANGE_DAMAGE_KEYS.includes(f.key));

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
        bot: 'Range',
        botColor: 'red',
        damage,
        healthAfter: rangeHp,
        ...cause,
      });
    }

    if (tankHp < prev.tank) {
      const damage = prev.tank - tankHp;
      const cause = inferTankDamageCause(telemetry, damage, gameSettings, {
        tankInLaserGrid,
      });
      entries.push({
        id: `${Date.now()}-tank-${damage}`,
        time: formatTime(new Date()),
        bot: 'Tank',
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
  }, [rangeBot, tankBot, telemetry, gameSettings, tankInLaserGrid]);

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

  const applySettings = () => {
    updateGameSettings(draftSettings);
  };

  const resetDraft = () => {
    setDraftSettings(gameSettings);
  };

  const settingsDirty =
    JSON.stringify(draftSettings) !== JSON.stringify(gameSettings);

  const renderPowerRow = (power, accent) => (
    <div key={power.id} className={`debug-power-row debug-power-row--${accent}`}>
      <div className="debug-power-row-meta">
        <span className="debug-power-name">{power.label}</span>
        <button
          type="button"
          className={`debug-test-power-btn debug-test-power-btn--${accent}`}
          onClick={() => activatePowerManually(power.id)}
          disabled={!testMode}
        >
          Test
        </button>
      </div>
      <ValueControl
        label="Active"
        value={draftSettings.powers[power.id].activeMs}
        unit="ms"
        min={0}
        max={60000}
        step={500}
        accent={accent}
        onChange={(value) => updatePowerSetting(power.id, 'activeMs', value)}
      />
      <ValueControl
        label="CD"
        value={draftSettings.powers[power.id].cooldownMs}
        unit="ms"
        min={0}
        max={120000}
        step={500}
        accent={accent}
        onChange={(value) => updatePowerSetting(power.id, 'cooldownMs', value)}
      />
    </div>
  );

  const renderDamageToggle = (path) => {
    const enabled = debugDamage?.[path.flagKey] ?? true;
    return (
      <div key={path.id} className={`debug-toggle-row ${enabled ? 'on' : 'off'}`}>
        <div className="debug-toggle-row-info">
          <span className="debug-toggle-row-label">{path.label}</span>
          <span className="debug-damage-tag">−{path.damageAmount} HP</span>
        </div>
        <PillSwitch
          label={enabled ? 'On' : 'Off'}
          checked={enabled}
          onChange={(next) => setDebugDamagePath(path.flagKey, next)}
        />
      </div>
    );
  };

  if (isMinimized) {
    return (
      <div className="debug-overlay minimized">
        <div className="debug-minimized-bar">
          <span className="debug-minimized-label">Debug</span>
          <span className={`debug-minimized-status ${connected ? 'online' : 'offline'}`}>
            {connected ? 'Live' : 'Offline'}
          </span>
          <PillSwitch
            label={testMode ? 'Test' : 'Off'}
            checked={testMode}
            onChange={toggleTestMode}
          />
          <button
            type="button"
            className="debug-test-power-btn debug-test-power-btn--orange"
            onClick={() => activatePowerManually('laser')}
            disabled={!testMode}
          >
            Laser
          </button>
          <button
            type="button"
            className="debug-minimized-restore"
            onClick={() => setIsMinimized(false)}
            aria-label="Restore debug panel"
          >
            ▢
          </button>
          <button
            type="button"
            className="debug-minimized-close"
            onClick={onClose}
            aria-label="Close debug panel"
          >
            ×
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="debug-overlay" onClick={onClose}>
      <div className="debug-container" onClick={(e) => e.stopPropagation()}>
        <div className="debug-header-actions">
          <div className={`debug-connection ${connected ? 'online' : 'offline'}`}>
            {connected ? 'Live' : 'Offline'}
          </div>
          <button
            type="button"
            className="debug-minimize"
            onClick={() => setIsMinimized(true)}
            aria-label="Minimize debug panel"
          >
            −
          </button>
          <button type="button" className="debug-close" onClick={onClose} aria-label="Close debug panel">
            ×
          </button>
        </div>

        <header className="debug-header">
          <div>
            <h2 className="debug-title">Debug Panel</h2>
            <p className="debug-subtitle">Live controls & thresholds</p>
          </div>
        </header>

        <nav className="debug-navbar" aria-label="Debug sections">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`debug-nav-item ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="debug-body">
          {activeTab === 'tank' && (
            <div className="debug-tab-panel debug-tab-panel--tank">
              <HealthGauge
                label="Tank"
                hp={tankBot?.currentHealth}
                accent="blue"
                frozen={tankFrozen}
              />

              <section className="debug-card debug-card--sensors">
                <h3 className="debug-card-title">Sensors</h3>
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
                    Hall &lt; {hallThreshold} — freeze {freezeDurationMs / 1000}s
                  </p>
                )}
              </section>

              <section className="debug-card debug-card--powers">
                <h3 className="debug-card-title">Powers</h3>
                <div className="debug-power-grid">
                  {tankPowers.map((power) => renderPowerRow(power, 'blue'))}
                </div>
              </section>

              <section className="debug-card debug-card--thresholds">
                <h3 className="debug-card-title">Thresholds</h3>
                <div className="debug-value-grid">
                  {tankDamageFields.map((field) => (
                    <ValueControl
                      key={field.key}
                      label={SHORT_DAMAGE_LABELS[field.key] || field.label}
                      value={draftSettings.damage[field.key]}
                      unit={field.unit}
                      min={field.min}
                      max={field.max}
                      step={field.step}
                      accent="blue"
                      onChange={(value) => updateDamageSetting(field.key, value)}
                    />
                  ))}
                </div>
              </section>

              <section className="debug-card debug-card--toggles">
                <h3 className="debug-card-title">Damage Toggles</h3>
                {tankDamagePaths.map(renderDamageToggle)}
              </section>
            </div>
          )}

          {activeTab === 'range' && (
            <div className="debug-tab-panel debug-tab-panel--range">
              <HealthGauge
                label="Range"
                hp={rangeBot?.currentHealth}
                accent="orange"
              />

              <section className="debug-card debug-card--rules">
                <h3 className="debug-card-title">Damage Sources</h3>
                <div className="debug-rules-list">
                  {rangeDamageSources.map((rule) => (
                    <div key={rule.id} className="debug-rule-row">
                      <span className="debug-rule-label">{rule.label}</span>
                      <span className="debug-damage-tag">−{rule.amount} HP</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="debug-card debug-card--powers">
                <h3 className="debug-card-title">Powers</h3>
                <div className="debug-power-grid">
                  {rangePowers.map((power) => renderPowerRow(power, 'orange'))}
                </div>
              </section>

              <section className="debug-card debug-card--thresholds">
                <h3 className="debug-card-title">Thresholds</h3>
                <div className="debug-value-grid">
                  {rangeDamageFields.map((field) => (
                    <ValueControl
                      key={field.key}
                      label={SHORT_DAMAGE_LABELS[field.key] || field.label}
                      value={draftSettings.damage[field.key]}
                      unit={field.unit}
                      min={field.min}
                      max={field.max}
                      step={field.step}
                      accent="orange"
                      onChange={(value) => updateDamageSetting(field.key, value)}
                    />
                  ))}
                </div>
              </section>

              <section className="debug-card debug-card--toggles">
                <h3 className="debug-card-title">Damage Toggles</h3>
                {rangeDamagePaths.map(renderDamageToggle)}
              </section>
            </div>
          )}

          {activeTab === 'battleground' && (
            <div className="debug-tab-panel debug-tab-panel--battleground">
              <section className="debug-card debug-card--state">
                <h3 className="debug-card-title">Game State</h3>
                <div className="debug-state-grid">
                  <div className={`debug-state-pill ${battleStarted ? 'on' : ''}`}>
                    <span>Battle</span>
                    <strong>{battleStarted ? 'On' : 'Off'}</strong>
                  </div>
                  <div className={`debug-state-pill ${testMode ? 'on' : ''}`}>
                    <span>Test</span>
                    <strong>{testMode ? 'On' : 'Off'}</strong>
                  </div>
                  <div className={`debug-state-pill ${combatUnlocked ? 'on' : ''}`}>
                    <span>Combat</span>
                    <strong>{combatUnlocked ? 'Unlocked' : 'Locked'}</strong>
                  </div>
                </div>
                <div className="debug-test-row">
                  <span className="debug-test-label">Test mode (pre-battle hardware)</span>
                  <PillSwitch
                    label={testMode ? 'On' : 'Off'}
                    checked={testMode}
                    onChange={toggleTestMode}
                  />
                </div>
              </section>

              <section className="debug-card debug-card--ground">
                <h3 className="debug-card-title">Ground Powers</h3>
                <div className="debug-power-grid">
                  {['fan', 'laser', 'humidifier'].map(id => {
                    const power = POWER_SETTING_FIELDS.find(p => p.id === id);
                    return power ? renderPowerRow(power, 'cyan') : null;
                  })}
                </div>
              </section>

              <section className="debug-card debug-card--log">
                <div className="debug-log-header">
                  <h3 className="debug-card-title">Event Log</h3>
                  <button
                    type="button"
                    className="debug-clear-btn"
                    onClick={() => setDamageLog([])}
                  >
                    Clear
                  </button>
                </div>
                <div className="debug-log-list">
                  {damageLog.length === 0 ? (
                    <p className="debug-log-empty">No events yet</p>
                  ) : (
                    damageLog.map((entry) => (
                      <div key={entry.id} className={`debug-log-entry ${entry.botColor}`}>
                        <div className="debug-log-top">
                          <span className="debug-log-time">{entry.time}</span>
                          <span className="debug-log-bot">{entry.bot}</span>
                          <span className="debug-log-damage">−{entry.damage}</span>
                        </div>
                        <p className="debug-log-source">{entry.source}</p>
                        <p className="debug-log-health">{entry.healthAfter} HP left</p>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </div>
          )}
        </div>

        <footer className="debug-footer-actions">
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
            Apply
          </button>
        </footer>
      </div>
    </div>
  );
};

export default DebugPage;
