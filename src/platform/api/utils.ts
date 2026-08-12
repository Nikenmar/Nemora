const getExtension = (dir: string): string => {
  const match = dir.match(/(?<name>.+)\.(?<ext>[\w\d]+)(?<search>\?.+)?$/);
  return match?.groups?.ext ?? '';
};

const getBaseName = (dir: string): string => dir.split(/[/\\]/).filter(Boolean).at(-1) ?? '';

const removeDefaultAppProtocolFromFilePath = (filePath: string): string =>
  filePath.replace(/nora:[/\\]{1,2}localfiles[/\\]{1,2}|\?[\w+=\w+&?]+$/gm, '');

export const utils = {
  path: {
    join: (...args: string[]): string => args.join('/')
  },
  getExtension,
  getBaseName,
  removeDefaultAppProtocolFromFilePath
};
