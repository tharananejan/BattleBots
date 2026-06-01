/** Power definitions aligned with BattleGround / remote firmware */

export const HALL_FREEZE_THRESHOLD = 100;
export const TANK_FREEZE_DURATION_MS = 10000;

export const RANGE_BOT_POWER_DEFS = [
  {
    id: 'fan',
    name: 'Fan',
    icon: 'FAN',
    type: 'ultimate',
    isUltimate: true,
    activeMs: 5000,
    cooldownMs: 10000,
  },
  {
    id: 'laser',
    name: 'Laser',
    icon: 'LSR',
    type: 'normal',
    isUltimate: false,
  },
  {
    id: 'dodge',
    name: 'Dodge',
    icon: 'DDG',
    type: 'normal',
    isUltimate: false,
  },
];

export const TANK_BOT_POWER_DEFS = [
  {
    id: 'humidifier',
    name: 'Humidifier',
    icon: 'HUM',
    type: 'ultimate',
    isUltimate: true,
    activeMs: 5000,
    cooldownMs: 10000,
  },
  {
    id: 'hammer',
    name: 'Hammer',
    icon: 'HMR',
    type: 'normal',
    isUltimate: false,
  },
];

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

export function initRangePowers() {
  return RANGE_BOT_POWER_DEFS.map((def) =>
    def.type === 'ultimate'
      ? createUltimatePowerState(def)
      : createNormalPowerState(def)
  );
}

export function initTankPowers() {
  return TANK_BOT_POWER_DEFS.map((def) =>
    def.type === 'ultimate'
      ? createUltimatePowerState(def)
      : createNormalPowerState(def)
  );
}

/** Ultimate powers first, then normal powers */
export function sortPowersForDisplay(powers) {
  return [...powers].sort((a, b) => {
    if (a.isUltimate === b.isUltimate) return 0;
    return a.isUltimate ? -1 : 1;
  });
}
