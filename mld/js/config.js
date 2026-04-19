// Supabase project URL and public anon key.
// Anon key: Supabase Dashboard → Settings → API → "anon public"
const SUPABASE_URL = 'https://iaiqeaikmzozmkjbioyv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlhaXFlYWlrbXpvem1ramJpb3l2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMjAzOTYsImV4cCI6MjA4OTY5NjM5Nn0.v0sYwNW7xTKXTBLDOKrHsDNWns3tACRbJeicP2bDlto';

const SEASONS = [2020, 2021, 2022, 2023, 2024, 2025, 2026];
const CURRENT_YEAR = 2026;

// Owners who created a new Sleeper account mid-dynasty.
// Key = old display_name, value = new display_name.
// Both accounts are treated as the same person on team pages.
const OWNER_ACCOUNT_MERGES = {
  'Ochomi8': 'Ochomi823',
};

// Years to strip from a specific owner's history.
// Use when a user is listed in the DB for a year they didn't actually play
// (e.g. joined after the season ended and inherited the roster).
const OWNER_YEAR_EXCLUSIONS = {
  'jmata37': [2020],
};