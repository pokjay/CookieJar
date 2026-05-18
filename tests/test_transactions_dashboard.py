"""Unit tests for transactions dashboard data functions."""

from __future__ import annotations

import pandas as pd
import pytest

from backend.data_transactions import (
    compute_avg_by_category,
    compute_category_trends,
    compute_data_health,
    compute_heatmap,
    compute_monthly_by_account,
    compute_monthly_yoy,
    compute_subscriptions,
    compute_top_businesses,
    compute_travel_trips,
    compute_uncategorized,
    compute_yoy_spend,
    get_distinct_persons_from_transactions,
)


def _make_txn_df() -> pd.DataFrame:
    """Create a minimal transactions DataFrame with year/month/dow columns pre-filled."""
    dates = [
        "2023-01-15", "2023-03-20",  # year 2023
        "2024-01-10", "2024-02-14", "2024-02-28",
        "2024-03-01",
        "2025-06-05",
    ]
    df = pd.DataFrame(
        {
            "activity_date": pd.to_datetime(dates),
            "charged_amount": [100.0, 200.0, 150.0, 300.0, 50.0, 75.0, 400.0],
            "category": ["Food", "Travel", "Food", "Shopping", "Food", None, "Food"],
            "processed_description": [
                "Supermarket", "Airline", "Supermarket", "Amazon", "Supermarket",
                "Unknown Store", "Supermarket",
            ],
            "description": [
                "Supermarket", "Airline", "Supermarket", "Amazon", "Supermarket",
                "Unknown Store", "Supermarket",
            ],
            "account": ["Card A", "Card B", "Card A", "Card A", "Card B", "Card A", "Card A"],
            "person": ["Alice", "Bob", "Alice", "Bob", "Alice", "Alice", "Alice"],
        }
    )
    df["year"] = df["activity_date"].dt.year
    df["month"] = df["activity_date"].dt.month
    df["dow"] = df["activity_date"].dt.dayofweek
    return df


class TestGetDistinctPersons:
    def test_returns_sorted_persons(self):
        df = _make_txn_df()
        result = get_distinct_persons_from_transactions(df)
        assert result == ["Alice", "Bob"]

    def test_no_person_column(self):
        df = _make_txn_df().drop(columns=["person"])
        assert get_distinct_persons_from_transactions(df) == []


class TestComputeDataHealth:
    def test_basic_metrics(self):
        df = _make_txn_df()
        result = compute_data_health(df, 2024)
        assert result["last_transaction_date"] == "2025-06-05"  # max across ALL years
        assert result["uncategorized_count"] == 1
        # total = 7 rows, 1 uncategorized → ~14.3%
        assert 14.0 <= result["uncategorized_pct"] <= 15.0
        # total_spend for 2024: 150+300+50+75 = 575
        assert result["total_spend"] == pytest.approx(575.0)

    def test_empty_year(self):
        df = _make_txn_df()
        result = compute_data_health(df, 1900)
        assert result["total_spend"] == 0.0


class TestComputeYoySpend:
    def test_returns_all_years(self):
        df = _make_txn_df()
        result = compute_yoy_spend(df)
        years = [r["year"] for r in result]
        assert sorted(years) == [2023, 2024, 2025]

    def test_spend_values(self):
        df = _make_txn_df()
        result = compute_yoy_spend(df)
        by_year = {r["year"]: r["total_spend"] for r in result}
        # 2023: 100+200=300
        assert by_year[2023] == pytest.approx(300.0)
        # 2024: 150+300+50+75=575
        assert by_year[2024] == pytest.approx(575.0)


class TestComputeMonthlyYoy:
    def test_returns_selected_and_prior_years(self):
        df = _make_txn_df()
        result = compute_monthly_yoy(df, 2024)
        years = sorted({r["year"] for r in result})
        assert 2024 in years
        assert 2023 in years  # prior year included

    def test_month_names_present(self):
        df = _make_txn_df()
        result = compute_monthly_yoy(df, 2024)
        assert all("month_name" in r for r in result)


class TestComputeMonthlyByAccount:
    def test_groups_by_account(self):
        df = _make_txn_df()
        result = compute_monthly_by_account(df, 2024)
        accounts = {r["account"] for r in result}
        assert "Card A" in accounts
        assert "Card B" in accounts

    def test_empty_if_no_year(self):
        df = _make_txn_df()
        result = compute_monthly_by_account(df, 1900)
        assert result == []


class TestComputeAvgByCategory:
    def test_only_categorized(self):
        df = _make_txn_df()
        result = compute_avg_by_category(df, 2024)
        cats = {r["category"] for r in result}
        # Uncategorized row should not appear
        assert None not in cats

    def test_sorted_descending(self):
        df = _make_txn_df()
        result = compute_avg_by_category(df, 2024)
        spends = [r["avg_monthly_spend"] for r in result]
        assert spends == sorted(spends, reverse=True)


class TestComputeSubscriptions:
    def _make_subscription_df(self) -> pd.DataFrame:
        """Create a DataFrame with 12 identical transactions (one per month) for Netflix."""
        months = list(range(1, 13))
        rows = []
        for m in months:
            rows.append({
                "activity_date": pd.Timestamp(f"2024-{m:02d}-01"),
                "year": 2024,
                "month": m,
                "dow": 0,
                "processed_description": "Netflix",
                "charged_amount": 55.0,
                "category": "Entertainment",
                "account": "Card A",
                "person": "Alice",
            })
        # Add some non-recurring noise
        rows.append({
            "activity_date": pd.Timestamp("2024-06-15"),
            "year": 2024,
            "month": 6,
            "dow": 5,
            "processed_description": "One-off Store",
            "charged_amount": 200.0,
            "category": "Shopping",
            "account": "Card B",
            "person": "Alice",
        })
        return pd.DataFrame(rows)

    def test_detects_recurring(self):
        df = self._make_subscription_df()
        result = compute_subscriptions(df, 2024)
        names = [r["name"] for r in result]
        assert "Netflix" in names

    def test_ignores_one_off(self):
        df = self._make_subscription_df()
        result = compute_subscriptions(df, 2024)
        names = [r["name"] for r in result]
        assert "One-off Store" not in names

    def test_empty_year(self):
        df = self._make_subscription_df()
        assert compute_subscriptions(df, 1900) == []


class TestComputeCategoryTrends:
    def test_groups_by_category_and_month(self):
        df = _make_txn_df()
        result = compute_category_trends(df, 2024)
        assert all("category" in r and "month" in r and "spend" in r for r in result)

    def test_no_none_categories(self):
        df = _make_txn_df()
        result = compute_category_trends(df, 2024)
        assert all(r["category"] is not None for r in result)


class TestComputeTopBusinesses:
    def test_max_15(self):
        df = _make_txn_df()
        # Add many unique businesses
        extra = pd.DataFrame({
            "activity_date": pd.to_datetime(["2024-01-01"] * 20),
            "year": [2024] * 20,
            "month": [1] * 20,
            "dow": [0] * 20,
            "processed_description": [f"Biz{i}" for i in range(20)],
            "description": [f"Biz{i}" for i in range(20)],
            "charged_amount": [float(i * 10) for i in range(20)],
            "category": ["Food"] * 20,
            "account": ["Card A"] * 20,
            "person": ["Alice"] * 20,
        })
        combined = pd.concat([df[df["year"] == 2024], extra], ignore_index=True)
        combined["year"] = combined["activity_date"].dt.year
        result = compute_top_businesses(combined, 2024)
        assert len(result) <= 15

    def test_sorted_descending(self):
        df = _make_txn_df()
        result = compute_top_businesses(df, 2024)
        spends = [r["total_spend"] for r in result]
        assert spends == sorted(spends, reverse=True)


class TestComputeUncategorized:
    def test_only_null_categories(self):
        df = _make_txn_df()
        result = compute_uncategorized(df, 2024)
        # Only row with category=None in 2024 is "Unknown Store"
        assert len(result) == 1
        assert result[0]["description"] == "Unknown Store"

    def test_empty_if_no_uncategorized(self):
        df = _make_txn_df()
        df = df.dropna(subset=["category"])  # remove all uncategorized
        df["year"] = df["activity_date"].dt.year
        assert compute_uncategorized(df, 2024) == []


class TestComputeHeatmap:
    def test_has_required_fields(self):
        df = _make_txn_df()
        result = compute_heatmap(df, 2024)
        assert all("category" in r and "dow" in r and "day_name" in r and "spend" in r for r in result)

    def test_no_none_categories(self):
        df = _make_txn_df()
        result = compute_heatmap(df, 2024)
        assert all(r["category"] is not None for r in result)


def _make_travel_df(dates: list[str], subcategories: list[str | None], amounts: list[float]) -> pd.DataFrame:
    df = pd.DataFrame({
        "activity_date": pd.to_datetime(dates),
        "subcategory": subcategories,
        "charged_amount": amounts,
    })
    df["year"] = df["activity_date"].dt.year
    return df


class TestComputeTravelTrips:
    def test_empty_df_returns_empty_list(self):
        df = _make_travel_df([], [], [])
        assert compute_travel_trips(df) == []

    def test_single_transaction_forms_one_trip(self):
        df = _make_travel_df(["2025-01-15"], ["Flights"], [500.0])
        result = compute_travel_trips(df)
        assert len(result) == 1
        assert result[0]["transaction_count"] == 1
        assert result[0]["start_date"] == "2025-01-15"
        assert result[0]["end_date"] == "2025-01-15"

    def test_consecutive_days_form_single_trip(self):
        df = _make_travel_df(
            ["2025-01-15", "2025-01-16", "2025-01-17"],
            ["Flights", "Hotel", "Eating Out"],
            [800.0, 200.0, 50.0],
        )
        result = compute_travel_trips(df)
        assert len(result) == 1
        assert result[0]["transaction_count"] == 3

    def test_exact_5_day_gap_stays_same_trip(self):
        df = _make_travel_df(["2025-01-01", "2025-01-06"], ["Hotel", "Hotel"], [100.0, 100.0])
        result = compute_travel_trips(df)
        assert len(result) == 1

    def test_6_day_gap_splits_into_two_trips(self):
        df = _make_travel_df(["2025-01-01", "2025-01-07"], ["Hotel", "Hotel"], [100.0, 100.0])
        result = compute_travel_trips(df)
        assert len(result) == 2

    def test_single_day_trip_label(self):
        df = _make_travel_df(["2025-01-15"], ["Flights"], [500.0])
        result = compute_travel_trips(df)
        assert result[0]["trip_label"] == "15 Jan 2025"

    def test_multi_day_same_year_label(self):
        # gap of 4 days — same trip
        df = _make_travel_df(["2025-01-15", "2025-01-19"], ["Flights", "Hotel"], [800.0, 200.0])
        result = compute_travel_trips(df)
        assert result[0]["trip_label"] == "15 Jan – 19 Jan 2025"

    def test_cross_year_trip_label(self):
        # gap of 4 days across year boundary — same trip, year = start year
        df = _make_travel_df(["2024-12-28", "2025-01-01"], ["Flights", "Hotel"], [800.0, 200.0])
        result = compute_travel_trips(df)
        assert result[0]["trip_label"] == "28 Dec 2024 – 1 Jan 2025"
        assert result[0]["year"] == 2024

    def test_sorted_year_desc(self):
        df = _make_travel_df(
            ["2023-06-01", "2025-03-10"],
            ["Hotel", "Hotel"],
            [300.0, 400.0],
        )
        result = compute_travel_trips(df, gap_days=1)
        assert result[0]["year"] == 2025
        assert result[1]["year"] == 2023

    def test_top_subcategories_limited_to_3(self):
        df = _make_travel_df(
            ["2025-01-01", "2025-01-02", "2025-01-03", "2025-01-04", "2025-01-05"],
            ["Flights", "Hotel", "Car Rental", "Eating Out", "Shopping"],
            [500.0, 300.0, 200.0, 100.0, 50.0],
        )
        result = compute_travel_trips(df)
        assert len(result[0]["top_subcategories"]) <= 3

    def test_top_subcategories_sorted_desc(self):
        df = _make_travel_df(
            ["2025-01-01", "2025-01-02", "2025-01-03"],
            ["Hotel", "Flights", "Car Rental"],
            [300.0, 800.0, 200.0],
        )
        result = compute_travel_trips(df)
        spends = [s["spend"] for s in result[0]["top_subcategories"]]
        assert spends == sorted(spends, reverse=True)

    def test_null_subcategory_excluded_from_top_subcategories(self):
        df = _make_travel_df(
            ["2025-01-01", "2025-01-02"],
            [None, "Flights"],
            [999.0, 100.0],
        )
        result = compute_travel_trips(df)
        names = [s["subcategory"] for s in result[0]["top_subcategories"]]
        assert None not in names
        assert result[0]["total_spend"] == pytest.approx(1099.0)
        assert result[0]["transaction_count"] == 2

    def test_two_trips_separated_by_gap(self):
        dates = ["2025-01-01", "2025-01-03", "2025-01-15", "2025-01-17"]
        df = _make_travel_df(dates, ["Hotel"] * 4, [100.0] * 4)
        result = compute_travel_trips(df)
        assert len(result) == 2
        assert result[0]["start_date"] == "2025-01-15"
        assert result[1]["start_date"] == "2025-01-01"
