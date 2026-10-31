import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import log from '../utils/log';
import Button from './Button';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryStates {
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

const ErrorBoundaryFallbackUi = (props: ErrorBoundaryStates) => {
  const { t } = useTranslation();
  const { error, errorInfo } = props;

  return (
    <div className="flex h-full w-full flex-col items-center justify-center overflow-x-hidden text-ink">
      <span className="ms-icon mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface-2 text-[28px] text-ink-dim" aria-hidden>
            bug_report
          </span>
      <br />
      <h2>{t('common.somethingWentWrong')}</h2>
      {/*
        Shown to everyone, not only in development. The details were once gated
        behind `isInDevelopment` and then forced open with a literal `true`,
        which left the gate variable dangling as an unused binding. Keeping them
        visible is the deliberate choice: it matches the startup-failure screen
        in index.tsx, and a crash whose stack trace only exists in a devtools
        console is a crash nobody can report.
      */}
      <details
        style={{ whiteSpace: 'pre-wrap' }}
        className="mx-auto max-w-[80%] text-sm font-light select-text"
      >
        <summary className="cursor-pointer px-4 py-2 text-ink-dim select-none hover:text-ink">
          {t('common.details')}
        </summary>
        <p className="mt-2 rounded-panel bg-surface-2 p-4 text-small text-ink-dim select-text">
          {error && error.toString()}
          <br />
          {errorInfo?.componentStack}
        </p>
      </details>
      <div className="buttons-container">
        <Button
          variant="primary"
          className="!mr-0 mt-4"
          label={t('common.restartApp')}
          iconName="restart_alt"
          clickHandler={() => window.api.appControls.restartRenderer('error')}
        />
      </div>
    </div>
  );
};

// Error Boundary is written in Class Component because React Error boundaries currently only support on Class Components.
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryStates> {
  constructor(props: ErrorBoundaryProps | Readonly<ErrorBoundaryProps>) {
    super(props);
    this.state = { error: null, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Catch errors in any components below and re-render with error message
    this.setState({
      error,
      errorInfo
    });
    // You can also log error messages to an error reporting service here
    log(error, undefined, 'ERROR');
  }

  render() {
    if (this.state.errorInfo)
      return <ErrorBoundaryFallbackUi error={this.state.error} errorInfo={this.state.errorInfo} />;
    // Normally, just render children
    return this.props.children;
  }
}

export default ErrorBoundary;
