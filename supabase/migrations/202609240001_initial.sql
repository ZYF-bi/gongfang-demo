-- Run in a NEW Supabase project. No service-role key is needed by this app.
begin;

create table public.projects (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  original_prompt text not null,
  applied_changes jsonb not null default '[]'::jsonb,
  html text not null check (octet_length(html) <= 200000),
  revision integer not null default 1,
  last_request_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_owner_updated on public.projects(user_id, updated_at desc);

create table public.generation_requests (
  request_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null,
  base_revision integer not null,
  prompt text not null check (char_length(prompt) between 1 and 2000),
  fingerprint text not null,
  status text not null default 'running' check (status in ('running','succeeded','failed','unsaved','expired')),
  error_code text,
  usage jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index request_owner_time on public.generation_requests(user_id, created_at desc);

alter table public.projects enable row level security;
alter table public.generation_requests enable row level security;
create policy projects_read_own on public.projects for select to authenticated using (user_id = (select auth.uid()));
create policy requests_read_own on public.generation_requests for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.projects, public.generation_requests from anon, authenticated;
grant select on public.projects, public.generation_requests to authenticated;

-- Short advisory locks serialize request admission; model calls run OUTSIDE this transaction.
create function public.begin_generation(p_request_id uuid, p_project_id uuid, p_revision integer, p_prompt text, p_fingerprint text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_req public.generation_requests; v_project public.projects;
begin
  if v_uid is null then raise exception 'NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));
  if p_revision < 0 or char_length(btrim(p_prompt)) not between 1 and 2000 then raise exception 'REQUEST_CONFLICT'; end if;
  update public.generation_requests set status = 'expired', finished_at = now()
    where user_id = v_uid and status = 'running' and created_at < now() - interval '150 seconds';
  select * into v_req from public.generation_requests where request_id = p_request_id;
  if found then
    if v_req.user_id <> v_uid or v_req.fingerprint <> p_fingerprint then raise exception 'REQUEST_CONFLICT'; end if;
    return jsonb_build_object('created', false, 'status', v_req.status);
  end if;
  if exists(select 1 from public.generation_requests where user_id = v_uid and status = 'running') then raise exception 'BUSY'; end if;
  -- Adjust these DB-enforced budgets for your demo; UI/HTTP limits alone are insufficient.
  if (select count(*) from public.generation_requests where user_id = v_uid and created_at > now() - interval '1 hour') >= 10
     or (select count(*) from public.generation_requests where user_id = v_uid and created_at > now() - interval '1 day') >= 30 then
    raise exception 'RATE_LIMIT';
  end if;
  select * into v_project from public.projects where id = p_project_id;
  if p_revision = 0 then
    if found then raise exception 'CONFLICT'; end if;
  else
    if not found or v_project.user_id <> v_uid then raise exception 'NOT_FOUND'; end if;
    if v_project.revision <> p_revision then raise exception 'CONFLICT'; end if;
    if char_length(v_project.applied_changes::text) + char_length(p_prompt) > 10000 then raise exception 'REQUEST_CONFLICT'; end if;
  end if;
  insert into public.generation_requests(request_id,user_id,project_id,base_revision,prompt,fingerprint)
    values(p_request_id,v_uid,p_project_id,p_revision,p_prompt,p_fingerprint);
  return jsonb_build_object('created', true, 'status', 'running');
end; $$;

create function public.finish_generation(p_request_id uuid, p_html text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_req public.generation_requests; v_project public.projects;
begin
  if v_uid is null then raise exception 'NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));
  select * into v_req from public.generation_requests where request_id = p_request_id and user_id = v_uid for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_req.status = 'succeeded' then
    select * into v_project from public.projects where id = v_req.project_id and user_id = v_uid;
    if v_project.last_request_id is distinct from p_request_id then raise exception 'CONFLICT'; end if;
    return to_jsonb(v_project) - 'user_id' - 'last_request_id';
  end if;
  if v_req.status not in ('running','unsaved') or v_req.created_at < now() - interval '1 day' then raise exception 'EXPIRED'; end if;
  if octet_length(p_html) > 200000 or length(p_html) = 0 then raise exception 'REQUEST_CONFLICT'; end if;
  if v_req.base_revision = 0 then
    insert into public.projects(id,user_id,name,original_prompt,html,last_request_id)
      values(v_req.project_id,v_uid,left(v_req.prompt,20),v_req.prompt,p_html,p_request_id)
      on conflict (id) do nothing returning * into v_project;
    if not found then raise exception 'CONFLICT'; end if;
  else
    update public.projects set html = p_html, applied_changes = applied_changes || jsonb_build_array(v_req.prompt),
      revision = revision + 1, updated_at = now(), last_request_id = p_request_id
      where id = v_req.project_id and user_id = v_uid and revision = v_req.base_revision returning * into v_project;
    if not found then raise exception 'CONFLICT'; end if;
  end if;
  update public.generation_requests set status = 'succeeded', finished_at = now(), error_code = null where request_id = p_request_id;
  return to_jsonb(v_project) - 'user_id' - 'last_request_id';
end; $$;

create function public.mark_generation(p_request_id uuid, p_status text, p_error_code text default null, p_usage jsonb default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_status not in ('failed','unsaved','running') then raise exception 'NOT_FOUND'; end if;
  update public.generation_requests set status = p_status, error_code = left(p_error_code,80), usage = p_usage,
    finished_at = case when p_status = 'running' then null else now() end
    where request_id = p_request_id and user_id = auth.uid() and status in ('running','unsaved');
end; $$;

revoke all on function public.begin_generation(uuid,uuid,integer,text,text) from public, anon;
revoke all on function public.finish_generation(uuid,text) from public, anon;
revoke all on function public.mark_generation(uuid,text,text,jsonb) from public, anon;
grant execute on function public.begin_generation(uuid,uuid,integer,text,text) to authenticated;
grant execute on function public.finish_generation(uuid,text) to authenticated;
grant execute on function public.mark_generation(uuid,text,text,jsonb) to authenticated;
commit;
