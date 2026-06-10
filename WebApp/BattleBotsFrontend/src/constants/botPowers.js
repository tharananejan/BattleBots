/** Power definitions aligned with BattleGround / remote firmware */

import { DEFAULT_GAME_SETTINGS } from './gameSettings';

export const HALL_FREEZE_THRESHOLD = DEFAULT_GAME_SETTINGS.damage.hallFreezeThreshold;
export const TANK_FREEZE_DURATION_MS = DEFAULT_GAME_SETTINGS.damage.tankFreezeDurationMs;

function buildRangePowerDefs(settings = DEFAULT_GAME_SETTINGS) {
  const powers = settings.powers;
  return [
    {
      id: 'fan',
      name: 'Fan',
      icon: 'FAN',
      type: 'ultimate',
      isUltimate: true,
      activeMs: powers.fan.activeMs,
      cooldownMs: powers.fan.cooldownMs,
    },
    {
      id: 'laser',
      name: 'Laser',
      icon: 'LSR',
      type: 'normal',
      isUltimate: false,
      activeMs: powers.laser.activeMs,
      cooldownMs: powers.laser.cooldownMs,
    },
    {
      id: 'dodge',
      name: 'Dodge',
      icon: 'DDG',
      type: 'normal',
      isUltimate: false,
      activeMs: powers.dodge.activeMs,
      cooldownMs: powers.dodge.cooldownMs,
    },
  ];
}

function buildTankPowerDefs(settings = DEFAULT_GAME_SETTINGS) {
  const powers = settings.powers;
  return [
    {
      id: 'humidifier',
      name: 'Humidifier',
      icon: 'HUM',
      type: 'ultimate',
      isUltimate: true,
      activeMs: powers.humidifier.activeMs,
      cooldownMs: powers.humidifier.cooldownMs,
    },
    {
      id: 'hammer',
      name: 'Hammer',
      icon: 'HMR',
      type: 'normal',
      isUltimate: false,
      activeMs: powers.hammer.activeMs,
      cooldownMs: powers.hammer.cooldownMs,
    },
  ];
}

export const RANGE_BOT_POWER_DEFS = buildRangePowerDefs();
export const TANK_BOT_POWER_DEFS = buildTankPowerDefs();

export function createUltimatePowerState(def) {
  return {
    id: def.id,
    name: def.name,
    icon: def.icon,
    type: 'ultimate',
    isUltimate: true,
    status: 'ready',
    activeRemainingMs: 0,
    cooldownRemainingMs: 0,
    activeMs: def.activeMs,
    cooldownMs: def.cooldownMs,
  };
}

export function createNormalPowerState(def) {
  return {
    id: def.id,
    name: def.name,
    icon: def.icon,
    type: 'normal',
    isUltimate: false,
    status: 'off',
  };
}

export function initRangePowers(settings = DEFAULT_GAME_SETTINGS) {
  return buildRangePowerDefs(settings).map((def) =>
    def.type === 'ultimate'
      ? createUltimatePowerState(def)
      : createNormalPowerState(def)
  );
}

export function initTankPowers(settings = DEFAULT_GAME_SETTINGS) {
  return buildTankPowerDefs(settings).map((def) =>
    def.type === 'ultimate'
      ? createUltimatePowerState(def)
      : createNormalPowerState(def)
  );
}

export function applyPowerTimings(powers, settings = DEFAULT_GAME_SETTINGS) {
  const defs = [...buildRangePowerDefs(settings), ...buildTankPowerDefs(settings)];
  const defMap = Object.fromEntries(defs.map((def) => [def.id, def]));

  return powers.map((power) => {
    const def = defMap[power.id];
    if (!def) return power;

    if (power.type === 'ultimate') {
      return {
        ...power,
        activeMs: def.activeMs,
        cooldownMs: def.cooldownMs,
      };
    }

    return {
      ...power,
      activeMs: def.activeMs,
      cooldownMs: def.cooldownMs,
    };
  });
}

/** Ultimate powers first, then normal powers */
export function sortPowersForDisplay(powers) {
  return [...powers].sort((a, b) => {
    if (a.isUltimate === b.isUltimate) return 0;
    return a.isUltimate ? -1 : 1;
  });
}
