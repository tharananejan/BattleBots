import { useState, useEffect, useRef, useCallback } from 'react';
import {
  HALL_FREEZE_THRESHOLD,
  TANK_FREEZE_DURATION_MS,
  initRangePowers,
  initTankPowers,
} from '../constants/botPowers';

const INITIAL_POSITIONS = {
  red: { x: 120, y: 240 },
  blue: { x: 360, y: 240 },
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
  connected: false,
};

const TICK_MS = 100;

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
  const [rangePowers, setRangePowers] = useState(initRangePowers);
  const [tankPowers, setTankPowers] = useState(initTankPowers);
  const [tankMode, setTankMode] = useState('Manual');
  const [tankFrozenUntil, setTankFrozenUntil] = useState(0);
  const [gameState, setGameState] = useState('ACTIVE');
  const [winner, setWinner] = useState(null);

  const hasDeductedRef = useRef(false);
  const isLockedRef = useRef(false);
  const hallFreezeTriggeredRef = useRef(false);
  const FRAME_SIZE = 480;

  const applyTankFreeze = useCallback((durationMs = TANK_FREEZE_DURATION_MS) => {
    setTankFrozenUntil(Date.now() + durationMs);
  }, []);

  const resetGame = useCallback(() => {
    isLockedRef.current = true;
    hallFreezeTriggeredRef.current = false;

    setTelemetry((prev) => ({
      ...initialTelemetry,
      connected: prev.connected,
    }));
    setRangeBotHealth(100);
    setRangePowers(initRangePowers());
    setTankPowers(initTankPowers());
    setTankMode('Manual');
    setTankFrozenUntil(0);
    setGameState('ACTIVE');
    setWinner(null);
    hasDeductedRef.current = false;

    setTimeout(() => {
      isLockedRef.current = false;
    }, 1500);
  }, []);

  const rangeBotHealthRef = useRef(rangeBotHealth);
  useEffect(() => {
    rangeBotHealthRef.current = rangeBotHealth;
  }, [rangeBotHealth]);

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
    socket.onmessage = (event) => {
      if (isLockedRef.current) return;

      try {
        const data = JSON.parse(event.data);
        setTelemetry((prev) => ({ ...prev, ...data }));

        if (data.isAutomatedMode !== undefined) {
          setTankMode(data.isAutomatedMode ? 'Auto' : 'Manual');
        }

        if (data.hall !== undefined) {
          const hallValue = Number(data.hall);
          if (
            hallValue < HALL_FREEZE_THRESHOLD &&
            !hallFreezeTriggeredRef.current
          ) {
            hallFreezeTriggeredRef.current = true;
            applyTankFreeze(TANK_FREEZE_DURATION_MS);
          } else if (hallValue >= HALL_FREEZE_THRESHOLD) {
            hallFreezeTriggeredRef.current = false;
          }
        }

        if (data.d1 === 1 && gameState === 'ACTIVE') {
          if (!hasDeductedRef.current) {
            const newHealth = Math.max(0, rangeBotHealthRef.current - 50);
            setRangeBotHealth(newHealth);
            hasDeductedRef.current = true;
            if (newHealth <= 0) {
              setGameState('GAMEOVER');
              setWinner('Tank Bot');
            }
          }
        } else {
          hasDeductedRef.current = false;
        }
      } catch (err) {
        console.error(err);
      }
    };

    socket.onopen = () =>
      setTelemetry((prev) => ({ ...prev, connected: true }));
    socket.onclose = () =>
      setTelemetry((prev) => ({ ...prev, connected: false }));
    return () => socket.close();
  }, [url, gameState, applyTankFreeze]);

  useEffect(() => {
    if (gameState === 'GAMEOVER') {
      const timer = setTimeout(() => resetGame(), 5000);
      return () => clearTimeout(timer);
    }
  }, [gameState, resetGame]);

  const activateRangePower = useCallback(
    (powerId) => {
      if (gameState !== 'ACTIVE') return;

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
      if (gameState !== 'ACTIVE') return;

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
        currentHealth: 100,
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
  const powersDisabled = gameState !== 'ACTIVE';

  return {
    telemetry,
    bots,
    FRAME_SIZE,
    gameState,
    winner,
    powersDisabled,
    activateRangePower,
    activateTankPower,
    isTankFrozen,
  };
};
