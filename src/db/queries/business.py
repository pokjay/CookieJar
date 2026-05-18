import pandas as pd

from src.db.connection import is_mock_mode, run_query
from src.db.mock_data import get_business_descriptions, get_business_mappings, get_transactions


def get_all_business_descriptions() -> pd.DataFrame:
    """Get all business descriptions."""
    if is_mock_mode():
        return get_business_descriptions()

    return run_query("SELECT * FROM business_descriptions ORDER BY description")


def get_all_business_mappings() -> pd.DataFrame:
    """Get all business transaction mappings."""
    if is_mock_mode():
        return get_business_mappings()

    return run_query("""
        SELECT m.unique_id, m.business_descriptions_id, d.description AS business_name
        FROM business_transaction_mappings m
        JOIN business_descriptions d ON m.business_descriptions_id = d.id
    """)


def get_unmapped_business_descriptions() -> pd.DataFrame:
    """Get distinct transaction descriptions that still have unmapped transactions."""
    if is_mock_mode():
        txns = get_transactions()
        mappings = get_business_mappings()
        mapped_ids: set = set(mappings["unique_id"]) if len(mappings) > 0 else set()
        unmapped = txns[~txns["unique_id"].isin(mapped_ids)]
        return (
            unmapped.groupby("description")
            .agg(unmapped_count=("unique_id", "count"), total_amount=("charged_amount", "sum"))
            .reset_index()
            .sort_values(["unmapped_count", "description"], ascending=[False, True])
        )

    return run_query("""
        SELECT
            t.description,
            COUNT(*) AS unmapped_count,
            SUM(t.charged_amount) AS total_amount
        FROM processed_transcations_with_categories t
        LEFT JOIN business_transaction_mappings m ON t.unique_id = m.unique_id
        WHERE m.unique_id IS NULL
        GROUP BY t.description
        ORDER BY unmapped_count DESC, t.description
    """)


def get_unmapped_transactions_for_description(description: str) -> pd.DataFrame:
    """Get unmapped transactions for a given broad description."""
    if is_mock_mode():
        txns = get_transactions()
        mappings = get_business_mappings()
        mapped_ids: set = set(mappings["unique_id"]) if len(mappings) > 0 else set()
        rows = txns[(txns["description"] == description) & (~txns["unique_id"].isin(mapped_ids))]
        return rows[["unique_id", "activity_date", "processed_description", "charged_amount"]].copy()

    return run_query(
        """
        SELECT t.unique_id, t.activity_date, t.processed_description, t.charged_amount
        FROM processed_transcations_with_categories t
        LEFT JOIN business_transaction_mappings m ON t.unique_id = m.unique_id
        WHERE m.unique_id IS NULL AND t.description = :description
        ORDER BY t.activity_date DESC
        """,
        {"description": description},
    )
