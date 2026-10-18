export class NotPortedYetError extends Error {
  readonly channel: string;

  constructor(channel: string) {
    super(`The legacy IPC channel "${channel}" has not been ported yet.`);
    this.name = 'NotPortedYetError';
    this.channel = channel;
  }
}

export const notPortedVoid = <Args extends unknown[]>(channel: string) => {
  return (..._args: Args): void => {
    throw new NotPortedYetError(channel);
  };
};

export const notPortedAsync = <Args extends unknown[], Result>(channel: string) => {
  return (..._args: Args): Promise<Result> => Promise.reject(new NotPortedYetError(channel));
};
