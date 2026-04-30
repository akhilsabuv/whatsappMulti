export const DASHBOARD_VIEWS = ['overview', 'users', 'api', 'keys', 'sessions', 'backups', 'settings'] as const;

export type DashboardView = (typeof DASHBOARD_VIEWS)[number];
