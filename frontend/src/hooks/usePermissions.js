import useAuthStore from "../store/auth.store";

// Permission definitions matching backend seed
const ROLE_PERMISSIONS = {
  PLATFORM_ADMIN: ["manage_workspaces", "view_all", "suspend_workspace", "manage_platform",
                   "manage_members", "manage_portfolios", "manage_strategies", "execute_trades"],
  ACCOUNT_ADMIN:  ["manage_members", "manage_portfolios", "manage_strategies",
                   "view_all", "execute_trades"],
  TRADER:         ["view_signals", "execute_trades", "view_positions", "view_portfolio", "view_all"],
  VIEWER:         ["view_signals", "view_positions", "view_portfolio", "view_all"],
};

export function usePermissions() {
  const role = useAuthStore(s => s.activeWorkspace?.role);

  const permissions = ROLE_PERMISSIONS[role] || [];

  const can = (permission) => permissions.includes(permission);

  return {
    role,
    can,
    canExecuteTrades:    can("execute_trades"),
    canManagePortfolios: can("manage_portfolios"),
    canManageMembers:    can("manage_members"),
    canViewAll:          can("view_all"),
    isAccountAdmin:      role === "ACCOUNT_ADMIN" || role === "PLATFORM_ADMIN",
    isTrader:            role === "TRADER" || role === "ACCOUNT_ADMIN" || role === "PLATFORM_ADMIN",
    isViewer:            role === "VIEWER",
  };
}
