"""Mock data generators for development without a real database."""

import random
from datetime import date, timedelta

import numpy as np
import pandas as pd

from src.constants import ALL_SUBCATEGORIES, PERSONS

# Per-function RNGs so generation is independent of call order.
_rng_txn = np.random.default_rng(42)
_rng_cf = np.random.default_rng(43)
_rng_acct = np.random.default_rng(44)
_rng_tracking = np.random.default_rng(45)
_rand_txn = random.Random(42)
_rand_desc = random.Random(43)
_rand_mappings = random.Random(44)

# ---------------------------------------------------------------------------
# Business descriptions used in mock transactions
# ---------------------------------------------------------------------------
_BUSINESS_NAMES = {
    "Supermarket": [
        "Rami Levy",
        "Shufersal",
        "Yochananof",
        "Osher Ad",
        "Victory",
        "Tiv Taam",
    ],
    "Eating Out": ["Cafe Landwer", "Aroma", "BBB", "Oshi Oshi", "Moses"],
    "Wolt": ["Wolt*Restaurant", "Wolt*Deli", "Wolt*Bakery", "Wolt", "Wolt+"],
    "Coffee": ["Nespresso", "Cafe Joe", "Cofix"],
    "Shopping": ["Amazon.com", "KSP", "IKEA", "AliExpress", "Zara"],
    "Travel": [
        "Booking.com",
        "Airbnb",
        "EasyJet",
        "Hertz",
        "United Airlines",
        "Wizz Air",
    ],
    "Transportation": ["Moovit", "Gett", "Uber"],
    "Bills": ["Partner Communications", "Hot Net", "Israel Electric", "Mei Gvataim"],
    "Health & Sports": ["Holmes Place", "Country Club"],
    "Insurance": ["Harel Insurance", "Migdal Insurance"],
    "Internet Services": ["Netflix", "Spotify", "1Password", "Disney+"],
    "Pharmacy": ["Super-Pharm", "Be Pharm"],
    "Car": ["Delek", "Sonol", "Paz", "Ahuzat Hahof Parking"],
    "Personal Care": ["Opticana", "Supercuts"],
    "Gifts": ["Steimatzky", "Amazon Gift"],
    "Home": ["Ace Hardware", "Home Center", "IKEA Home"],
    "Payments and Taxes": ["Bituach Leumi", "Misrad Hapnim"],
    "ATM": ["ATM Withdrawal"],
    "Cashback": ["Cashback Credit"],
    "Other": ["Venmo", "PayBox", "Bit Payment"],
}

# Broad descriptions for business mapping
_BROAD_DESCRIPTIONS = ["Wolt", "Venmo", "PayBox", "Bit Payment", "Gift Cards"]

# ---------------------------------------------------------------------------
# Transactions
# ---------------------------------------------------------------------------


def _generate_transactions() -> pd.DataFrame:
    rows = []
    start = date(2022, 1, 1)
    end = date(2025, 10, 31)
    num_days = (end - start).days

    accounts = {
        "Gomez": [("Isracard", "1234"), ("Cal", "5678")],
        "Morticia": [("Max", "9012"), ("Isracard", "3456")],
    }

    for i in range(2200):
        person = _rand_txn.choice(PERSONS)
        company, account = _rand_txn.choice(accounts[person])
        day_offset = _rand_txn.randint(0, num_days)
        activity_date = start + timedelta(days=day_offset)

        # Pick category — 12% uncategorized
        if _rand_txn.random() < 0.12:
            category = None
            subcategory = None
            cat_key = _rand_txn.choice(list(_BUSINESS_NAMES.keys()))
        else:
            cat_key = _rand_txn.choices(
                list(_BUSINESS_NAMES.keys()),
                weights=[15, 10, 12, 5, 10, 6, 4, 6, 3, 3, 5, 4, 6, 2, 2, 3, 2, 2, 1, 3],
                k=1,
            )[0]
            # Find matching subcategory
            matching = [(c, s) for c, s in ALL_SUBCATEGORIES if c == cat_key]
            if matching:
                category, subcategory = _rand_txn.choice(matching)
            else:
                category, subcategory = cat_key, cat_key

        description = _rand_txn.choice(_BUSINESS_NAMES[cat_key])

        # Amount ranges by category
        if cat_key == "Travel":
            amount = round(_rand_txn.uniform(50, 5000), 2)
        elif cat_key in ("Bills", "Insurance"):
            amount = round(_rand_txn.uniform(50, 500), 2)
        elif cat_key in ("Supermarket", "Eating Out", "Wolt"):
            amount = round(_rand_txn.uniform(20, 400), 2)
        elif cat_key == "Shopping":
            amount = round(_rand_txn.uniform(30, 2000), 2)
        elif cat_key == "Cashback":
            amount = -round(_rand_txn.uniform(10, 200), 2)
        else:
            amount = round(_rand_txn.uniform(10, 300), 2)

        is_broad = description in _BROAD_DESCRIPTIONS
        if is_broad:
            suffix = _rand_txn.choice(["Place A", "Place B", "Place C", "Place D"])
            processed = f"{description} - {suffix}"
        else:
            processed = description

        rows.append(
            {
                "unique_id": f"txn_{i:05d}",
                "company_id": company,
                "account": account,
                "status": "completed",
                "activity_date": activity_date,
                "charged_amount": amount,
                "original_charged_amount": -abs(amount),
                "charged_currency": "ILS",
                "original_amount": amount,
                "original_currency": (
                    "ILS" if cat_key != "Travel" else _rand_txn.choice(["ILS", "USD", "EUR"])
                ),
                "description": description,
                "processed_description": processed,
                "category": category,
                "subcategory": subcategory,
                "memo": None,
                "identifier": f"ID{_rand_txn.randint(100000, 999999)}",
                "person": person,
            }
        )

    df = pd.DataFrame(rows)
    df["activity_date"] = pd.to_datetime(df["activity_date"])
    return df.sort_values("activity_date").reset_index(drop=True)


# ---------------------------------------------------------------------------
# Cash Flow
# ---------------------------------------------------------------------------


def _generate_cash_flow() -> pd.DataFrame:
    rows = []
    accounts = {
        "Gomez": ["Bank Leumi", "Discount"],
        "Morticia": ["Bank Leumi", "Mizrahi"],
    }
    for year in range(2022, 2026):
        for month in range(1, 13):
            if year == 2025 and month > 10:
                break
            for person, accs in accounts.items():
                for acc in accs:
                    base_income = _rng_cf.normal(18000 if person == "Gomez" else 14000, 1500)
                    income = max(round(base_income, 0), 5000)
                    expense = max(round(income * _rng_cf.uniform(0.55, 0.85), 0), 3000)
                    _mt_prob = _rng_cf.random()
                    _mt_val = _rng_cf.uniform(0, 500)
                    money_transferred = round(_mt_val, 0) if _mt_prob < 0.3 else 0
                    savings = max(round(income * _rng_cf.uniform(0.1, 0.3), 0), 0)
                    diff = income - expense - savings
                    savings_pct = round(savings / income * 100, 1) if income > 0 else 0

                    rows.append(
                        {
                            "year": year,
                            "month": month,
                            "person": person,
                            "account": acc,
                            "income": income,
                            "expense": expense,
                            "money_transferred": money_transferred,
                            "savings": savings,
                            "income_expense_diff": diff,
                            "savings_percentage": savings_pct,
                            "comments": None,
                        }
                    )

    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Investment Accounts
# ---------------------------------------------------------------------------


def _generate_investment_accounts() -> pd.DataFrame:
    # fmt: (id, person, company, account_type, account_type_category,
    #        is_active, is_pension, monthly_deposit, account_number)
    _accs = [
        (1, "Gomez", "Meitav", "חשבון השקעות פרטי", "השקעות", True, False, 3000, "G-INV-001"),
        (2, "Gomez", "Meitav", "קרן השתלמות", "קרן השתלמות", True, False, 2500, "G-HSH-001"),
        (3, "Gomez", "Menora", "קרן פנסיה מקיפה", "פנסיה", True, True, 2000, "G-PEN-001"),
        (4, "Gomez", "Psagot", "קרן כספית", "כרית בטחון", True, False, 0, "G-RDF-001"),
        (5, "Gomez", "Leumi", "עובר ושב", "עובר ושב", True, False, 0, "G-BNK-001"),
        (6, "Morticia", "Harel", "חשבון השקעות פרטי", "השקעות", True, False, 2000, "M-INV-001"),
        (7, "Morticia", "Harel", "קרן השתלמות", "קרן השתלמות", True, False, 2000, "M-HSH-001"),
        (8, "Morticia", "Migdal", "קרן פנסיה מקיפה", "פנסיה", True, True, 1800, "M-PEN-001"),
        (9, "Morticia", "Leumi", 'פק"מ', "כרית בטחון", True, False, 0, "M-RDF-001"),
        (10, "Morticia", "Mizrahi", "עובר ושב", "עובר ושב", True, False, 0, "M-BNK-001"),
    ]
    cols = [
        "id",
        "person",
        "company",
        "account_type",
        "account_type_category",
        "is_active",
        "is_pension",
        "monthly_deposit",
        "account_number",
    ]
    rows = [dict(zip(cols, a)) for a in _accs]
    df = pd.DataFrame(rows)
    df["deposit_management_fees"] = _rng_acct.uniform(0.0, 0.5, len(df)).round(2)
    df["acc_management_fees"] = _rng_acct.uniform(0.0, 0.3, len(df)).round(2)
    df["investment_track"] = "General"
    return df


# ---------------------------------------------------------------------------
# Investment Tracking
# ---------------------------------------------------------------------------


def _generate_investment_tracking() -> pd.DataFrame:
    accounts = get_investment_accounts()
    rows = []
    row_id = 1

    for _, acc in accounts.iterrows():
        # Base amount depends on category
        base = {
            "השקעות": 150000,
            "קרן השתלמות": 100000,
            "פנסיה": 200000,
            "כרית בטחון": 50000,
            "עובר ושב": 30000,
        }.get(acc["account_type_category"], 50000)

        amount = base * _rng_tracking.uniform(0.7, 1.3)

        for year in range(2022, 2026):
            for quarter_month in [3, 6, 9, 12]:
                if year == 2025 and quarter_month > 9:
                    break
                growth = _rng_tracking.normal(1.02, 0.03)
                amount = max(amount * growth + acc["monthly_deposit"] * 3, 1000)
                rows.append(
                    {
                        "id": row_id,
                        "investment_accounts_id": acc["id"],
                        "activity_date": date(year, quarter_month, 28),
                        "amount": round(amount, 2),
                    }
                )
                row_id += 1

    df = pd.DataFrame(rows)
    df["activity_date"] = pd.to_datetime(df["activity_date"])
    return df


# ---------------------------------------------------------------------------
# Description to Category
# ---------------------------------------------------------------------------


def _generate_description_to_category() -> pd.DataFrame:
    rows = []
    row_id = 1
    for cat_key, descs in _BUSINESS_NAMES.items():
        matching = [(c, s) for c, s in ALL_SUBCATEGORIES if c == cat_key]
        for desc in descs:
            if matching:
                cat, sub = _rand_desc.choice(matching)
            else:
                cat, sub = cat_key, cat_key
            rows.append({"id": row_id, "description": desc, "category": cat, "subcategory": sub})
            row_id += 1
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Business Descriptions + Mappings
# ---------------------------------------------------------------------------


def _generate_business_descriptions() -> pd.DataFrame:
    rows = []
    row_id = 1
    business_names = [
        "Golda Ice Cream",
        "Shookit Market",
        "Pizza Hut",
        "Japanika",
        "Dominos",
        "McDonalds",
        "Burgerim",
        "Cafe Cafe",
        "Roladin",
        "Aldo",
    ]
    for name in business_names:
        rows.append({"id": row_id, "description": name})
        row_id += 1
    return pd.DataFrame(rows)


def _generate_business_mappings() -> pd.DataFrame:
    # Map some transactions with broad descriptions to business names
    transactions = get_transactions()
    broad_txns = transactions[transactions["description"].isin(_BROAD_DESCRIPTIONS)]
    sample = broad_txns.head(30)
    rows = []
    for _, txn in sample.iterrows():
        rows.append(
            {
                "unique_id": txn["unique_id"],
                "business_descriptions_id": _rand_mappings.randint(1, 10),
            }
        )
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Cached accessors
# ---------------------------------------------------------------------------

_cache: dict[str, pd.DataFrame] = {}


def get_transactions() -> pd.DataFrame:
    if "transactions" not in _cache:
        _cache["transactions"] = _generate_transactions()
    return _cache["transactions"].copy()


def get_cash_flow() -> pd.DataFrame:
    if "cash_flow" not in _cache:
        _cache["cash_flow"] = _generate_cash_flow()
    return _cache["cash_flow"].copy()


def get_investment_accounts() -> pd.DataFrame:
    if "investment_accounts" not in _cache:
        _cache["investment_accounts"] = _generate_investment_accounts()
    return _cache["investment_accounts"].copy()


def get_investment_tracking() -> pd.DataFrame:
    if "investment_tracking" not in _cache:
        _cache["investment_tracking"] = _generate_investment_tracking()
    return _cache["investment_tracking"].copy()


def get_description_to_category() -> pd.DataFrame:
    if "description_to_category" not in _cache:
        _cache["description_to_category"] = _generate_description_to_category()
    return _cache["description_to_category"].copy()


def get_business_descriptions() -> pd.DataFrame:
    if "business_descriptions" not in _cache:
        _cache["business_descriptions"] = _generate_business_descriptions()
    return _cache["business_descriptions"].copy()


def get_business_mappings() -> pd.DataFrame:
    if "business_mappings" not in _cache:
        _cache["business_mappings"] = _generate_business_mappings()
    return _cache["business_mappings"].copy()
