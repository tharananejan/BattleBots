import React, { useState, useEffect, useCallback } from 'react';
import Header from './components/Header';
import BotCard from './components/BotCard';
import Arena from './components/Arena';
import LaunchScreen from './components/LaunchScreen';
import LeaderboardModal from './components/LeaderboardModal';
import DebugPage from './components/DebugPage';
import CameraFeedModal from './components/CameraFeedModal';
import { useBattleLogic } from './hooks/useBattleLogic';
import './css/App.css';

const App = () => {
  const [isLaunchModalOpen, setIsLaunchModalOpen] = useState(false);
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState(false);
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [isCameraFeedOpen, setIsCameraFeedOpen] = useState(false);
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
    startBattle,
    setTankAutomatedMode,
    debugDamage,
    setDebugDamagePath,
    battleStarted,
    testMode,
    toggleTestMode,
    gameSettings,
    updateGameSettings,
    activatePowerManually,
  } = useBattleLogic('ws://127.0.0.1:8765');

  const handleCloseLaunch = useCallback(() => {
    setIsLaunchModalOpen(false);
  }, []);

  const handleLaunch = useCallback(
    (config) => {
      setGameConfig(config);
      setTankAutomatedMode(config.tankMode === 'Auto');
      startBattle();
      setIsLaunchModalOpen(false);
    },
    [startBattle, setTankAutomatedMode]
  );

  const remoteTankMode =
    telemetry.isAutomatedMode === true
      ? 'Auto'
      : telemetry.isAutomatedMode === false
        ? 'Manual'
        : undefined;

  if (!bots || bots.length < 2) return null;

  const [rangeBot, tankBot] = bots;

  return (
    <div className="app-container">
      <Header
        sensorData={telemetry}
        onStartClick={() => setIsLaunchModalOpen(true)}
        onLeaderboardClick={() => setIsLeaderboardOpen(true)}
        onCameraClick={() => setIsCameraFeedOpen(true)}
        onDebugClick={() => setIsDebugOpen(true)}
        theme={theme}
        onToggleTheme={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')}
      />

      {isLaunchModalOpen && (
        <LaunchScreen
          onClose={handleCloseLaunch}
          onLaunch={handleLaunch}
          initialMode={remoteTankMode}
        />
      )}

      {isLeaderboardOpen && (
        <LeaderboardModal onClose={() => setIsLeaderboardOpen(false)} />
      )}

      {isCameraFeedOpen && (
        <CameraFeedModal
          gameSettings={gameSettings}
          updateGameSettings={updateGameSettings}
          onClose={() => setIsCameraFeedOpen(false)}
        />
      )}

      {isDebugOpen && (
        <DebugPage
          telemetry={telemetry}
          bots={bots}
          debugDamage={debugDamage}
          setDebugDamagePath={setDebugDamagePath}
          battleStarted={battleStarted}
          testMode={testMode}
          toggleTestMode={toggleTestMode}
          gameSettings={gameSettings}
          updateGameSettings={updateGameSettings}
          activatePowerManually={activatePowerManually}
          onClose={() => setIsDebugOpen(false)}
        />
      )}

      {gameState === 'GAMEOVER' && !isDebugOpen && (
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
