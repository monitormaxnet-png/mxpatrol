DROP POLICY IF EXISTS "Company members can create alerts" ON public.alerts;

CREATE POLICY "Company members can create alerts"
ON public.alerts
FOR INSERT
TO authenticated
WITH CHECK (
  company_id = public.get_user_company_id(auth.uid())
  AND (
    (
      type = 'panic_button'
      AND severity = 'critical'
      AND guard_id IS NULL
    )
    OR (
      type <> 'panic_button'
      AND (
        guard_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.guards
          WHERE guards.id = alerts.guard_id
            AND guards.company_id = public.get_user_company_id(auth.uid())
        )
      )
    )
  )
);
