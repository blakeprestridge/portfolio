"""
db_utils.py

Shared Django setup and database helpers for ingestion scripts.
"""

import sys
import math
from pathlib import Path

# Bootstrap Django before any model imports
PROJECT_ROOT = Path(__file__).resolve().parents[2]
FANTASY_DIR  = PROJECT_ROOT / "fantasy_football"

sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(FANTASY_DIR))

import django
from django.conf import settings as django_settings

if not django_settings.configured:
    import os
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    sys.path.insert(0, str(PROJECT_ROOT / "mld_web_app"))
    django.setup()


def nan_to_none(val):
    """Convert NaN/float nan to None for DB compatibility."""
    if val is None:
        return None
    try:
        if math.isnan(float(val)):
            return None
    except (TypeError, ValueError):
        pass
    return val


def clean_row(row):
    """Apply nan_to_none to every value in a dict."""
    return {k: nan_to_none(v) for k, v in row.items()}


def season_replace(model, rows, year_field="year", year=None):
    """
    Delete all rows for the given year, then bulk-insert new ones.
    Returns the count of inserted rows.
    """
    if year is not None:
        model.objects.filter(**{year_field: year}).delete()
    else:
        model.objects.all().delete()

    if not rows:
        return 0

    model.objects.bulk_create(rows, batch_size=1000)
    return len(rows)


def full_replace(model, rows):
    """Delete all rows in the table, then bulk-insert."""
    return season_replace(model, rows, year=None)
