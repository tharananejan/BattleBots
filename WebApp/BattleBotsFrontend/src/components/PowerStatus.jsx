import React from 'react';
import '../css/PowerStatus.css';

const PowerStatus = ({ status }) => {
  const isReady = status === "Ready";

  return (
    <div className="power-box">
      <span className="power-label">ULTIMATE POWER</span>
      {isReady ? (
        <span className="power-ready">Ready</span>
      ) : (
        <div className="power-icon">
          {/* Simple SVG Clock Icon */}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
        </div>
      )}
    </div>
  );
};

export default PowerStatus;