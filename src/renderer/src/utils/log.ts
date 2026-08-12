const log = (
  str: string | Error,
  data?: Record<string, unknown>,
  logToConsoleType: LogMessageTypes = 'INFO',
  forceWindowRestart = false,
  forceMainRestart = false
) => {
  let logType = logToConsoleType;
  let message: typeof str;
  const parsedData: Record<string, unknown> = {};

  if (str instanceof Error) {
    logType = 'ERROR';
    message = str;
  } else message = str;

  if (logType === 'INFO') console.log(message, data);
  if (logType === 'WARN') console.warn(message, data);
  if (logType === 'ERROR') console.error(message, data);

  if (data) {
    for (const [prop, val] of Object.entries(data)) {
      // Spreading an Error produces {}: name, message and stack are own but
      // NON-ENUMERABLE, so every error logged through here arrived in the log
      // file as `{"error":{}}` and told nobody anything. Copy the three fields
      // explicitly, and keep any custom ones the error carries.
      if (val instanceof Error)
        parsedData[prop] = {
          ...val,
          name: val.name,
          message: val.message,
          stack: val.stack
        };
      else parsedData[prop] = val;
    }
  }

  window.api.log.sendLogs(message, parsedData, logType, forceWindowRestart, forceMainRestart);
};

export default log;
