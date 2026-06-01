import React from 'react';
import '../css/BotMarker.css';

const BotMarker = ({ color, isFrozen }) => {
  return (
    <div
      className={`bot-marker-container marker-${color} ${isFrozen ? 'frozen' : ''}`}
    >
      <div className="status-square" />
      {isFrozen && (
        <div className="freeze-overlay" aria-label="Frozen">
          <span className="freeze-icon">❄</span>
        </div>
      )}
    </div>
  );
};

export default BotMarker;
