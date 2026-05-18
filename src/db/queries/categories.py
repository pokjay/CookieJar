import pandas as pd

from src.db.connection import is_mock_mode, run_query
from src.db.mock_data import get_description_to_category


def get_all_categories() -> pd.DataFrame:
    """Get all description-to-category mappings."""
    if is_mock_mode():
        return get_description_to_category()

    return run_query("SELECT * FROM description_to_category ORDER BY category, subcategory")


def get_category_hierarchy() -> dict[str, list[str]]:
    """Get distinct categories and their subcategories from the DB,
    sorted by transaction frequency (most frequent first).

    Returns a dict mapping category -> list of subcategories.
    """
    from src.db.queries.transactions import get_all_transactions

    cat_df = get_all_categories()
    if cat_df.empty:
        return {}

    txn_df = get_all_transactions()

    # Count transactions per category
    cat_counts = txn_df.groupby("category").size().reset_index(name="cat_freq")
    # Count transactions per category+subcategory
    subcat_counts = txn_df.groupby(["category", "subcategory"]).size().reset_index(name="sub_freq")

    hierarchy: dict[str, list[str]] = {}
    for cat, group in cat_df.groupby("category"):
        # Sort subcategories by transaction frequency (descending)
        subcats = group["subcategory"].unique().tolist()
        sub_freq = subcat_counts[
            (subcat_counts["category"] == cat)
        ].set_index("subcategory")["sub_freq"]
        subcats.sort(key=lambda s: sub_freq.get(s, 0), reverse=True)
        hierarchy[cat] = subcats

    # Sort categories by transaction frequency (descending)
    cat_freq = cat_counts.set_index("category")["cat_freq"]
    sorted_cats = sorted(hierarchy.keys(), key=lambda c: cat_freq.get(c, 0), reverse=True)
    return {c: hierarchy[c] for c in sorted_cats}
