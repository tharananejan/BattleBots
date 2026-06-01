import React from 'react';
import BotMarker from './BotMarker';
import '../css/Arena.css';

const Arena = ({ bots }) => {
  const FRAME_SIZE = 480;

  // Retrieve active ultimate ability status flags dynamically from bots state
  const rangeBot = bots?.find((b) => b.color === 'red');
  const tankBot = bots?.find((b) => b.color === 'blue');

  const fanPower = rangeBot?.powers?.find((p) => p.id === 'fan');
  const humidifierPower = tankBot?.powers?.find((p) => p.id === 'humidifier');

  const isFanActive = fanPower?.status === 'running';
  const isHumidifierActive = humidifierPower?.status === 'running';

  return (
    <div className="arena-wrapper">
      <div className="arena-screen">
        <div className="grid-overlay"></div>
        
        {/* Corner Fans inside all four corners - work/spin only when dynamic active class is present */}
        <div className={`corner-fan top-left ${isFanActive ? 'working' : ''}`}></div>
        <div className={`corner-fan top-right ${isFanActive ? 'working' : ''}`}></div>
        <div className={`corner-fan bottom-left ${isFanActive ? 'working' : ''}`}></div>
        <div className={`corner-fan bottom-right ${isFanActive ? 'working' : ''}`}></div>

        {/* Humidifiers mounted along borders around each corner - mist only when active class is present */}
        <div className={`humidifier top-left-h1 ${isHumidifierActive ? 'working' : ''}`}></div>
        <div className={`humidifier top-left-h2 ${isHumidifierActive ? 'working' : ''}`}></div>
        <div className={`humidifier top-right-h1 ${isHumidifierActive ? 'working' : ''}`}></div>
        <div className={`humidifier top-right-h2 ${isHumidifierActive ? 'working' : ''}`}></div>
        <div className={`humidifier bottom-left-h1 ${isHumidifierActive ? 'working' : ''}`}></div>
        <div className={`humidifier bottom-left-h2 ${isHumidifierActive ? 'working' : ''}`}></div>
        <div className={`humidifier bottom-right-h1 ${isHumidifierActive ? 'working' : ''}`}></div>
        <div className={`humidifier bottom-right-h2 ${isHumidifierActive ? 'working' : ''}`}></div>

        <div className="battle-field">
          {bots.map((bot) => (
            <div
              key={bot.id}
              className={`bot-position ${bot.isFrozen ? 'bot-frozen' : ''}`}
              style={{
                left: `${(bot.x / FRAME_SIZE) * 100}%`,
                top: `${(bot.y / FRAME_SIZE) * 100}%`,
                transition: 'all 0.1s ease-out',
              }}
            >
              <BotMarker color={bot.color} isFrozen={bot.isFrozen} />
              <div className="bot-label">
                <span className="bot-name-text">{bot.name}</span>
                {bot.isFrozen && (
                  <span className="freeze-label">FROZEN</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Arena;
