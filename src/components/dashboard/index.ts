export { default as DashboardLayout } from "./DashboardLayout";
export { CLIENT_NAV, PROVIDER_NAV } from "./DashboardLayout";
export type { DashboardUser, NavItem } from "./DashboardLayout";

// Re-export NavItem as a distinct type name to avoid conflict with DashboardSidebar
import type { NavItem as SidebarNavItemType, ShortcutItem } from "./DashboardSidebar";
export type { SidebarNavItemType, ShortcutItem };
export { default as DashboardSidebar } from "./DashboardSidebar";

export { StatsCards, StatusTabs } from "./StatsCards";
export type { StatItem } from "./StatsCards";

export { SearchBar } from "./SearchBar";
export { default as MissionCard } from "./MissionCard";
export { default as MissionModal } from "./MissionModal";
export { Toasts } from "./Toasts";

export {
  STATUS_LABEL, STATUS_TABS, RISK_BADGE,
  type ApiMission, type Toast,
} from "./types";
