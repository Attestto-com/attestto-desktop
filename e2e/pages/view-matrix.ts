/**
 * The core views the smoke/UX pass covers. Adding a view later = add a row
 * here plus its `data-testid` root — no new spec file. Order starts at
 * `/settings` because `/` redirects there after unlock.
 */
export const CORE_VIEWS = [
  { name: 'settings', hash: '#/settings', testid: 'view-settings-root' },
  { name: 'identity', hash: '#/identity', testid: 'view-identity-root' },
  { name: 'credentials', hash: '#/credentials', testid: 'view-credentials-root' },
  { name: 'pdf', hash: '#/pdf', testid: 'view-pdf-root' },
  { name: 'cedula', hash: '#/verify/cr/cedula', testid: 'view-cedula-root' },
] as const
