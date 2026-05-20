DROP POLICY IF EXISTS "Company members can view enrollment tokens" ON public.enrollment_tokens;
CREATE POLICY "Admins can view enrollment tokens"
ON public.enrollment_tokens
FOR SELECT
TO authenticated
USING (company_id = get_user_company_id(auth.uid()) AND has_role(auth.uid(), 'admin'::app_role));