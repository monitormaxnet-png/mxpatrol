export type ReportEntitlementFlag =
  | "checkpoint_reports"
  | "scan_investigations"
  | "device_reports"
  | "patrol_reports"
  | "incident_reports"
  | "site_analytics"
  | "scheduled_reports"
  | "custom_reports"
  | "multi_site_reports"
  | "api_reports";

export type ReportPackage = "basic" | "standard" | "professional" | "enterprise";

export const REPORT_PACKAGE_ENTITLEMENTS: Record<ReportPackage, ReportEntitlementFlag[]> = {
  basic: ["checkpoint_reports"],
  standard: ["checkpoint_reports", "scan_investigations", "device_reports", "scheduled_reports"],
  professional: ["checkpoint_reports", "scan_investigations", "device_reports", "patrol_reports", "incident_reports", "site_analytics", "scheduled_reports"],
  enterprise: ["checkpoint_reports", "scan_investigations", "device_reports", "patrol_reports", "incident_reports", "site_analytics", "scheduled_reports", "custom_reports", "multi_site_reports", "api_reports"],
};

export function hasReportEntitlement(packageName: string | null | undefined, flag: ReportEntitlementFlag) {
  const key = String(packageName ?? "enterprise").toLowerCase() as ReportPackage;
  return (REPORT_PACKAGE_ENTITLEMENTS[key] ?? REPORT_PACKAGE_ENTITLEMENTS.enterprise).includes(flag);
}