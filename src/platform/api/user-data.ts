import { encrypt } from '../core/secrets/safeStorage';
import { getRuntime } from '../runtime';

export const userData = {
  getUserData: async (): Promise<UserData> => getRuntime().getUserData(),
  saveUserData: async (dataType: UserDataTypes, data: unknown): Promise<unknown> => {
    // The Electron build encrypted the plaintext Musixmatch token on save;
    // the runtime stores the ciphertext, and the lyrics core decrypts it.
    if (dataType === 'customMusixmatchUserToken' && typeof data === 'string') {
      const encryptedToken = await encrypt(data);
      return getRuntime().saveUserData(dataType, encryptedToken);
    }
    return getRuntime().saveUserData(dataType, data);
  }
};
