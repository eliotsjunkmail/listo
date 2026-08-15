-- Frogger high scores (run in Supabase SQL editor)
create table if not exists public.scores (
  id uuid primary key default gen_random_uuid(),
  player_name text not null check (char_length(trim(player_name)) between 1 and 24),
  score numeric not null,
  created_at timestamptz not null default now()
);

create index if not exists scores_score_desc_idx on public.scores (score desc, created_at desc);

alter table public.scores enable row level security;

drop policy if exists "Anyone can read scores" on public.scores;
create policy "Anyone can read scores"
  on public.scores for select
  using (true);

drop policy if exists "Anyone can insert scores" on public.scores;
create policy "Anyone can insert scores"
  on public.scores for insert
  with check (
    char_length(trim(player_name)) between 1 and 24
    and score is not null
  );
