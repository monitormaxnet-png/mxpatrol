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
    expect(enrollment).toContain('limit(500)');
  });
  it('adds attendance management to the Web AI Assistant without removing patrol features', () => {
    const menus = read('src/lib/assistantMenus.ts');
    const commandCenter = read('src/pages/CommandCenter.tsx');
    expect(menus).toContain('Attendance Management');
    expect(menus).toContain('management_attendance');
    expect(menus).toContain('attendance_overview');
    expect(menus).not.toContain('Guard Biometric Enrollment');
    expect(menus).not.toContain('attendance_enrollment');
    expect(menus).toContain('Biometric Management');
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


  it('exposes RG360 biometric test mode without double-routing Volume Up photos', () => {
    const scanner = read('src/pages/NFCScanner.tsx');
    const incidentListener = read('src/components/devices/IncidentPhotoListener.tsx');
    const biometricListener = read('src/components/devices/BiometricTestCaptureListener.tsx');
    const cameraMode = read('src/lib/rg360CameraMode.ts');
    const css = read('src/index.css');

    expect(scanner).toContain('biometricTestAvailable = isNativeScanner && devicePaired && !scannerBlocked');
    expect(scanner).toContain('BIOMETRIC TEST');
    expect(scanner).toContain('BIOMETRIC TEST MODE');
    expect(scanner).toContain('POSITION FACE INSIDE FRAME');
    expect(scanner).toContain('mxpatrol:biometric-test-feedback');
    expect(scanner).toContain('rg360-face-guide');
    expect(scanner).toContain('BACK TO SCANNER');
    expect(scanner).toContain('setBiometricTestMode(true)');
    expect(scanner).toContain('setBiometricTestMode(false)');
    expect(scanner).toContain('pageshow');
    expect(scanner).toContain('visibilitychange');
    expect(incidentListener).toContain('if (isBiometricTestModeActive() || getRg360CameraMode() !== "PATROL") return;');
    expect(incidentListener.indexOf('getRg360CameraMode() !== "PATROL"')).toBeLessThan(incidentListener.indexOf('device-incident-photo'));
    expect(biometricListener).toContain('biometric_test_mode: true');
    expect(biometricListener).toContain('useOfflineBiometricTestQueue');
    expect(cameraMode).toContain('FACIAL_ENROLLMENT');
    expect(cameraMode).toContain('FACIAL_ATTENDANCE');
    expect(cameraMode).toContain('BIOMETRIC_TEST');
    expect(css).toContain('.rg360-biometric-action');
    expect(css).toContain('.rg360-face-guide');
    expect(css).toContain('.rg360-biometric-mode-grid');
    expect(css).toContain('.rg360-face-guide');
  });

  it('connects the Web AI Assistant to biometric management enrollment testing attendance and reviews', () => {
    const menus = read('src/lib/assistantMenus.ts');
    const commandCenter = read('src/pages/CommandCenter.tsx');

    expect(menus).toContain('Biometric Management');
    expect(menus).toContain('attendance_biometric_management');
    expect(commandCenter).toContain('function BiometricManagementPanel');
    expect(commandCenter).toContain('TTECH | MX PATROL');
    expect(commandCenter).toContain('Register New Guard');
    expect(commandCenter).toContain('Select Existing Guard');
    expect(commandCenter).toContain('createBiometricGuard');
    expect(commandCenter).toContain("from('guards')");
    expect(commandCenter).toContain('badge_number');
    expect(commandCenter).toContain('Next: Facial Enrollment');
    expect(commandCenter).toContain('Pending Enrollment');
    expect(commandCenter).toContain('Facial enrollment required');
    expect(commandCenter).toContain('Guard registered successfully. Facial enrollment required.');
    expect(commandCenter).toContain('Guard registered successfully. Facial enrollment required. Add 2-6 supervised JPEG samples, then press Register Facial Biometric.');
    expect(commandCenter).toContain('Register the guard first, then upload 2-6 supervised JPEG samples for facial enrollment.');
    expect(commandCenter).toContain('Select at least two eligible supervised enrollment samples before registering the facial biometric.');
    expect(commandCenter).toContain('At least two supervised samples are required. Add one more RG360 capture or uploaded photograph before submitting.');
    expect(commandCenter).toContain('Biometric enrollment was not confirmed by the server.');
    expect(commandCenter).toContain("disabled={busy || enrollmentMode === 'new' || !selectedGuardId || enrollmentSampleCount < 2}");
    expect(commandCenter).toContain('Facial Biometric Registered Successfully');
    expect(commandCenter).toContain('sampleInputRef');
    expect(commandCenter).toContain("sampleInputRef.current.value = ''");
    expect(commandCenter).toContain("setSelectedGuardId('')");
    expect(commandCenter).toContain("setEnrollmentMode('new')");
    expect(commandCenter).toContain('Registering...');
    expect(commandCenter).toContain('site_id: siteId');
    expect(commandCenter).toContain('normalizeAttendanceEvidencePath');
    expect(commandCenter).toContain('ATTENDANCE_EVIDENCE_BUCKET');
    expect(commandCenter).toContain('row.provider_result?.evidence_path');
    expect(commandCenter).toContain('Evidence file was not found in private storage');
    expect(commandCenter).toContain('Capture Inbox');
    expect(commandCenter).toContain('One supervisor inbox for RG360 facial photographs');
    expect(commandCenter).toContain('PHOTO UNAVAILABLE - RETAKE REQUIRED');
    expect(commandCenter).toContain('evidencePreviewError');
    expect(commandCenter).toContain('No private biometric evidence photo is attached');
    expect(commandCenter).toContain('Evidence file was not found in private storage');
    expect(commandCenter).toContain('Guard Enrollment');
    expect(commandCenter).toContain('Facial Enrollment registers or re-enrolls a guard identity');
    expect(commandCenter).toContain('It creates biometric templates only after backend confirmation and never creates attendance records.');
    expect(commandCenter).toContain('Facial Samples');
    expect(commandCenter).toContain('Use the Captures tab to choose verified RG360 photographs');
    expect(commandCenter).toContain('Testing / Diagnostics');
    expect(commandCenter).toContain("[['guards', 'Guards'], ['captures', 'Captures'], ['attendance', 'Attendance']]");
    expect(commandCenter).toContain('isEligibleEnrollmentCapture');
    expect(commandCenter).toContain('enrollmentCaptureLabel');
    expect(commandCenter).toContain('BiometricCaptureHistoryFilter');
    expect(commandCenter).toContain('biometricCaptureLifecycle');
    expect(commandCenter).toContain('Used for Enrollment');
    expect(commandCenter).toContain('Retake Required');
    expect(commandCenter).toContain('NEW CAPTURE RECEIVED');
    expect(commandCenter).toContain('manualBiometricRefresh');
    expect(commandCenter).toContain('postgres_changes');
    expect(commandCenter).toContain('refetchInterval: 15000');
    expect(commandCenter).toContain('selectedCaptureSampleIds');
    expect(commandCenter).toContain('blobToBase64');
    expect(commandCenter).toContain('download(path)');
    expect(commandCenter).toContain('Eligible sample');
    expect(commandCenter).toContain('Actions are only available in this detail view');
    expect(commandCenter).toContain('biometricCaptureEvidencePath');
    expect(commandCenter).toContain('isPendingUnregisteredFace');
    expect(commandCenter).toContain('pendingFaceRows');
    expect(commandCenter).toContain('captureInboxRows');
    expect(commandCenter).toContain('selectedInboxCapture');
    expect(commandCenter).toContain('Existing Guard / Select Guard');
    expect(commandCenter).toContain('Register New Guard');
    expect(commandCenter).toContain('Request Retake');
    expect(commandCenter).toContain('Dismiss with Reason');
    expect(commandCenter).toContain('Used as supervised RG360 evidence for facial enrollment');
    expect(commandCenter).toContain('Register Facial Biometric');
    expect(commandCenter).toContain("supabase.functions.invoke('ttech-biometric-enrollment'");
    expect(commandCenter).toContain("action: 'enroll'");
    expect(commandCenter).toContain("action: 'revoke'");
    expect(commandCenter).toContain("from('biometric_test_captures')");
    expect(commandCenter).toContain("from('attendance_events')");
    expect(commandCenter).toContain('storage.from(ATTENDANCE_EVIDENCE_BUCKET).createSignedUrl');
    expect(commandCenter).toContain('Automatic attendance approval remains disabled');
  });
});
