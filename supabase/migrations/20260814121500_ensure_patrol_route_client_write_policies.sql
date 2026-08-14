-- Ensure direct client route creation can write patrol routes and route checkpoints
-- for the signed-in user's company. This is idempotent for existing projects.

ALTER TABLE public.patrol_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patrol_route_checkpoints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS patrol_routes_manage_company ON public.patrol_routes;
CREATE POLICY patrol_routes_manage_company ON public.patrol_routes
FOR ALL TO authenticated
USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()))
WITH CHECK (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS patrol_route_checkpoints_manage_company ON public.patrol_route_checkpoints;
CREATE POLICY patrol_route_checkpoints_manage_company ON public.patrol_route_checkpoints
FOR ALL TO authenticated
USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()))
WITH CHECK (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));
