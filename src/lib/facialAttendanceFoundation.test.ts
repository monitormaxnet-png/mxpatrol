import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';

const read = (path: string) => readFileSync(path, 'utf8');

describe('AI facial attendance foundation', () => {
  it('creates private attendance schema with review and idempotency controls', () => {
    const migration = read('supabase/migrations/20261009100000_ai_facial_attendance_foundation.sql');
    expect(migration).toContain('guard_biometric_enrollments');
    expect(migration).toContain('attendance_shifts');
    expect(migration).toContain('attendance_events');
    expect(migration).toContain('attendance_sessions');
    expect(migration).toContain('attendance_reviews');
    expect(migration).toContain("attendance-evidence', false");
    expect(migration).toContain('attendance_events_company_idempotency');
    const secretMigration = read('supabase/migrations/20261009103000_ttech_biometric_template_secrets.sql');
    expect(secretMigration).toContain('ttech_biometric_template_secrets');
    expect(secretMigration).toContain('enable row level security');
    expect(secretMigration).not.toContain('create policy');
    expect(migration).toContain("verification_status in ('pending','verified','unmatched','ambiguous','poor_quality','spoof_suspected','provider_unconfigured','failed','review_required')");
  });

  it('keeps device attendance provider gated and does not use general chat vision matching', () => {
    const fn = read('supabase/functions/device-attendance/index.ts');
    expect(fn).toContain('MXPATROL_BIOMETRIC_PROVIDER');
    expect(fn).toContain('MXPATROL_ALLOW_MOCK_BIOMETRICS');
    expect(fn).toContain('provider_unconfigured');
    expect(fn).toContain('attendance-evidence');
    expect(fn).toContain('idempotency_key');
    expect(fn).toContain('processTtechFaceJpeg');
    expect(fn).toContain('ttech_biometric_template_secrets');
    expect(fn).toContain('review_required');
    expect(fn).not.toContain('chat/completions');
    expect(fn).not.toContain('gemini');
    expect(fn).not.toContain('LOVABLE_API_KEY');
  });


  it('keeps TTECH biometric processing in server-side modules only', () => {
    expect(existsSync('src/lib/ttechNativeBiometrics.ts')).toBe(false);
    expect(existsSync('supabase/functions/_shared/ttechNativeBiometrics.ts')).toBe(true);
    expect(existsSync('supabase/functions/_shared/ttechImageProcessing.ts')).toBe(true);
    const enrollment = read('supabase/functions/ttech-biometric-enrollment/index.ts');
    expect(enrollment).toContain('processTtechFaceJpeg');
    expect(enrollment).toContain('ttech_biometric_template_secrets');
    expect(enrollment).toContain('Management access required');
  });
  it('adds attendance management to the Web AI Assistant without removing patrol features', () => {
    const menus = read('src/lib/assistantMenus.ts');
    const commandCenter = read('src/pages/CommandCenter.tsx');
    expect(menus).toContain('Attendance Management');
    expect(menus).toContain('management_attendance');
    expect(menus).toContain('attendance_overview');
    expect(menus).toContain('attendance_enrollment');
    expect(commandCenter).toContain('AttendanceFoundationPanel');
    expect(commandCenter).toContain('Patrol photo mode remains separate');
    expect(commandCenter).toContain('Production biometric identification is intentionally disabled');
  });

  it('adds isolated Phase 3 biometric testing and evaluation controls', () => {
    const migration = read('supabase/migrations/20261009110000_ttech_biometric_phase3_testing.sql');
    expect(migration).toContain('biometric_test_captures');
    expect(migration).toContain('biometric_threshold_evaluations');
    expect(migration).toContain('Managers can view biometric test captures');
    expect(migration).toContain('review_outcome');
    expect(migration).toContain('false_identification_rate');

    const deviceAttendance = read('supabase/functions/device-attendance/index.ts');
    expect(deviceAttendance).toContain('biometric_test_mode');
    expect(deviceAttendance).toContain('biometric_test_captures');
    expect(deviceAttendance).toContain('phase3Outcome');
    expect(deviceAttendance).not.toContain('verification_status: "verified"');

    const app = read('src/App.tsx');
    const incidentListener = read('src/components/devices/IncidentPhotoListener.tsx');
    const testListener = read('src/components/devices/BiometricTestCaptureListener.tsx');
    expect(app).toContain('BiometricTestCaptureListener');
    expect(incidentListener).toContain('isBiometricTestModeActive');
    expect(testListener).toContain('CAPTURING');
    expect(testListener).toContain('ANALYZING');
    expect(testListener).toContain('MATCH CANDIDATE');
    expect(testListener).toContain('NO MATCH');
    expect(testListener).toContain('REVIEW REQUIRED');
    expect(testListener).toContain('OFFLINE QUEUED');

    const commandCenter = read('src/pages/CommandCenter.tsx');
    const menus = read('src/lib/assistantMenus.ts');
    expect(menus).toContain('Biometric Test Evaluation');
    expect(commandCenter).toContain('BiometricEvaluationPanel');
    expect(commandCenter).toContain('Correct ID rate');
    expect(commandCenter).toContain('False ID rate');
    expect(commandCenter).toContain('Save Label');
  });

});
