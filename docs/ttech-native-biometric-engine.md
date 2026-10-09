# TTECH Native Biometric Engine

MX Patrol can now carry a TTECH-owned biometric research module without depending on AWS, Azure, FaceTec, Innovatrics, pretrained face-recognition models, or chatbot vision matching.

## Current Scope

The current implementation is a research foundation only:

- `supabase/functions/_shared/ttechNativeBiometrics.ts` contains server-side original grayscale-image algorithms for:
  - image validation and contrast normalization
  - bright connected-component face-candidate detection
  - face quality metrics: symmetry, local contrast, sharpness, face area
  - handcrafted face encoding using normalized cell intensities and local gradients
  - cosine template comparison
  - scoped 1:N matching with company/site filtering
  - still-image liveness risk notes
- `supabase/functions/device-attendance/index.ts` recognizes `MXPATROL_BIOMETRIC_PROVIDER=ttech_native` but deliberately returns `review_required`.

## Why Attendance Is Not Auto-Verified Yet

The research engine does not yet decode RG360 JPEGs in the Edge Function, does not have production enrollment templates, and has not been calibrated on a properly consented dataset. A single still photo also cannot prove liveness reliably. For those reasons, the backend must not mark attendance as verified from this engine yet.

## Next Work

1. Add a backend image decoder/preprocessor suitable for RG360 JPEG captures.
2. Build supervised guard enrollment using multiple captures and privacy notices.
3. Store TTECH template vectors securely and separately from ordinary patrol photos.
4. Calibrate thresholds using consented data and measure false match / false reject rates.
5. Design active or multi-frame liveness checks for RG360 hardware.
6. Only after independent validation, allow the attendance decision engine to mark verified events.

## Safety Rule

The native engine can support supervisor review and research experiments now. It must not become payroll-grade automatic identity verification until accuracy, bias, liveness, privacy, and operational performance have been validated.

## Phase 2 Additions

- `supabase/functions/_shared/ttechImageProcessing.ts` decodes RG360-style JPEG captures on the server and converts them to grayscale input for the TTECH native detector/encoder.
- `supabase/functions/ttech-biometric-enrollment/index.ts` provides authenticated admin/supervisor enrollment, status and revocation actions.
- `public.ttech_biometric_template_secrets` stores template vectors behind RLS with no browser policies; Edge Functions access it with the service role.
- `device-attendance` now searches TTECH templates when `MXPATROL_BIOMETRIC_PROVIDER=ttech_native`, but still records events as review-required rather than verified.

This keeps the biometric gallery and matching workflow out of the browser bundle while preserving the existing MX Patrol attendance evidence and review workflow.
