import pandas as pd
import pytest

from src.utils.calculations import (
    aggregate_household_cash_flow,
    aggregate_yearly_cash_flow,
    pivot_cash_flow_table,
    prepare_sankey_data,
)


def _make_cash_flow_df() -> pd.DataFrame:
    """Create a minimal multi-person, multi-year cash flow DataFrame."""
    return pd.DataFrame(
        {
            "year": [2024, 2024, 2024, 2024, 2025, 2025],
            "month": [1, 2, 1, 2, 1, 1],
            "person": ["Alice", "Alice", "Bob", "Bob", "Alice", "Bob"],
            "account": ["A1", "A1", "B1", "B1", "A1", "B1"],
            "income": [10000, 12000, 8000, 9000, 11000, 8500],
            "expense": [6000, 7000, 5000, 4000, 6500, 5500],
            "money_transferred": [0, 0, 0, 0, 0, 0],
            "savings": [2000, 2500, 1500, 2000, 2000, 1500],
        }
    )


class TestAggregateYearlyCashFlow:
    def test_household_aggregation(self):
        df = _make_cash_flow_df()
        result = aggregate_yearly_cash_flow(df)

        assert len(result) == 2
        row_2024 = result[result["year"] == 2024].iloc[0]
        assert row_2024["income"] == 39000
        assert row_2024["expense"] == 22000
        assert row_2024["income_expense_diff"] == 17000

    def test_person_filter(self):
        df = _make_cash_flow_df()
        result = aggregate_yearly_cash_flow(df, person="Alice")

        row_2024 = result[result["year"] == 2024].iloc[0]
        assert row_2024["income"] == 22000
        assert row_2024["expense"] == 13000

    def test_savings_pct(self):
        df = _make_cash_flow_df()
        result = aggregate_yearly_cash_flow(df)

        row_2024 = result[result["year"] == 2024].iloc[0]
        expected_pct = round((17000 / 39000) * 100, 1)
        assert row_2024["savings_pct"] == expected_pct

    def test_sorted_by_year(self):
        df = _make_cash_flow_df()
        result = aggregate_yearly_cash_flow(df)
        assert list(result["year"]) == [2024, 2025]


def _make_transactions_df() -> pd.DataFrame:
    """Create a minimal transactions DataFrame with categories and subcategories."""
    return pd.DataFrame(
        {
            "activity_date": pd.to_datetime(
                ["2024-01-15", "2024-02-10", "2024-01-20", "2024-03-05", "2024-01-10", "2025-01-10"]
            ),
            "person": ["Alice", "Alice", "Alice", "Bob", "Bob", "Alice"],
            "charged_amount": [200, 150, 300, 100, -50, 400],
            "category": ["Supermarket", "Supermarket", "Eating Out", "Eating Out", "Cashback", "Supermarket"],
            "subcategory": ["Supermarket", "Water", "Food", "Pub", "Cashback", "Supermarket"],
        }
    )


def _node_names(result: dict) -> list[str]:
    """Extract node name strings from sankey result."""
    return [n["name"] for n in result["nodes"]]


def _links_from(result: dict, source: str) -> list[dict]:
    """Get all links originating from a given source."""
    return [lnk for lnk in result["links"] if lnk["source"] == source]


class TestPrepareSankeyData:
    def test_basic_structure(self):
        txn = _make_transactions_df()
        cf = _make_cash_flow_df()
        result = prepare_sankey_data(txn, cf, 2024)

        names = _node_names(result)
        assert "Income" in names
        assert "Savings" in names
        assert "expandable_categories" in result

    def test_income_links_to_categories_and_savings(self):
        txn = _make_transactions_df()
        cf = _make_cash_flow_df()
        result = prepare_sankey_data(txn, cf, 2024)

        targets = [lnk["target"] for lnk in _links_from(result, "Income")]
        assert "Eating Out" in targets
        assert "Supermarket" in targets
        assert "Savings" in targets

    def test_excludes_negative_amounts(self):
        """Cashback (negative amounts) should not appear as a category."""
        txn = _make_transactions_df()
        cf = _make_cash_flow_df()
        result = prepare_sankey_data(txn, cf, 2024)

        assert "Cashback" not in _node_names(result)

    def test_collapsed_by_default(self):
        """No subcategory nodes when nothing is expanded."""
        txn = _make_transactions_df()
        cf = _make_cash_flow_df()
        result = prepare_sankey_data(txn, cf, 2024)

        names = _node_names(result)
        assert not any(" — " in n for n in names)

    def test_expanded_shows_subcategories(self):
        """Expanding a category shows its subcategory nodes and links."""
        txn = _make_transactions_df()
        cf = _make_cash_flow_df()
        result = prepare_sankey_data(txn, cf, 2024, expanded_categories={"Supermarket"})

        names = _node_names(result)
        assert "Supermarket — Supermarket" in names
        assert "Supermarket — Water" in names
        # Eating Out not expanded, so no sub-nodes
        assert "Eating Out — Food" not in names

    def test_expanded_links(self):
        """Expanded category should have links to its subcategories."""
        txn = _make_transactions_df()
        cf = _make_cash_flow_df()
        result = prepare_sankey_data(txn, cf, 2024, expanded_categories={"Supermarket"})

        sub_links = _links_from(result, "Supermarket")
        sub_targets = {lnk["target"] for lnk in sub_links}
        assert "Supermarket — Supermarket" in sub_targets
        assert "Supermarket — Water" in sub_targets

    def test_single_subcategory_not_expandable(self):
        """Categories with only 1 subcategory should not be expandable."""
        txn = _make_transactions_df()
        cf = _make_cash_flow_df()
        # Filter to Alice only — her Eating Out has only "Food" (1 sub)
        result = prepare_sankey_data(txn, cf, 2024, person="Alice")

        assert "Eating Out" not in result["expandable_categories"]
        assert "Supermarket" in result["expandable_categories"]

    def test_expandable_categories_listed(self):
        """Categories with >1 subcategory should appear in expandable list."""
        txn = _make_transactions_df()
        cf = _make_cash_flow_df()
        result = prepare_sankey_data(txn, cf, 2024)

        # Supermarket (Supermarket, Water) and Eating Out (Food, Pub) each have 2 subs
        assert "Supermarket" in result["expandable_categories"]
        assert "Eating Out" in result["expandable_categories"]

    def test_person_filter(self):
        txn = _make_transactions_df()
        cf = _make_cash_flow_df()
        result = prepare_sankey_data(txn, cf, 2024, person="Alice")

        names = _node_names(result)
        assert "Supermarket" in names
        assert "Eating Out" in names

    def test_empty_year(self):
        txn = _make_transactions_df()
        cf = _make_cash_flow_df()
        result = prepare_sankey_data(txn, cf, 2020)

        assert result["nodes"] == []
        assert result["links"] == []

    def test_category_values_match(self):
        txn = _make_transactions_df()
        cf = _make_cash_flow_df()
        result = prepare_sankey_data(txn, cf, 2024)

        # Supermarket total in 2024: 200 + 150 = 350
        supermarket_links = [lnk for lnk in result["links"] if lnk["source"] == "Income" and lnk["target"] == "Supermarket"]
        assert len(supermarket_links) == 1
        assert supermarket_links[0]["value"] == 350

    def test_nodes_have_depth(self):
        txn = _make_transactions_df()
        cf = _make_cash_flow_df()
        result = prepare_sankey_data(txn, cf, 2024, expanded_categories={"Supermarket"})

        depths = {n["name"]: n["depth"] for n in result["nodes"]}
        assert depths["Income"] == 0
        assert depths["Supermarket"] == 1
        assert depths["Savings"] == 1
        assert depths["Supermarket — Supermarket"] == 2
        assert depths["Supermarket — Water"] == 2

    def test_subcategories_follow_parent_in_node_order(self):
        """Subcategory nodes should appear right after their parent."""
        txn = _make_transactions_df()
        cf = _make_cash_flow_df()
        result = prepare_sankey_data(txn, cf, 2024, expanded_categories={"Supermarket"})

        names = _node_names(result)
        parent_idx = names.index("Supermarket")
        sub1_idx = names.index("Supermarket — Supermarket")
        sub2_idx = names.index("Supermarket — Water")
        assert sub1_idx == parent_idx + 1
        assert sub2_idx == parent_idx + 2

    def test_expandable_categories_sorted_by_value(self):
        """Expandable categories should be in value-descending order."""
        txn = _make_transactions_df()
        cf = _make_cash_flow_df()
        result = prepare_sankey_data(txn, cf, 2024)

        # Eating Out: 300+100=400, Supermarket: 200+150=350
        assert result["expandable_categories"] == ["Eating Out", "Supermarket"]


# ---------------------------------------------------------------------------
# Savings % correctness — expenses stored as POSITIVE values (production convention)
#
# The existing _make_cash_flow_df() helper uses negative expenses, which accidentally
# makes `income + expense` yield the right answer. Production data (src/db/mock_data.py)
# stores expense as a positive number, exposing the bug where savings_pct > 100%.
# ---------------------------------------------------------------------------

def _make_positive_expense_df() -> pd.DataFrame:
    """Cash flow data with expenses as positive values, matching production convention."""
    return pd.DataFrame(
        {
            "year":   [2024, 2024, 2024, 2024],
            "month":  [   1,    2,    1,    2],
            "person": ["Alice", "Alice", "Bob", "Bob"],
            "account":["A1",   "A1",   "B1",  "B1"],
            "income": [10000,  12000,   8000,  9000],
            "expense":[  6000,   7000,   5000,  4000],  # positive, as in production
            "money_transferred": [0, 0, 0, 0],
            "savings": [2000, 2500, 1500, 2000],
        }
    )


class TestSavingsPctWithPositiveExpenses:
    """
    Regression tests for the savings_pct calculation bug (issue #57).

    When expense is stored as a positive value, `income + expense` inflates the
    numerator past income, producing savings_pct > 100%.  The correct formula is
    `income - expense`.
    """

    def test_yearly_savings_pct_not_above_100(self):
        df = _make_positive_expense_df()
        result = aggregate_yearly_cash_flow(df)
        row = result[result["year"] == 2024].iloc[0]
        assert row["savings_pct"] <= 100, (
            f"savings_pct should be ≤ 100% when expense < income, got {row['savings_pct']}"
        )

    def test_yearly_savings_pct_correct_value(self):
        # income=39000, expense=22000 → net=17000 → pct = round(17000/39000*100, 1) = 43.6
        df = _make_positive_expense_df()
        result = aggregate_yearly_cash_flow(df)
        row = result[result["year"] == 2024].iloc[0]
        expected = round((39000 - 22000) / 39000 * 100, 1)
        assert row["savings_pct"] == expected, (
            f"Expected savings_pct={expected}, got {row['savings_pct']}"
        )

    def test_household_savings_pct_not_above_100(self):
        df = _make_positive_expense_df()
        result = aggregate_household_cash_flow(df)
        for _, row in result.iterrows():
            assert row["savings_pct"] <= 100, (
                f"Month {row['month']}: savings_pct should be ≤ 100%, got {row['savings_pct']}"
            )

    def test_household_savings_pct_correct_value(self):
        # Month 1: income=18000, expense=11000 → pct = round(7000/18000*100, 1) = 38.9
        df = _make_positive_expense_df()
        result = aggregate_household_cash_flow(df)
        row_m1 = result[result["month"] == 1].iloc[0]
        expected = round((18000 - 11000) / 18000 * 100, 1)
        assert row_m1["savings_pct"] == expected, (
            f"Expected savings_pct={expected} for month 1, got {row_m1['savings_pct']}"
        )

    def test_pivot_table_savings_pct_not_above_100(self):
        df = _make_positive_expense_df()
        result = pivot_cash_flow_table(df)
        for _, row in result.iterrows():
            assert row["savings_pct"] <= 100, (
                f"Month {row['month']}: savings_pct should be ≤ 100%, got {row['savings_pct']}"
            )

    def test_pivot_table_savings_pct_correct_value(self):
        # Month 1: income=18000, expense=11000 → pct = round(7000/18000*100, 1) = 38.9
        df = _make_positive_expense_df()
        result = pivot_cash_flow_table(df)
        row_m1 = result[result["month"] == 1].iloc[0]
        expected = round((18000 - 11000) / 18000 * 100, 1)
        assert row_m1["savings_pct"] == expected, (
            f"Expected savings_pct={expected} for month 1, got {row_m1['savings_pct']}"
        )
