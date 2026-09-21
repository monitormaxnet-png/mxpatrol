import { MX_PDF_REPORT_TYPES } from './mxPdfReports';

export type ReportCategory = {
  label: string;
  action: string;
  ownerOnly?: boolean;
};

export type ReportMenu = {
  title: string;
  subtitle?: string;
  parent?: string;
  items: ReportCategory[];
};

export const REPORT_ROOT_ITEMS: ReportCategory[] = [
  ...MX_PDF_REPORT_TYPES.map(({ label, action }) => ({ label, action })),
  { label: 'Back', action: 'back' },
];

export const REPORT_SUBMENUS: Record<string, ReportMenu> = {};

export function reportRootItems(_isPlatformOwner: boolean): ReportCategory[] {
  return REPORT_ROOT_ITEMS;
}

export function reportMenuItems(key: string, isPlatformOwner: boolean): ReportCategory[] {
  if (key === 'user_reports' || key === 'management_reports') return reportRootItems(isPlatformOwner);
  return REPORT_SUBMENUS[key]?.items ?? [];
}

export function isDeviceSecurityReportAction(action: string): boolean {
  return action.startsWith('report:device_security:') || action === 'menu:reports_device_security';
}
