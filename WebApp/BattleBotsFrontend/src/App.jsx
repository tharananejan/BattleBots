import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import BotCard from './components/BotCard';
import Arena from './components/Arena';
import LaunchScreen from './components/LaunchScreen';
import LeaderboardModal from './components/LeaderboardModal';
import { useBattleLogic } from './hooks/useBattleLogic';
import './css/App.css';

const App = () => {
  const [isLaunchModalOpen, setIsLaunchModalOpen] = useState(false);
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState(false);
  const [gameConfig, setGameConfig] = useState(null);
  const [theme, setTheme] = useState('dark');

  useEffect(() => {
    document.body.className = `${theme}-theme`;
  }, [theme]);

  const {
    telemetry,
    bots,
    gameState,
    winner,
  } = useBattleLogic('ws://127.0.0.1:8765');

  if (!bots || bots.length < 2) return null;

  const [rangeBot, tankBot] = bots;

  return (
    <div className="app-container">
      <Header
        sensorData={telemetry}
        onStartClick={() => setIsLaunchModalOpen(true)}
        onLeaderboardClick={() => setIsLeaderboardOpen(true)}
        theme={theme}
        onToggleTheme={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')}
      />

      {isLaunchModalOpen && (
        <LaunchScreen
          onClose={() => setIsLaunchModalOpen(false)}
          onLaunch={(config) => {
            setGameConfig(config);
            setIsLaunchModalOpen(false);
          }}
        />
      )}

      {isLeaderboardOpen && (
        <LeaderboardModal onClose={() => setIsLeaderboardOpen(false)} />
      )}

      {gameState === 'GAMEOVER' && (
        <div className="game-over-overlay">
          <div className="overlay-content">
            <h1 className="over-title">GAME OVER</h1>
            <p className="winner-name">{winner} Wins!</p>
            <span className="reset-text">System Reset in 5s...</span>
          </div>
        </div>
      )}

      <main className="battle-layout">
        <aside className="side-panel">
          <BotCard botData={rangeBot} />
        </aside>
        <section className="arena-center">
          <Arena bots={bots} />
        </section>
        <aside className="side-panel">
          <BotCard botData={tankBot} />
        </aside>
      </main>
    </div>
  );
};

export default App;
