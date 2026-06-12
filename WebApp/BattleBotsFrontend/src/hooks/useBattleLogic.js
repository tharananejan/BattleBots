import { useState, useEffect, useRef, useCallback } from 'react';
import {
  initRangePowers,
  initTankPowers,
  applyPowerTimings,
} from '../constants/botPowers';
import { DEFAULT_DEBUG_DAMAGE } from '../constants/damageRules';
import { isPointInLaserBand } from '../constants/laserGrid';
import {
  DEFAULT_GAME_SETTINGS,
  mergeGameSettings,
  patchGameSettings,
} from '../constants/gameSettings';

const INITIAL_POSITIONS = {
  red: { x: 180, y: 360 },
  blue: { x: 540, y: 360 },
};

const initialTelemetry = {
  d1: 0,
  m1: 0,
  ir1: 0,
  ir2: 0,
  hall: 9999,
  blue_x: INITIAL_POSITIONS.blue.x,
  blue_y: INITIAL_POSITIONS.blue.y,
  red_x: INITIAL_POSITIONS.red.x,
  red_y: INITIAL_POSITIONS.red.y,
  calib_x: null,
  calib_y: null,
  connected: false,
};

const INITIAL_CALIBRATION = {
  calibrationMode: false,
  corners: {
    top_left: false,
    top_right: false,
    bottom_right: false,
    bottom_left: false,
  },
  homographyReady: false,
  lastError: null,
  lastMessage: null,
};

const TICK_MS = 100;

const RANGE_POWER_IDS = new Set(['fan', 'laser', 'dodge']);
const TANK_POWER_IDS = new Set(['humidifier', 'hammer']);

function tickUltimatePowers(powers) {
  let changed = false;

  const next = powers.map((p) => {
    if (p.type !== 'ultimate') return p;

    let { activeRemainingMs, cooldownRemainingMs, status } = p;

    if (activeRemainingMs <= 0 && cooldownRemainingMs <= 0) {
      return status === 'ready' ? p : { ...p, status: 'ready' };
    }

    const prevActive = activeRemainingMs;
    const prevCooldown = cooldownRemainingMs;

    if (activeRemainingMs > 0) {
      activeRemainingMs = Math.max(0, activeRemainingMs - TICK_MS);
    }
    if (cooldownRemainingMs > 0) {
      cooldownRemainingMs = Math.max(0, cooldownRemainingMs - TICK_MS);
    }

    if (
      activeRemainingMs === prevActive &&
      cooldownRemainingMs === prevCooldown
    ) {
      return p;
    }

    changed = true;

    if (cooldownRemainingMs <= 0) {
      status = 'ready';
    } else if (activeRemainingMs > 0) {
      status = 'running';
    } else {
      status = 'cooldown';
    }

    return {
      ...p,
      activeRemainingMs,
      cooldownRemainingMs,
      status,
    };
  });

  return changed ? next : powers;
}

function activateUltimatePower(powers, powerId) {
  const index = powers.findIndex((p) => p.id === powerId);
  if (index === -1) return powers;

  const power = powers[index];
  if (power.type !== 'ultimate' || power.status !== 'ready') return powers;

  const next = [...powers];
  next[index] = {
    ...power,
    status: 'running',
    activeRemainingMs: power.activeMs,
    cooldownRemainingMs: power.cooldownMs,
  };
  return next;
}

function toggleNormalPower(powers, powerId) {
  const index = powers.findIndex((p) => p.id === powerId);
  if (index === -1) return powers;

  const power = powers[index];
  if (power.type !== 'normal') return powers;

  const next = [...powers];
  next[index] = {
    ...power,
    status: power.status === 'on' ? 'off' : 'on',
  };
  return next;
}

export const useBattleLogic = (url) => {
  const [telemetry, setTelemetry] = useState(initialTelemetry);
  const [rangeBotHealth, setRangeBotHealth] = useState(100);
  const [tankBotHealth, setTankBotHealth] = useState(100);
  const [rangePowers, setRangePowers] = useState(initRangePowers);
  const [tankPowers, setTankPowers] = useState(initTankPowers);
  const [tankMode, setTankMode] = useState('Manual');
  const [tankFrozenUntil, setTankFrozenUntil] = useState(0);
  const [gameState, setGameState] = useState('ACTIVE');
  const [battleStarted, setBattleStarted] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [winner, setWinner] = useState(null);
  const [debugDamage, setDebugDamage] = useState(DEFAULT_DEBUG_DAMAGE);
  const [gameSettings, setGameSettings] = useState(DEFAULT_GAME_SETTINGS);
  const [calibration, setCalibration] = useState(INITIAL_CALIBRATION);
  const [tankInLaserGrid, setTankInLaserGrid] = useState(false);

  const isLockedRef = useRef(false);
  const hallFreezeTriggeredRef = useRef(false);
  const battleStartedRef = useRef(false);
  const testModeRef = useRef(false);
  const gameSettingsRef = useRef(DEFAULT_GAME_SETTINGS);
  const FRAME_SIZE = 720;

  const socketRef = useRef(null);

  const isCombatActive = () => battleStartedRef.current || testModeRef.current;

  const applyTankFreeze = useCallback((durationMs) => {
    const freezeMs =
      durationMs ?? gameSettingsRef.current.damage.tankFreezeDurationMs;
    setTankFrozenUntil(Date.now() + freezeMs);
  }, []);

  const resetGame = useCallback(() => {
    isLockedRef.current = true;
    hallFreezeTriggeredRef.current = false;

    setTelemetry((prev) => ({
      ...initialTelemetry,
      connected: prev.connected,
    }));
    setRangeBotHealth(100);
    setTankBotHealth(100);
    setRangePowers(initRangePowers(gameSettingsRef.current));
    setTankPowers(initTankPowers(gameSettingsRef.current));
    setTankMode('Manual');
    setTankFrozenUntil(0);
    setTankInLaserGrid(false);
    setBattleStarted(false);
    setGameState('ACTIVE');
    setWinner(null);
    setTimeout(() => {
      isLockedRef.current = false;
    }, 1500);
  }, []);

  const gameStateRef = useRef(gameState);
  const activateRangePowerRef = useRef(null);
  const activateTankPowerRef = useRef(null);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    battleStartedRef.current = battleStarted;
  }, [battleStarted]);

  useEffect(() => {
    testModeRef.current = testMode;
  }, [testMode]);

  useEffect(() => {
    gameSettingsRef.current = gameSettings;
  }, [gameSettings]);

  useEffect(() => {
    setRangePowers((prev) => applyPowerTimings(prev, gameSettings));
    setTankPowers((prev) => applyPowerTimings(prev, gameSettings));
  }, [gameSettings]);

  useEffect(() => {
    const interval = setInterval(() => {
      setRangePowers((prev) => {
        const next = tickUltimatePowers(prev);
        return next === prev ? prev : next;
      });
      setTankPowers((prev) => {
        const next = tickUltimatePowers(prev);
        return next === prev ? prev : next;
      });
      setTankFrozenUntil((until) => {
        if (until > 0 && Date.now() >= until) return 0;
        return until;
      });
    }, TICK_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (gameState === 'GAMEOVER') return;

    const socket = new WebSocket(url);
    socketRef.current = socket;

    socket.onmessage = (event) => {
      if (isLockedRef.current) return;

      try {
        const data = JSON.parse(event.data);

        if (data.type === 'GAME_SETTINGS' && data.settings) {
          setGameSettings(mergeGameSettings(data.settings));
          return;
        }

        if (data.type === 'CALIBRATION_STATUS') {
          setCalibration((prev) => ({
            ...prev,
            calibrationMode: Boolean(data.calibration_mode),
            corners: data.corners || prev.corners,
            homographyReady: Boolean(data.homography_ready),
            lastError: null,
          }));
          return;
        }

        if (data.type === 'CALIBRATION_POINT_CAPTURED') {
          setCalibration((prev) => ({
            ...prev,
            corners: {
              ...prev.corners,
              [data.corner]: true,
            },
            lastMessage: `Captured ${String(data.corner).replace(/_/g, ' ')}`,
            lastError: null,
          }));
          return;
        }

        if (data.type === 'CALIBRATION_FINISHED') {
          setCalibration((prev) => ({
            ...prev,
            calibrationMode: false,
            homographyReady: true,
            lastMessage: 'Calibration complete — bird\'s-eye view active',
            lastError: null,
          }));
          return;
        }

        if (data.type === 'CALIBRATION_RESET') {
          setCalibration({
            ...INITIAL_CALIBRATION,
            lastMessage: 'Calibration reset',
          });
          return;
        }

        if (data.type === 'CALIBRATION_ERROR') {
          setCalibration((prev) => ({
            ...prev,
            lastError: data.message || 'Calibration error',
          }));
          return;
        }

        if (data.power_activated) {
          const powerId = data.power_activated;
          if (gameStateRef.current === 'ACTIVE' && isCombatActive()) {
            if (RANGE_POWER_IDS.has(powerId)) {
              activateRangePowerRef.current?.(powerId);
            } else if (TANK_POWER_IDS.has(powerId)) {
              activateTankPowerRef.current?.(powerId);
            }
          }
          return;
        }

        const { power_activated: _ignored, type: _type, settings: _settings, ...telemetryUpdate } = data;
        setTelemetry((prev) => ({ ...prev, ...telemetryUpdate }));

        if (data.debugDamage !== undefined) {
          setDebugDamage((prev) => ({ ...prev, ...data.debugDamage }));
        }

        if (data.isAutomatedMode !== undefined) {
          setTankMode(data.isAutomatedMode ? 'Auto' : 'Manual');
        }

        if (data.testMode !== undefined) {
          setTestMode(Boolean(data.testMode));
        }

        if (data.gameActive !== undefined) {
          setBattleStarted(Boolean(data.gameActive));
        }

        if (data.hall !== undefined && isCombatActive()) {
          const hallValue = Number(data.hall);
          const hallThreshold = gameSettingsRef.current.damage.hallFreezeThreshold;
          if (hallValue < hallThreshold && !hallFreezeTriggeredRef.current) {
            hallFreezeTriggeredRef.current = true;
            applyTankFreeze();
          } else if (hallValue >= hallThreshold) {
            hallFreezeTriggeredRef.current = false;
          }
        }

        if (data.rangeHealth !== undefined) {
          const rangeHp = Math.max(0, Math.min(100, Number(data.rangeHealth)));
          setRangeBotHealth(rangeHp);
          if (
            gameStateRef.current === 'ACTIVE' &&
            isCombatActive() &&
            rangeHp <= 0
          ) {
            setGameState('GAMEOVER');
            setWinner('Tank Bot');
          }
        }

        if (data.tankHealth !== undefined) {
          const tankHp = Math.max(0, Math.min(100, Number(data.tankHealth)));
          setTankBotHealth(tankHp);
          if (
            gameStateRef.current === 'ACTIVE' &&
            isCombatActive() &&
            tankHp <= 0
          ) {
            setGameState('GAMEOVER');
            setWinner('Range Bot');
          }
        }
      } catch (err) {
        console.error(err);
      }
    };

    socket.onopen = () =>
      setTelemetry((prev) => ({ ...prev, connected: true }));
    socket.onclose = () => {
      setTelemetry((prev) => ({ ...prev, connected: false }));
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };
    return () => socket.close();
  }, [url, gameState, applyTankFreeze]);

  const startBattle = useCallback(() => {
    setBattleStarted(true);
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'START_BATTLE' }));
    }
  }, []);

  const toggleTestMode = useCallback((enabled) => {
    setTestMode(enabled);
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({ type: 'SET_TEST_MODE', enabled })
      );
    }
  }, []);

  const setTankAutomatedMode = useCallback((isAuto) => {
    setTankMode(isAuto ? 'Auto' : 'Manual');
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({ type: 'SET_MODE', isAutomatedMode: isAuto })
      );
    }
  }, []);

  const sendDebugDamage = useCallback((flags) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'DEBUG_DAMAGE', ...flags }));
    }
  }, []);

  const sendLaserGridHit = useCallback(() => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'LASER_GRID_HIT' }));
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (gameStateRef.current !== 'ACTIVE' || !isCombatActive()) {
        setTankInLaserGrid(false);
        return;
      }

      const laserRunning = rangePowers.some(
        (p) => p.id === 'laser' && p.status === 'running'
      );
      const inBand =
        laserRunning &&
        isPointInLaserBand(telemetry.blue_x, telemetry.blue_y, FRAME_SIZE);

      setTankInLaserGrid(inBand);

      if (inBand && debugDamage.tankLaserGrid !== false) {
        sendLaserGridHit();
      }
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [telemetry.blue_x, telemetry.blue_y, rangePowers, debugDamage, sendLaserGridHit]);

  const setDebugDamagePath = useCallback(
    (pathId, enabled) => {
      setDebugDamage((prev) => {
        const next = { ...prev, [pathId]: enabled };
        sendDebugDamage(next);
        return next;
      });
    },
    [sendDebugDamage]
  );

  const updateGameSettings = useCallback((partialSettings) => {
    setGameSettings((prev) => {
      const next = patchGameSettings(prev, partialSettings);
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(
          JSON.stringify({ type: 'UPDATE_SETTINGS', settings: next })
        );
      }
      return next;
    });
  }, []);

  const activatePowerManually = useCallback((powerId) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({ type: 'ACTIVATE_POWER', power: powerId })
      );
    }
  }, []);

  const sendCalibrationMessage = useCallback((payload) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(payload));
    }
  }, []);

  const setCalibrationMode = useCallback(
    (enabled) => {
      setCalibration((prev) => ({
        ...prev,
        calibrationMode: enabled,
        lastError: null,
        lastMessage: enabled
          ? 'Calibration mode enabled — place the range bot at each corner'
          : null,
      }));
      sendCalibrationMessage({ type: 'SET_CALIBRATION_MODE', enabled });
    },
    [sendCalibrationMessage]
  );

  useEffect(() => {
    if (gameState === 'GAMEOVER') {
      const timer = setTimeout(() => resetGame(), 5000);
      return () => clearTimeout(timer);
    }
  }, [gameState, resetGame]);

  const activateRangePower = useCallback(
    (powerId) => {
      if (gameState !== 'ACTIVE' || (!battleStartedRef.current && !testModeRef.current)) return;

      setRangePowers((prev) => {
        const power = prev.find((p) => p.id === powerId);
        if (!power) return prev;

        if (power.type === 'ultimate') {
          if (power.status !== 'ready') return prev;
          return activateUltimatePower(prev, powerId);
        }

        return toggleNormalPower(prev, powerId);
      });
    },
    [gameState]
  );

  const activateTankPower = useCallback(
    (powerId) => {
      if (gameState !== 'ACTIVE' || (!battleStartedRef.current && !testModeRef.current)) return;

      setTankPowers((prev) => {
        const power = prev.find((p) => p.id === powerId);
        if (!power) return prev;

        if (power.type === 'ultimate') {
          if (power.status !== 'ready') return prev;
          return activateUltimatePower(prev, powerId);
        }

        return toggleNormalPower(prev, powerId);
      });
    },
    [gameState]
  );

  useEffect(() => {
    activateRangePowerRef.current = activateRangePower;
    activateTankPowerRef.current = activateTankPower;
  }, [activateRangePower, activateTankPower]);

  const isTankFrozen = tankFrozenUntil > Date.now();

  const getBots = () => {
    const isOver = gameState === 'GAMEOVER';
    const shouldShowHome = isOver || isLockedRef.current;

    return [
      {
        id: 'bot1',
        name: 'Range Bot',
        color: 'red',
        currentHealth: rangeBotHealth,
        maxHealth: 100,
        mode: 'Manual',
        powers: rangePowers,
        avatar: 'https://robohash.org/range-bot?set=set3',
        x: shouldShowHome ? INITIAL_POSITIONS.red.x : telemetry.red_x,
        y: shouldShowHome ? INITIAL_POSITIONS.red.y : telemetry.red_y,
      },
      {
        id: 'bot2',
        name: 'Tank Bot',
        color: 'blue',
        currentHealth: tankBotHealth,
        maxHealth: 100,
        mode: tankMode,
        powers: tankPowers,
        isFrozen: isTankFrozen,
        avatar: 'https://robohash.org/tank-bot?set=set3',
        x: shouldShowHome ? INITIAL_POSITIONS.blue.x : telemetry.blue_x,
        y: shouldShowHome ? INITIAL_POSITIONS.blue.y : telemetry.blue_y,
      },
    ];
  };

  const bots = getBots();

  return {
    telemetry,
    bots,
    FRAME_SIZE,
    gameState,
    winner,
    isTankFrozen,
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
    calibration,
    sendCalibrationMessage,
    setCalibrationMode,
    tankInLaserGrid,
  };
};
