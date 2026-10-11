const KEY = 'tennis-reaktion-settings-v1';

export const DEFAULT_SETTINGS = {
  sound: true,
  voice: true,
  rounds: 6, // Durchgänge pro Satz (5-10-5)
  commandRounds: 12, // Befehle pro Satz
  decoyRounds: 16, // Aufgaben pro Satz (Kreuzvorhaben)
  minDelay: 1.5,
  maxDelay: 3.5,
  cmdLeft: true,
  cmdRight: true,
  cmdFront: true,
};

export function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* privater Modus o. Ä.: Einstellungen gelten dann nur für diese Sitzung */
  }
}

const CAL_KEY = 'tennis-reaktion-calibration-v1';
export function loadCalibration() {
  try {
    return JSON.parse(localStorage.getItem(CAL_KEY) || 'null');
  } catch {
    return null;
  }
}
export function saveCalibration(c) {
  try {
    localStorage.setItem(CAL_KEY, JSON.stringify(c));
  } catch {
    /* ignorieren */
  }
}
