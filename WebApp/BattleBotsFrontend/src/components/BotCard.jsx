import React, { useMemo } from 'react';
import HealthBar from './HealthBar';
import PowerItem from './PowerItem';
import { sortPowersForDisplay } from '../constants/botPowers';
import '../css/BotCard.css';

const BotCard = ({ botData, onPowerActivate, powersDisabled }) => {
  const {
    name,
    avatar,
    mode,
    color,
    currentHealth,
    maxHealth,
    powers = [],
  } = botData;

  const sortedPowers = useMemo(
    () => sortPowersForDisplay(powers),
    [powers]
  );

  const modeClass = mode === 'Manual' ? 'badge-manual' : 'badge-auto';

  return (
    <div className={`bot-card card-${color}`}>
      <div className="card-header">
        <div className="bot-identity">
          <div className="bot-avatar">
            <img src={avatar} alt={name} />
          </div>
          <h2 className="bot-name">{name}</h2>
        </div>
        <span className={`mode-badge ${modeClass}`}>{mode}</span>
      </div>

      <HealthBar current={currentHealth} max={maxHealth} />

      <div className="powers-section" role="toolbar" aria-label={`${name} abilities`}>
        {sortedPowers.map((power) => (
          <PowerItem
            key={power.id}
            power={power}
            onActivate={onPowerActivate}
            disabled={powersDisabled}
          />
        ))}
      </div>
    </div>
  );
};

export default BotCard;
