"""
db_utils.py

Shared Django setup and database helpers for ingestion scripts.
"""

import sys
import math
from pathlib import Path

# mld_web_app is the project root — ingestion/ is one level down
INGESTION_DIR = Path(__file__).resolve().parent
MLD_WEB_APP   = INGESTION_DIR.parent

sys.path.insert(0, str(MLD_WEB_APP))          # for config.settings + api.models
sys.path.insert(0, str(INGESTION_DIR))        # for mld_utilities

import django
from django.conf import settings as django_settings

if not django_settings.configured:
    import os
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    django.setup()

# DEBUG: print DB connection info to Railway logs
from django.conf import settings as _s
_db = _s.DATABASES["default"]
print(f"[DB DEBUG] HOST={_db['HOST']} PORT={_db['PORT']} USER={_db['USER']} NAME={_db['NAME']}", flush=True)


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
