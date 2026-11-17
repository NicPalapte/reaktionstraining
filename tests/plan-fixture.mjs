// Vorlagen aus plans/ laden (der Plan steht nicht mehr im Code)
import { readFileSync } from 'node:fs';
import { setPlan } from '../js/strength-plan.js';

export const readPlan = (name) => JSON.parse(readFileSync(new URL(`../plans/${name}.json`, import.meta.url), 'utf8'));
/** Bisher eingebauter Plan (Strukturtests), alternativ die aktuelle Vorlage. */
export const loadPlan = (name = 'wintertraining-26-27-alt') => setPlan(readPlan(name));
