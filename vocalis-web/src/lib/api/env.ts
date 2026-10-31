/** Build-time switches. Mock mode is for demos and UI development only. */
export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === 'true'
export const API_URL: string = import.meta.env.VITE_API_URL ?? '/api/v1/product'
/** Where the classic UI lives. Leave empty to hide the switch. */
export const CLASSIC_URL: string = (import.meta.env.VITE_CLASSIC_URL ?? '').replace(/\/$/, '')

/** Where the app is served from, without a trailing slash ('' at the site root, '/new' under a path). */
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')
