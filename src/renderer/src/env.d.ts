import type { HeardApi } from '../../shared/api'

declare global {
  interface Window {
    api: HeardApi
  }
}

export {}
