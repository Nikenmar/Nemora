import { getBuildEnvVariable } from '../buildEnv';
import type { NetworkRepository } from '../repository';

const getLastFmAuthData = async (repository: NetworkRepository) => {
  const userData = repository.getUserData();

  const encryptedSessionKey = userData.lastFmSessionData?.key;
  if (!encryptedSessionKey) throw new Error('Encrypted LastFM Session Key not found');
  const SESSION_KEY = await repository.decrypt(encryptedSessionKey);

  const LAST_FM_API_KEY = getBuildEnvVariable('MAIN_VITE_LAST_FM_API_KEY');
  if (!LAST_FM_API_KEY) throw new Error('LastFM api key not found.');

  const LAST_FM_SHARED_SECRET = getBuildEnvVariable('MAIN_VITE_LAST_FM_SHARED_SECRET');
  if (!LAST_FM_SHARED_SECRET) throw new Error('LastFM shared secret key not found.');

  return { LAST_FM_API_KEY, SESSION_KEY, LAST_FM_SHARED_SECRET };
};

export default getLastFmAuthData;
