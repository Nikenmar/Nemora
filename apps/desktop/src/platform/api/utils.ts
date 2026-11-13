const getExtension = (dir: string): string => {
  const match = dir.match(/(?<name>.+)\.(?<ext>[\w\d]+)(?<search>\?.+)?$/);
  return match?.groups?.ext ?? '';
};

const getBaseName = (dir: string): string => dir.split(/[/\\]/).filter(Boolean).at(-1) ?? '';

const removeDefaultAppProtocolFromFilePath = (filePath: string): string =>
  filePath.replace(/nora:[/\\]{1,2}localfiles[/\\]{1,2}|\?[\w+=\w+&?]+$/gm, '');

/**
 * The file behind a media URL the player plays (`http://nemora.localhost/<encoded path>`, view.rs
 * `asset_url`), read as Rust's `protocol::local_path_from_asset_url` reads it. Anything else is
 * returned as it is, so a plain path passes through.
 */
const localPathFromAssetUrl = (url: string): string => {
  const match = url.trim().match(/^https?:\/\/nemora\.localhost\/([^?#]*)/);
  if (!match) return url;
  try {
    return decodeURIComponent(match[1]).replace(/^localfiles\//, '');
  } catch {
    return url;
  }
};

export const utils = {
  path: {
    join: (...args: string[]): string => args.join('/')
  },
  getExtension,
  getBaseName,
  removeDefaultAppProtocolFromFilePath,
  localPathFromAssetUrl
};
