-- Ejecutar completo en Supabase > SQL Editor
create table profiles(id uuid primary key references auth.users on delete cascade, username text unique, avatar_url text, is_private boolean default false);
create table follows(follower uuid references profiles on delete cascade, following uuid references profiles on delete cascade, status text check (status in ('pending','accepted')) default 'accepted', primary key(follower,following));
create table posts(id uuid primary key default gen_random_uuid(), user_id uuid references profiles on delete cascade default auth.uid(), image_url text, caption text, created_at timestamptz default now());
create table likes(post_id uuid references posts on delete cascade, user_id uuid references profiles on delete cascade, primary key(post_id,user_id));
create table comments(id uuid primary key, post_id uuid references posts on delete cascade, user_id uuid references profiles on delete cascade, body text, created_at timestamptz default now());
create table stories(id uuid primary key default gen_random_uuid(), user_id uuid references profiles on delete cascade default auth.uid(), image_url text, created_at timestamptz default now());
create table messages(id uuid primary key default gen_random_uuid(), sender uuid references profiles, receiver uuid references profiles, body text, created_at timestamptz default now(), delivered_at timestamptz, read_at timestamptz);

-- Perfil automático al registrarse
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare base text := split_part(new.email,'@',1); uname text := base;
begin
  if exists (select 1 from public.profiles where username = uname) then
    uname := base || '_' || substr(new.id::text,1,4);
  end if;
  insert into public.profiles(id, username) values (new.id, uname) on conflict (id) do nothing;
  return new;
end $$;
create trigger on_signup after insert on auth.users for each row execute function public.handle_new_user();

-- Regla de privacidad: ¿puedo ver el contenido de "owner"?
create function can_view(owner uuid) returns boolean language sql stable security definer as $$
  select owner = auth.uid()
    or exists(select 1 from profiles p where p.id = owner and not p.is_private)
    or exists(select 1 from follows f where f.follower = auth.uid() and f.following = owner and f.status = 'accepted') $$;

alter table profiles enable row level security; alter table follows enable row level security; alter table posts enable row level security;
alter table likes enable row level security; alter table comments enable row level security; alter table stories enable row level security; alter table messages enable row level security;

create policy p_sel on profiles for select using (auth.role()='authenticated');
create policy p_upd on profiles for update using (id=auth.uid());
create policy f_sel on follows for select using (follower=auth.uid() or following=auth.uid() or can_view(following));
create policy f_ins on follows for insert with check (follower=auth.uid() and (status='pending' or not exists(select 1 from profiles where id=following and is_private)));
create policy f_upd on follows for update using (following=auth.uid());          -- solo el dueño aprueba
create policy f_del on follows for delete using (following=auth.uid() or follower=auth.uid()); -- rechazar / dejar de seguir
create policy po_sel on posts for select using (can_view(user_id));
create policy po_ins on posts for insert with check (user_id=auth.uid());
create policy l_sel on likes for select using (exists(select 1 from posts where id=post_id));
create policy l_ins on likes for insert with check (user_id=auth.uid());
create policy l_del on likes for delete using (user_id=auth.uid());
create policy c_sel on comments for select using (exists(select 1 from posts where id=post_id));
create policy c_ins on comments for insert with check (user_id=auth.uid() and exists(select 1 from posts where id=post_id));
create policy s_sel on stories for select using (can_view(user_id));
create policy s_ins on stories for insert with check (user_id=auth.uid());
create policy m_sel on messages for select using (sender=auth.uid() or receiver=auth.uid());
create policy m_ins on messages for insert with check (sender=auth.uid());
create policy m_upd on messages for update using (receiver=auth.uid());          -- entregado / visto

-- Realtime + Storage
alter publication supabase_realtime add table messages, comments;
insert into storage.buckets(id,name,public) values('media','media',true);
create policy st_ins on storage.objects for insert to authenticated with check (bucket_id='media' and (storage.foldername(name))[1]=auth.uid()::text);
create policy st_sel on storage.objects for select using (bucket_id='media');
-- 1) Ver listas de seguidores/seguidos de cuentas que puedes ver
drop policy if exists f_sel on follows;
create policy f_sel on follows for select using (follower=auth.uid() or following=auth.uid() or can_view(following) or can_view(follower));
-- 2) Historias: el servidor deja de servir las de más de 24 h (el backend Node las borra con su imagen)
drop policy if exists s_sel on stories;
create policy s_sel on stories for select using (can_view(user_id) and created_at > now() - interval '24 hours');

create policy st_upd on storage.objects for update to authenticated using (bucket_id='media' and (storage.foldername(name))[1]=auth.uid()::text);
