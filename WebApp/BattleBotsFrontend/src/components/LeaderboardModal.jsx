import React, { useEffect } from 'react';
import '../css/LeaderboardModal.css';

const DUMMY_LEADERBOARD_DATA = [
  {
    rank: 1,
    name: 'Nimasha (Player 1)',
    avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=Nimasha',
    wins: 48,
    losses: 4,
    color: 'red',
    botUsed: 'Range Bot',
    botUsedIcon: '⚡',
    botStats: 'Range: 32W | Tank: 16W',
  },
  {
    rank: 2,
    name: 'Operator_X (Player 2)',
    avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=OperatorX',
    wins: 41,
    losses: 9,
    color: 'blue',
    botUsed: 'Tank Bot',
    botUsedIcon: '🛡️',
    botStats: 'Tank: 28W | Range: 13W',
  },
  {
    rank: 3,
    name: 'CyberKnight',
    avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=CyberKnight',
    wins: 34,
    losses: 16,
    color: 'emerald',
    botUsed: 'Range Bot',
    botUsedIcon: '⚡',
    botStats: 'Range: 24W | Tank: 10W',
  },
  {
    rank: 4,
    name: 'RoboPro_99',
    avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=RoboPro99',
    wins: 27,
    losses: 23,
    color: 'amber',
    botUsed: 'Tank Bot',
    botUsedIcon: '🛡️',
    botStats: 'Tank: 17W | Range: 10W',
  },
];

const LeaderboardModal = ({ onClose }) => {
  // Prevent background scrolling while modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const handleBackdropClick = (e) => {
    if (e.target.className === 'leaderboard-overlay') {
      onClose();
    }
  };

  return (
    <div className="leaderboard-overlay" onClick={handleBackdropClick}>
      <div className="leaderboard-container">
        <button
          type="button"
          className="leaderboard-close"
          onClick={onClose}
          aria-label="Close Leaderboard"
        >
          &times;
        </button>

        <div className="leaderboard-header">
          <h2 className="leaderboard-title">PLAYER LEADERBOARD</h2>
          <p className="leaderboard-subtitle">RANKED TELEMETRY AND PLAYER EFFICIENCY</p>
        </div>

        <div className="leaderboard-content">
          <table className="leaderboard-table">
            <thead>
              <tr>
                <th>RANK</th>
                <th>PLAYER</th>
                <th>PREFERRED BOT / STATS</th>
                <th>RECORD (W/L)</th>
                <th>WIN RATE</th>
              </tr>
            </thead>
            <tbody>
              {DUMMY_LEADERBOARD_DATA.map((player) => {
                const total = player.wins + player.losses;
                const winRate = Math.round((player.wins / total) * 100);

                return (
                  <tr key={player.rank} className={`row-rank-${player.rank}`}>
                    <td className="col-rank">
                      <span className={`rank-number rank-glow-${player.rank}`}>
                        {player.rank}
                      </span>
                    </td>
                    <td className="col-combatant">
                      <div className="combatant-info">
                        <div className={`combatant-avatar avatar-border-${player.color}`}>
                          <img src={player.avatar} alt={player.name} />
                        </div>
                        <span className="combatant-name">{player.name}</span>
                      </div>
                    </td>
                    <td className="col-bot-info">
                      <div className="bot-used-info">
                        <span className="bot-used-name">
                          {player.botUsedIcon} {player.botUsed}
                        </span>
                        <span className="bot-used-stats">{player.botStats}</span>
                      </div>
                    </td>
                    <td className="col-record">
                      <span className="record-w">{player.wins}W</span>
                      <span className="record-separator">-</span>
                      <span className="record-l">{player.losses}L</span>
                    </td>
                    <td className="col-winrate">
                      <div className="winrate-bar-container">
                        <span className="winrate-value">{winRate}%</span>
                        <div className="winrate-track">
                          <div
                            className={`winrate-fill fill-${player.color}`}
                            style={{ width: `${winRate}%` }}
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default LeaderboardModal;
