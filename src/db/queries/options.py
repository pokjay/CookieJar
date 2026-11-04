import pandas as pd

from src.db.connection import is_mock_mode, run_query
from src.db.mock_data import get_option_grants as _mock_option_grants

GRANT_COLUMNS = "id, name, grant_date, shares, strike, vesting_years, cliff_months"


def get_option_grants() -> pd.DataFrame:
    """All stock option grants, oldest grant first."""
    if is_mock_mode():
        return _mock_option_grants()

    return run_query(
        f"SELECT {GRANT_COLUMNS} FROM option_grants ORDER BY grant_date NULLS LAST, id"
    )
