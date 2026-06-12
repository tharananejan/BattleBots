export const SOUNDS = {
  battleBegins: '/audio/battle_begins.mp3',
  rangeBotUltimate: '/audio/range_bot_ultimate.mp3',
  tankBotUltimate: '/audio/tank_bot_ultimate.mp3',
  rangeBotWins: '/audio/range_bot_wins.mp3',
  tankBotWins: '/audio/tank_bot_wins.mp3',
  tankBotAutomation: '/audio/tank_bot_automation.mp3',
};

const audioCache = new Map();
let unlocked = false;

function getAudio(path) {
  if (!audioCache.has(path)) {
    const audio = new Audio(path);
    audio.preload = 'auto';
    audioCache.set(path, audio);
  }
  return audioCache.get(path);
}

/** Call during a user gesture so delayed playback is allowed later. */
export function unlockAudio() {
  if (unlocked) return Promise.resolve(true);

  unlocked = true;

  Object.values(SOUNDS).forEach((path) => {
    getAudio(path).load();
  });

  return Promise.resolve(true);
}

export function playSound(path) {
  if (!path) return;

  const audio = getAudio(path);
  audio.currentTime = 0;
  audio.play().catch((err) => {
    console.warn('[soundEffects] playback failed:', path, err?.message ?? err);
  });
}
