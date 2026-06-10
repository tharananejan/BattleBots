/** Default game settings — fallbacks when backend config is unavailable */

export const DEFAULT_GAME_SETTINGS = {
  damage: {
    rangePiezoIr: 5,
    rangeHumidity: 5,
    tankLaser: 10,
    tankIr: 2,
    piezoHitThreshold: 200,
    damageDebounceMs: 400,
    hallFreezeThreshold: 100,
    tankFreezeDurationMs: 10000,
  },
  powers: {
    fan: { activeMs: 5000, cooldownMs: 10000 },
    laser: { activeMs: 5000, cooldownMs: 10000 },
    humidifier: { activeMs: 5000, cooldownMs: 10000 },
    hammer: { activeMs: 1500, cooldownMs: 1500 },
    dodge: { activeMs: 3000, cooldownMs: 5000 },
  },
};

function mergePowerSection(defaults, current, patch) {
  return Object.fromEntries(
    Object.keys(defaults).map((powerId) => [
      powerId,
      {
        ...defaults[powerId],
        ...(current?.[powerId] || {}),
        ...(patch?.[powerId] || {}),
      },
    ])
  );
}

export function mergeGameSettings(partial, base = DEFAULT_GAME_SETTINGS) {
  if (!partial) {
    return {
      damage: { ...base.damage },
      powers: mergePowerSection(base.powers, null, null),
    };
  }

  return {
    damage: { ...base.damage, ...(partial.damage || {}) },
    powers: mergePowerSection(base.powers, null, partial.powers),
  };
}

export function patchGameSettings(current, patch) {
  return {
    damage: { ...current.damage, ...(patch.damage || {}) },
    powers: mergePowerSection(DEFAULT_GAME_SETTINGS.powers, current.powers, patch.powers),
  };
}

/** Flatten settings for BattleGround serial SETTINGS payload */
export function toFirmwareSettings(settings) {
  const s = mergeGameSettings(settings);
  return {
    SETTINGS: true,
    rPi: s.damage.rangePiezoIr,
    rHum: s.damage.rangeHumidity,
    tLas: s.damage.tankLaser,
    tIr: s.damage.tankIr,
    pTh: s.damage.piezoHitThreshold,
    dDb: s.damage.damageDebounceMs,
    fanM: s.powers.fan.activeMs,
    lasM: s.powers.laser.activeMs,
    humM: s.powers.humidifier.activeMs,
    fanC: s.powers.fan.cooldownMs,
    lasC: s.powers.laser.cooldownMs,
    hmrM: s.powers.hammer.activeMs,
    hmrC: s.powers.hammer.cooldownMs,
  };
}

export const DAMAGE_SETTING_FIELDS = [
  { key: 'rangePiezoIr', label: 'Range Piezo / IR Hit', unit: 'HP', min: 0, max: 100, step: 1 },
  { key: 'rangeHumidity', label: 'Humidifier Hit (Range)', unit: 'HP', min: 0, max: 100, step: 1 },
  { key: 'tankLaser', label: 'Tank Laser Break', unit: 'HP', min: 0, max: 100, step: 1 },
  { key: 'tankIr', label: 'Tank IR Proximity', unit: 'HP', min: 0, max: 100, step: 1 },
  { key: 'piezoHitThreshold', label: 'Piezo Hit Threshold', unit: '', min: 0, max: 1024, step: 10 },
  { key: 'damageDebounceMs', label: 'Damage Debounce', unit: 'ms', min: 50, max: 5000, step: 50 },
  { key: 'hallFreezeThreshold', label: 'Hall Freeze Threshold', unit: '', min: 0, max: 500, step: 5 },
  {
    key: 'tankFreezeDurationMs',
    label: 'Tank Freeze Duration',
    unit: 'ms',
    min: 1000,
    max: 30000,
    step: 500,
  },
];

export const POWER_SETTING_FIELDS = [
  { id: 'fan', label: 'Fan (Ultimate)', bot: 'Range Bot', color: 'red' },
  { id: 'laser', label: 'Laser (Ultimate)', bot: 'Range Bot', color: 'red' },
  { id: 'dodge', label: 'Dodge', bot: 'Range Bot', color: 'red' },
  { id: 'humidifier', label: 'Humidifier (Ultimate)', bot: 'Tank Bot', color: 'blue' },
  { id: 'hammer', label: 'Hammer', bot: 'Tank Bot', color: 'blue' },
];
