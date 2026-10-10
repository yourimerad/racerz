-- Racerz — comptes joueurs (Supabase).
--
-- À exécuter une fois dans « SQL Editor » de votre projet Supabase (idempotent : peut être rejoué).
--
-- Principe de sécurité :
--   * Les mots de passe sont gérés uniquement par Supabase Auth (auth.users), jamais par le jeu.
--   * La table `profiles` n'est lisible que par son propriétaire (RLS) et n'est ÉCRITE par personne
--     côté client : ni INSERT, ni UPDATE, ni DELETE. Toute modification passe par les fonctions
--     ci-dessous (SECURITY DEFINER) qui recalculent l'argent côté serveur : prix des voitures et des
--     skins, solde suffisant, gains par place, paliers/niveaux. Le client ne peut donc jamais
--     « se donner » de l'argent en envoyant un montant.
--   * Limite connue : le résultat d'une course (place, hors-piste, contacts) est rapporté par le
--     navigateur — il n'y a pas de simulation côté serveur. Il est borné : un ticket `start_race`
--     est exigé, à usage unique, et la course doit avoir duré au moins 20 s.
--   * Les valeurs de gains/prix ci-dessous doivent rester alignées sur src/game/garage.ts.

create table if not exists public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  money           bigint      not null default 2000 check (money >= 0),
  cars            jsonb       not null default '{"gt":{"level":1,"paliers":0,"skin":"factory"}}',
  selected        text        not null default 'gt',
  skins           text[]      not null default array['factory'],
  settings        jsonb       not null default '{"muted":false}',
  imported        boolean     not null default false,
  race_started_at timestamptz,
  updated_at      timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.profiles force row level security;

revoke all on public.profiles from anon, authenticated;
grant select (id, money, cars, selected, skins, settings, imported, updated_at) on public.profiles to authenticated;

drop policy if exists "profil lisible par son propriétaire" on public.profiles;
create policy "profil lisible par son propriétaire" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
-- Volontairement aucune policy INSERT / UPDATE / DELETE.

-- ---------- tables de règles (alignées sur garage.ts) ----------

create or replace function public.racerz_car_price(p_model text) returns integer
language sql immutable as $$
  select case p_model
    when 'gt' then 0 when 'mx5' then 5000 when 'p911' then 20000
    when 'aventador' then 60000 when 'f8' then 150000 when 'jet' then 550000 end
$$;

create or replace function public.racerz_skin_price(p_skin text) returns integer
language sql immutable as $$
  select case p_skin
    when 'factory' then 0 when 'pearl' then 4000 when 'electric' then 6000 when 'mantis' then 9000
    when 'arancio' then 9000 when 'stripes' then 15000 when 'carbon' then 22000 when 'gold' then 40000 end
$$;

create or replace function public.racerz_payout(p_place integer) returns integer
language sql immutable as $$
  select case p_place when 1 then 5000 when 2 then 2500 when 3 then 1000 else 0 end
$$;

create or replace function public.racerz_profile_json(r public.profiles) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'money', r.money, 'cars', r.cars, 'selected', r.selected, 'skins', to_jsonb(r.skins),
    'settings', r.settings, 'imported', r.imported)
$$;

-- Profil du joueur connecté, créé au premier appel.
create or replace function public.get_profile() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r public.profiles;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  insert into public.profiles (id) values (uid) on conflict (id) do nothing;
  select * into r from public.profiles where id = uid;
  return public.racerz_profile_json(r);
end $$;

-- Verrouille et renvoie la ligne du joueur connecté (la crée au besoin).
create or replace function public.racerz_lock_profile() returns public.profiles
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r public.profiles;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  insert into public.profiles (id) values (uid) on conflict (id) do nothing;
  select * into r from public.profiles where id = uid for update;
  return r;
end $$;

create or replace function public.buy_car(p_model text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.profiles; price integer := public.racerz_car_price(p_model);
begin
  r := public.racerz_lock_profile();
  if price is null then raise exception 'unknown_car'; end if;
  if r.cars ? p_model then raise exception 'already_owned'; end if;
  if r.money < price then raise exception 'not_enough_money'; end if;
  update public.profiles
     set money = money - price,
         cars = cars || jsonb_build_object(p_model, jsonb_build_object('level', 1, 'paliers', 0, 'skin', 'factory')),
         selected = p_model, updated_at = now()
   where id = r.id returning * into r;
  return public.racerz_profile_json(r);
end $$;

create or replace function public.buy_skin(p_skin text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.profiles; price integer := public.racerz_skin_price(p_skin);
begin
  r := public.racerz_lock_profile();
  if r.selected = 'jet' then raise exception 'fixed_skin'; end if;  -- la carrosserie de la Racerz Jet est fixe
  if price is null or p_skin = 'factory' then raise exception 'unknown_skin'; end if;
  if p_skin = any (r.skins) then raise exception 'already_owned'; end if;
  if r.money < price then raise exception 'not_enough_money'; end if;
  update public.profiles
     set money = money - price,
         skins = array_append(skins, p_skin),
         cars = jsonb_set(cars, array[selected, 'skin'], to_jsonb(p_skin)),  -- le skin acheté est équipé
         updated_at = now()
   where id = r.id returning * into r;
  return public.racerz_profile_json(r);
end $$;

create or replace function public.equip_skin(p_skin text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.profiles;
begin
  r := public.racerz_lock_profile();
  if r.selected = 'jet' then raise exception 'fixed_skin'; end if;
  if not (p_skin = any (r.skins)) then raise exception 'skin_not_owned'; end if;
  update public.profiles
     set cars = jsonb_set(cars, array[selected, 'skin'], to_jsonb(p_skin)), updated_at = now()
   where id = r.id returning * into r;
  return public.racerz_profile_json(r);
end $$;

create or replace function public.select_car(p_model text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.profiles;
begin
  r := public.racerz_lock_profile();
  if not (r.cars ? p_model) then raise exception 'car_not_owned'; end if;
  update public.profiles set selected = p_model, updated_at = now() where id = r.id returning * into r;
  return public.racerz_profile_json(r);
end $$;

-- Ticket de départ de course (à usage unique, voir settle_race).
create or replace function public.start_race() returns void
language plpgsql security definer set search_path = public as $$
declare r public.profiles;
begin
  r := public.racerz_lock_profile();
  update public.profiles set race_started_at = now() where id = r.id;
end $$;

-- Règlement d'une course : l'argent et les paliers sont recalculés ici, pas par le client.
create or replace function public.settle_race(p_place integer, p_off_ratio numeric, p_hits integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.profiles; car jsonb; earned integer; clean boolean; palier boolean;
  lvl integer; pal integer; level_up integer := null;
begin
  r := public.racerz_lock_profile();
  if r.race_started_at is null or now() - r.race_started_at < interval '20 seconds' then
    raise exception 'race_not_valid';
  end if;
  if p_place is null or p_place < 1 or p_place > 4 or p_off_ratio is null or p_off_ratio < 0 or p_off_ratio > 1
     or p_hits is null or p_hits < 0 then
    raise exception 'bad_result';
  end if;

  earned := public.racerz_payout(p_place);
  car := r.cars -> r.selected;
  lvl := (car ->> 'level')::integer;
  pal := (car ->> 'paliers')::integer;
  clean := p_place = 1 and p_off_ratio <= 0.05 and p_hits <= 2;
  palier := clean and lvl < 10;
  if palier then
    pal := pal + 1;
    if pal >= 5 then lvl := lvl + 1; pal := 0; level_up := lvl; end if;
  end if;

  update public.profiles
     set money = money + earned,
         cars = jsonb_set(cars, array[selected], (car || jsonb_build_object('level', lvl, 'paliers', pal))),
         race_started_at = null, updated_at = now()
   where id = r.id returning * into r;

  return jsonb_build_object(
    'profile', public.racerz_profile_json(r),
    'report', jsonb_build_object('place', p_place, 'earned', earned, 'palier', palier, 'levelUp', level_up));
end $$;

-- Reprise, une seule fois, de la progression locale (localStorage) d'un joueur non connecté.
-- Tout est assaini ; l'argent importé est plafonné (le localStorage n'est pas une source de confiance).
create or replace function public.import_profile(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.profiles; k text; v jsonb; s jsonb; new_cars jsonb := '{}'; new_skins text[] := array['factory'];
  new_money bigint; new_selected text; lvl integer; pal integer; skin text;
begin
  r := public.racerz_lock_profile();
  if r.imported then raise exception 'already_imported'; end if;
  if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'bad_profile'; end if;

  if jsonb_typeof(p_data -> 'skins') = 'array' then
    for s in select * from jsonb_array_elements(p_data -> 'skins') loop
      if jsonb_typeof(s) = 'string' and public.racerz_skin_price(s #>> '{}') is not null
         and (s #>> '{}') <> 'factory' and not ((s #>> '{}') = any (new_skins)) then
        new_skins := array_append(new_skins, s #>> '{}');
      end if;
    end loop;
  end if;

  new_cars := jsonb_build_object('gt', jsonb_build_object('level', 1, 'paliers', 0, 'skin', 'factory'));
  if jsonb_typeof(p_data -> 'cars') = 'object' then
    for k, v in select * from jsonb_each(p_data -> 'cars') loop
      continue when public.racerz_car_price(k) is null or jsonb_typeof(v) is distinct from 'object';
      lvl := case when jsonb_typeof(v -> 'level') = 'number' and (v ->> 'level') ~ '^\d+$' then least(greatest((v ->> 'level')::integer, 1), 10) else 1 end;
      pal := case when jsonb_typeof(v -> 'paliers') = 'number' and (v ->> 'paliers') ~ '^\d+$' then least((v ->> 'paliers')::integer, 4) else 0 end;
      skin := v ->> 'skin';
      if skin is null or not (skin = any (new_skins)) or k = 'jet' then skin := 'factory'; end if;
      new_cars := new_cars || jsonb_build_object(k, jsonb_build_object('level', lvl, 'paliers', pal, 'skin', skin));
    end loop;
  end if;

  new_selected := p_data ->> 'selected';
  if new_selected is null or not (new_cars ? new_selected) then new_selected := 'gt'; end if;
  new_money := case when jsonb_typeof(p_data -> 'money') = 'number' and (p_data ->> 'money') ~ '^\d{1,15}$'
                    then least((p_data ->> 'money')::bigint, 500000) else 2000 end;

  update public.profiles
     set money = new_money, cars = new_cars, selected = new_selected, skins = new_skins,
         imported = true, updated_at = now()
   where id = r.id returning * into r;
  return public.racerz_profile_json(r);
end $$;

-- Marque l'import comme traité sans rien reprendre (le joueur a refusé : on ne le redemande plus).
create or replace function public.skip_import() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.profiles;
begin
  r := public.racerz_lock_profile();
  update public.profiles set imported = true, updated_at = now() where id = r.id returning * into r;
  return public.racerz_profile_json(r);
end $$;

create or replace function public.save_settings(p_muted boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.profiles;
begin
  r := public.racerz_lock_profile();
  update public.profiles set settings = jsonb_build_object('muted', coalesce(p_muted, false)), updated_at = now()
   where id = r.id returning * into r;
  return public.racerz_profile_json(r);
end $$;

-- Seules les fonctions « publiques » du jeu sont appelables, et seulement par un joueur connecté.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.get_profile(), public.buy_car(text), public.buy_skin(text), public.equip_skin(text),
  public.select_car(text), public.start_race(), public.settle_race(integer, numeric, integer),
  public.import_profile(jsonb), public.skip_import(), public.save_settings(boolean)
  to authenticated;
