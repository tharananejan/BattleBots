/** Damage rules aligned with BattleGroundv2.ino */

import { DEFAULT_GAME_SETTINGS } from './gameSettings';

export const RANGE_DAMAGE = DEFAULT_GAME_SETTINGS.damage.rangePiezoIr;
export const RANGE_HUMIDITY_DAMAGE = DEFAULT_GAME_SETTINGS.damage.rangeHumidity;
export const TANK_LASER_DAMAGE = DEFAULT_GAME_SETTINGS.damage.tankLaser;
export const TANK_LASER_GRID_DAMAGE = DEFAULT_GAME_SETTINGS.damage.tankLaserGrid;
export const TANK_IR_DAMAGE = DEFAULT_GAME_SETTINGS.damage.tankIr;
export const PIEZO_HIT_THRESHOLD = DEFAULT_GAME_SETTINGS.damage.piezoHitThreshold;

export function buildTankSensorMap(settings = DEFAULT_GAME_SETTINGS) {
  const damage = settings.damage;
  return [
    {
      key: 'd1',
      label: 'Laser Beam',
      description: 'Tank laser integrity (1 = intact, 0 = broken)',
      isTriggered: (value) => value === 0,
      damageMethod: 'applyTankDamage (laser)',
      damageAmount: damage.tankLaser,
    },
    {
      key: 'ir1',
      label: 'IR Left',
      description: 'Tank left IR proximity sensor',
      isTriggered: (value) => value === 1,
      damageMethod: 'applyTankDamage (IR)',
      damageAmount: damage.tankIr,
    },
    {
      key: 'ir2',
      label: 'IR Right',
      description: 'Tank right IR proximity sensor',
      isTriggered: (value) => value === 1,
      damageMethod: 'applyTankDamage (IR)',
      damageAmount: damage.tankIr,
    },
    {
      key: 'hall',
      label: 'Hall Sensor',
      description: 'Magnetic field strength (freeze when below threshold)',
      isTriggered: (value) => value < damage.hallFreezeThreshold,
      damageMethod: 'Frontend freeze (not HP damage)',
      damageAmount: 0,
    },
    {
      key: 'm1',
      label: 'MPU Heading',
      description: 'Tank orientation in degrees',
      isTriggered: () => false,
      damageMethod: 'Telemetry only',
      damageAmount: 0,
    },
  ];
}

export const TANK_SENSOR_MAP = buildTankSensorMap();

export function buildRangeDamageSources(settings = DEFAULT_GAME_SETTINGS) {
  const damage = settings.damage;
  return [
    {
      id: 'piezo-ir',
      label: 'Piezo / IR Hit',
      method: 'applyRangeDamage',
      amount: damage.rangePiezoIr,
      sensors: `piezo > ${damage.piezoHitThreshold} OR ir1 OR ir2`,
    },
    {
      id: 'humidity',
      label: 'Humidifier Hit',
      method: 'applyRangeDamage (humidity)',
      amount: damage.rangeHumidity,
      sensors: 'humidityHit flag from Range Bot',
    },
  ];
}

export const RANGE_DAMAGE_SOURCES = buildRangeDamageSources();

export const DEFAULT_DEBUG_DAMAGE = {
  rangePiezoIr: true,
  rangeHumidity: true,
  tankLaser: true,
  tankLaserGrid: true,
  tankIr: true,
};

export function buildDebugDamagePaths(settings = DEFAULT_GAME_SETTINGS) {
  const damage = settings.damage;
  return [
    {
      id: 'rangePiezoIr',
      label: 'Piezo / IR Hit',
      bot: 'Range Bot',
      botColor: 'red',
      flagKey: 'rangePiezoIr',
      damageAmount: damage.rangePiezoIr,
      method: 'applyRangeDamage',
    },
    {
      id: 'rangeHumidity',
      label: 'Humidifier Hit',
      bot: 'Range Bot',
      botColor: 'red',
      flagKey: 'rangeHumidity',
      damageAmount: damage.rangeHumidity,
      method: 'applyRangeDamage (humidity)',
    },
    {
      id: 'tankLaser',
      label: 'Laser Beam Break',
      bot: 'Tank Bot',
      botColor: 'blue',
      flagKey: 'tankLaser',
      damageAmount: damage.tankLaser,
      method: 'applyTankDamage (laser)',
    },
    {
      id: 'tankLaserGrid',
      label: 'Laser Grid Zone',
      bot: 'Tank Bot',
      botColor: 'blue',
      flagKey: 'tankLaserGrid',
      damageAmount: damage.tankLaserGrid,
      method: 'applyTankLaserGridDamage',
    },
    {
      id: 'tankIr',
      label: 'IR Proximity Hit',
      bot: 'Tank Bot',
      botColor: 'blue',
      flagKey: 'tankIr',
      damageAmount: damage.tankIr,
      method: 'applyTankDamage (IR)',
    },
  ];
}

export const DEBUG_DAMAGE_PATHS = buildDebugDamagePaths();

export function inferTankDamageCause(
  telemetry,
  damageAmount,
  settings = DEFAULT_GAME_SETTINGS,
  options = {}
) {
  const damage = settings.damage;
  const { d1, ir1, ir2 } = telemetry;
  const { tankInLaserGrid = false } = options;
  const laserBroken = d1 === 0;
  const irSensors = [];
  if (ir1 === 1) irSensors.push('ir1');
  if (ir2 === 1) irSensors.push('ir2');
  const irActive = irSensors.length > 0;

  if (tankInLaserGrid && damageAmount >= damage.tankLaserGrid) {
    return {
      source: 'Laser Grid Zone',
      method: 'applyTankLaserGridDamage',
      sensors: ['blue_x, blue_y (position overlap)'],
    };
  }

  // Priority 1: active sensor state (works even when HP clamps or hits batch)
  if (laserBroken && irActive) {
    const batched = damageAmount >= damage.tankLaser + damage.tankIr;
    return {
      source: batched ? 'Laser + IR (batched)' : 'Laser Beam (+ IR active)',
      method: 'applyTankDamage',
      sensors: ['d1 (laserValue = 0)', ...irSensors],
    };
  }

  if (laserBroken) {
    return {
      source: 'Laser Beam',
      method: 'applyTankDamage',
      sensors: ['d1 (laserValue = 0)'],
    };
  }

  if (irActive) {
    return {
      source: 'IR Proximity',
      method: 'applyTankDamage',
      sensors: irSensors,
    };
  }

  // Priority 2: amount-based fallback when sensors already cleared
  if (damageAmount >= 8) {
    return {
      source: 'Laser Beam (inferred from amount)',
      method: 'applyTankDamage',
      sensors: ['d1'],
    };
  }

  if (damageAmount >= damage.tankIr) {
    return {
      source: 'IR Proximity (inferred from amount)',
      method: 'applyTankDamage',
      sensors: ['ir1', 'ir2'],
    };
  }

  return {
    source: `Unknown (${damageAmount} HP — no active tank sensors)`,
    method: 'applyTankDamage',
    sensors: [],
  };
}

export function inferRangeDamageCause(damageAmount, tankPowers, settings = DEFAULT_GAME_SETTINGS) {
  const damage = settings.damage;
  const humidifierActive = tankPowers?.find((p) => p.id === 'humidifier')?.status === 'running';

  // Priority 1: humidifier power state
  if (humidifierActive) {
    return {
      source: damageAmount >= damage.rangeHumidity * 2
        ? 'Humidifier (multiple hits)'
        : 'Humidifier',
      method: 'applyRangeDamage (humidity)',
      sensors: ['humidityHit (Range Bot)'],
    };
  }

  // Priority 2: any HP loss without humidifier → piezo/IR path
  if (damageAmount > 0) {
    return {
      source: damageAmount >= damage.rangePiezoIr * 2
        ? 'Piezo / IR (multiple hits)'
        : 'Piezo / IR Hit',
      method: 'applyRangeDamage',
      sensors: ['piezo', 'ir1', 'ir2 (Range Bot — not streamed)'],
    };
  }

  return {
    source: 'Unknown (0 HP change)',
    method: 'applyRangeDamage',
    sensors: [],
  };
}
