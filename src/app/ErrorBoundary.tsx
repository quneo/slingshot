import { Component, type ReactNode } from 'react'

interface State {
  error: Error | null
}

/** Last line of defence: a readable message and a way back instead of a blank screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="panel max-w-[420px] p-6 text-center">
          <h1 className="text-xl font-extrabold">Что-то сломалось</h1>
          <p className="mt-2 text-ink-2">
            Прогресс сохранён в браузере. Перезагрузите страницу, чтобы продолжить с выбора миссии.
          </p>
          <pre className="mt-3 max-h-24 overflow-auto rounded-lg bg-space/60 p-2 text-left text-[11px] text-ink-3">
            {this.state.error.message}
          </pre>
          <button
            className="mt-4 h-11 rounded-xl bg-go px-5 font-bold text-go-ink"
            onClick={() => window.location.reload()}
          >
            Перезагрузить
          </button>
        </div>
      </div>
    )
  }
}
