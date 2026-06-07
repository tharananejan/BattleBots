/** Damage rules aligned with BattleGroundv2.ino */

export const RANGE_DAMAGE = 5;
export const RANGE_HUMIDITY_DAMAGE = 5;
export const TANK_LASER_DAMAGE = 10;
export const TANK_IR_DAMAGE = 2;
export const PIEZO_HIT_THRESHOLD = 200;

export const TANK_SENSOR_MAP = [
  {
    key: 'd1',
    label: 'Laser Beam',
    description: 'Tank laser integrity (1 = intact, 0 = broken)',
    isTriggered: (value) => value === 0,
    damageMethod: 'applyTankDamage (laser)',
    damageAmount: TANK_LASER_DAMAGE,
  },
  {
    key: 'ir1',
    label: 'IR Left',
    description: 'Tank left IR proximity sensor',
    isTriggered: (value) => value === 1,
    damageMethod: 'applyTankDamage (IR)',
    damageAmount: TANK_IR_DAMAGE,
  },
  {
    key: 'ir2',
    label: 'IR Right',
    description: 'Tank right IR proximity sensor',
    isTriggered: (value) => value === 1,
    damageMethod: 'applyTankDamage (IR)',
    damageAmount: TANK_IR_DAMAGE,
  },
  {
    key: 'hall',
    label: 'Hall Sensor',
    description: 'Magnetic field strength (freeze when below threshold)',
    isTriggered: (value) => value < 100,
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

export const RANGE_DAMAGE_SOURCES = [
  {
    id: 'piezo-ir',
    label: 'Piezo / IR Hit',
    method: 'applyRangeDamage',
    amount: RANGE_DAMAGE,
    sensors: 'piezo > 200 OR ir1 OR ir2',
  },
  {
    id: 'humidity',
    label: 'Humidifier Hit',
    method: 'applyRangeDamage (humidity)',
    amount: RANGE_HUMIDITY_DAMAGE,
    sensors: 'humidityHit flag from Range Bot',
  },
];

export const DEFAULT_DEBUG_DAMAGE = {
  rangePiezoIr: true,
  rangeHumidity: true,
  tankLaser: true,
  tankIr: true,
};

export const DEBUG_DAMAGE_PATHS = [
  {
    id: 'rangePiezoIr',
    label: 'Piezo / IR Hit',
    bot: 'Range Bot',
    botColor: 'red',
    flagKey: 'rangePiezoIr',
    damageAmount: RANGE_DAMAGE,
    method: 'applyRangeDamage',
  },
  {
    id: 'rangeHumidity',
    label: 'Humidifier Hit',
    bot: 'Range Bot',
    botColor: 'red',
    flagKey: 'rangeHumidity',
    damageAmount: RANGE_HUMIDITY_DAMAGE,
    method: 'applyRangeDamage (humidity)',
  },
  {
    id: 'tankLaser',
    label: 'Laser Beam Break',
    bot: 'Tank Bot',
    botColor: 'blue',
    flagKey: 'tankLaser',
    damageAmount: TANK_LASER_DAMAGE,
    method: 'applyTankDamage (laser)',
  },
  {
    id: 'tankIr',
    label: 'IR Proximity Hit',
    bot: 'Tank Bot',
    botColor: 'blue',
    flagKey: 'tankIr',
    damageAmount: TANK_IR_DAMAGE,
    method: 'applyTankDamage (IR)',
  },
];

export function inferTankDamageCause(telemetry, damageAmount) {
  const { d1, ir1, ir2 } = telemetry;
  const laserBroken = d1 === 0;
  const irSensors = [];
  if (ir1 === 1) irSensors.push('ir1');
  if (ir2 === 1) irSensors.push('ir2');
  const irActive = irSensors.length > 0;

  // Priority 1: active sensor state (works even when HP clamps or hits batch)
  if (laserBroken && irActive) {
    const batched = damageAmount >= TANK_LASER_DAMAGE + TANK_IR_DAMAGE;
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

  if (damageAmount >= TANK_IR_DAMAGE) {
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

export function inferRangeDamageCause(damageAmount, tankPowers) {
  const humidifierActive = tankPowers?.find((p) => p.id === 'humidifier')?.status === 'running';

  // Priority 1: humidifier power state
  if (humidifierActive) {
    return {
      source: damageAmount >= RANGE_HUMIDITY_DAMAGE * 2
        ? 'Humidifier (multiple hits)'
        : 'Humidifier',
      method: 'applyRangeDamage (humidity)',
      sensors: ['humidityHit (Range Bot)'],
    };
  }

  // Priority 2: any HP loss without humidifier → piezo/IR path
  if (damageAmount > 0) {
    return {
      source: damageAmount >= RANGE_DAMAGE * 2
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
