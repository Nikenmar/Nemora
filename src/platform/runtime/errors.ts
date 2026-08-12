export class RuntimeNotHydratedError extends Error {
  constructor() {
    super('Nemora runtime was read before hydrateRuntime() completed');
    this.name = 'RuntimeNotHydratedError';
  }
}
