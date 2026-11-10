import { getRuntime } from '../runtime';

export const userData = {
  getUserData: async (): Promise<UserData> => getRuntime().getUserData(),
  saveUserData: async (dataType: UserDataTypes, data: unknown): Promise<unknown> =>
    getRuntime().saveUserData(dataType, data)
};
