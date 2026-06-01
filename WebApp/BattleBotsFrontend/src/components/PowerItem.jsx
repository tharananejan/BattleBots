import React from 'react';
import '../css/PowerItem.css';

const formatSeconds = (ms) => Math.max(0, Math.ceil(ms / 1000));

/**
 * Display states aligned with remote OLED: RDY / ON / CD / OFF
 */
function getUltimateDisplay(status, activeRemainingMs, cooldownRemainingMs) {
  if (status === 'ready') {
    return { mode: 'ready', primary: 'RDY', secondary: null };
  }
  if (activeRemainingMs > 0) {
    return {
      mode: 'active',
      primary: 'ON',
      secondary: formatSeconds(activeRemainingMs),
      tertiary:
        cooldownRemainingMs > 0 ? `CD ${formatSeconds(cooldownRemainingMs)}` : null,
    };
  }
  return {
    mode: 'cooldown',
    primary: 'CD',
    secondary: formatSeconds(cooldownRemainingMs),
    tertiary: null,
  };
}

/** Display-only; state is driven by ESP/WebSocket, not user clicks. */
const PowerItem = ({ power }) => {
  const {
    name,
    icon,
    type,
    isUltimate,
    status,
    activeRemainingMs = 0,
    cooldownRemainingMs = 0,
    cooldownMs = 0,
  } = power;

  const isUltimatePower = type === 'ultimate';
  const isNormal = type === 'normal';
  const isReady = isUltimatePower ? status === 'ready' : status === 'off';
  const isOn = isNormal && status === 'on';

  const cooldownPct =
    cooldownMs > 0
      ? Math.min(100, (cooldownRemainingMs / cooldownMs) * 100)
      : 0;

  const ultimateDisplay = isUltimatePower
    ? getUltimateDisplay(status, activeRemainingMs, cooldownRemainingMs)
    : null;

  const displayMode = isUltimatePower
    ? ultimateDisplay.mode
    : isOn
      ? 'on'
      : 'off';

  const ariaStatus = isUltimatePower
    ? isReady
      ? 'ready'
      : ultimateDisplay.mode === 'active'
        ? `on, ${ultimateDisplay.secondary}s active, cooldown ${formatSeconds(cooldownRemainingMs)}s`
        : `cooldown ${ultimateDisplay.secondary}s`
    : isOn
      ? 'on'
      : 'off';

  return (
    <div className="power-slot">
      <div
        role="status"
        className={`ability-btn display-only ${displayMode} ${isUltimate ? 'ultimate' : 'normal'}`}
        aria-label={`${name}${isUltimate ? ' ultimate' : ''} — ${ariaStatus}`}
        title={name}
      >
        {isUltimatePower && displayMode === 'cooldown' && (
          <span
            className="cd-progress-track"
            style={{ '--cd-pct': `${cooldownPct}%` }}
            aria-hidden="true"
          >
            <span className="cd-progress-fill" />
          </span>
        )}

        <span className="ability-inner">
          {isUltimatePower ? (
            <>
              <span className="ability-icon-muted">{icon}</span>
              <span className={`status-word status-${displayMode}`}>
                {ultimateDisplay.primary}
              </span>
              {ultimateDisplay.secondary && (
                <span className="status-seconds">{ultimateDisplay.secondary}</span>
              )}
              {ultimateDisplay.tertiary && (
                <span className="status-tertiary">{ultimateDisplay.tertiary}</span>
              )}
            </>
          ) : (
            <>
              <span className="ability-icon">{icon}</span>
              <span className={`status-word status-${displayMode}`}>
                {isOn ? 'ON' : 'OFF'}
              </span>
            </>
          )}
        </span>
      </div>
      <span className="ability-label">{name}</span>
    </div>
  );
};

export default PowerItem;
