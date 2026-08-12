import type { GeometryRepository } from './geometry';
import type { PhysicalRect } from './types';

export interface ShellUserDataPort {
  getUserData(): UserData;
  saveUserData(path: UserDataTypes, value: unknown): void;
}

const modeKeys = {
  normal: { position: 'mainWindow', dimensions: 'mainWindow' },
  mini: { position: 'miniPlayer', dimensions: 'miniPlayer' }
} as const;

export function createGeometryRepository(userData: ShellUserDataPort): GeometryRepository {
  return {
    load: (mode) => {
      const data = userData.getUserData();
      const keys = modeKeys[mode];
      const position = data.windowPositions[keys.position];
      const dimensions = data.windowDiamensions[keys.dimensions];
      if (!position || !dimensions) return undefined;
      return {
        x: position.x,
        y: position.y,
        width: dimensions.x,
        height: dimensions.y
      } satisfies PhysicalRect;
    },
    save: (mode, rect) => {
      const keys = modeKeys[mode];
      userData.saveUserData(`windowPositions.${keys.position}`, { x: rect.x, y: rect.y });
      userData.saveUserData(`windowDiamensions.${keys.dimensions}`, {
        x: rect.width,
        y: rect.height
      });
    },
    miniPlayerAlwaysOnTop: () => userData.getUserData().preferences.isMiniPlayerAlwaysOnTop ?? false
  };
}

