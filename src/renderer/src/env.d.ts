import type { SteveNolaApi } from '../../shared/api'

declare global {
  interface Window {
    api: SteveNolaApi
  }
}

export {}
