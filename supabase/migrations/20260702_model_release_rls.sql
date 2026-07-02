-- Keep signed model release manifests off the public anon key. The base table
-- remains available to service-role APIs and admin JWTs; authenticated UI can
-- read only active version labels through a narrow view.

drop policy if exists "active releases are readable" on public.model_releases;
drop policy if exists "model releases are admin-readable" on public.model_releases;
drop policy if exists "model releases are service-readable" on public.model_releases;

revoke all on public.model_releases from anon;
grant select on public.model_releases to authenticated;
grant select on public.model_releases to service_role;

create policy "model releases are admin-readable"
  on public.model_releases for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "model releases are service-readable"
  on public.model_releases for select
  to service_role
  using (true);

create or replace view public.model_release_versions as
select
  model_version,
  engine_version,
  data_version,
  status
from public.model_releases
where status = 'active';

revoke all on public.model_release_versions from public;
grant select on public.model_release_versions to authenticated;
