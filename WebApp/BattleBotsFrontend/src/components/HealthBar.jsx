import React from 'react';
import '../css/HealthBar.css';

const HealthBar = ({ current, max }) => {
  const percentage = (current / max) * 100;
  
  return (
    <div className="health-container">
      <div className="health-text">
        Health: <strong>{current}/{max}</strong>
      </div>
      <div className="health-bar-bg">
        <div 
          className="health-bar-fill" 
          style={{ width: `${percentage}%` }}
        ></div>
      </div>
    </div>
  );
};

export default HealthBar;