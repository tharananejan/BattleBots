import { useEffect, useRef } from 'react';
import { playSound, SOUNDS, unlockAudio } from '../utils/soundEffects';

function didUltimateActivate(prevPowers, currentPowers) {
  if (!prevPowers?.length || !currentPowers?.length) return false;

  return currentPowers.some((power) => {
    if (!power.isUltimate) return false;
    const prev = prevPowers.find((p) => p.id === power.id);
    return prev?.status !== 'running' && power.status === 'running';
  });
}

export function useSoundEffects({
  gameState,
  winner,
  tankMode,
  rangePowers,
  tankPowers,
}) {
  const prevGameStateRef = useRef(gameState);
  const prevTankModeRef = useRef(tankMode);
  const prevRangePowersRef = useRef(rangePowers);
  const prevTankPowersRef = useRef(tankPowers);

  useEffect(() => {
    const unlock = () => {
      unlockAudio().then((success) => {
        if (success) {
          window.removeEventListener('click', unlock);
          window.removeEventListener('keydown', unlock);
        }
      });
    };

    window.addEventListener('click', unlock);
    window.addEventListener('keydown', unlock);

    return () => {
      window.removeEventListener('click', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  useEffect(() => {
    if (tankMode === 'Auto' && prevTankModeRef.current !== 'Auto') {
      playSound(SOUNDS.tankBotAutomation);
    }
    prevTankModeRef.current = tankMode;
  }, [tankMode]);

  useEffect(() => {
    if (gameState === 'GAMEOVER' && prevGameStateRef.current !== 'GAMEOVER') {
      if (winner === 'Range Bot') {
        playSound(SOUNDS.rangeBotWins);
      } else if (winner === 'Tank Bot') {
        playSound(SOUNDS.tankBotWins);
      }
    }
    prevGameStateRef.current = gameState;
  }, [gameState, winner]);

  useEffect(() => {
    if (didUltimateActivate(prevRangePowersRef.current, rangePowers)) {
      playSound(SOUNDS.rangeBotUltimate);
    }
    prevRangePowersRef.current = rangePowers;
  }, [rangePowers]);

  useEffect(() => {
    if (didUltimateActivate(prevTankPowersRef.current, tankPowers)) {
      playSound(SOUNDS.tankBotUltimate);
    }
    prevTankPowersRef.current = tankPowers;
  }, [tankPowers]);
}
