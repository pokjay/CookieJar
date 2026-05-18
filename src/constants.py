# Hebrew -> English mappings for account types and categories
ACCOUNT_TYPE_CATEGORY_MAP = {
    "השקעות": "Investments",
    "כרית בטחון": "Rainy Day Fund",
    "פנסיה": "Pension",
    "קרן השתלמות": "Hishtalmut",
    "עובר ושב": "Bank Account",
}

ACCOUNT_TYPE_MAP = {
    "חשבון השקעות פרטי": "Private Investment",
    "קרן השתלמות": "Hishtalmut Fund",
    'פק"מ': "Fixed Deposit",
    "פק״מ": "Fixed Deposit",
    "קרן כספית": "Money Market Fund",
    "קרן פנסיה מקיפה": "Comprehensive Pension",
    "קרן פנסיה משלימה": "Supplementary Pension",
    "ביטוח מנהלים": "Managers Insurance",
    "קופת גמל": "Provident Fund",
    "קופ גמל": "Provident Fund",
    "עובר ושב": "Bank Account",
    "חסכון לכל ילד": "Children's Savings",
    "קופת גמל להשקעה": "Investment Provident Fund",
}

# Categories and their subcategories (from data model)
CATEGORIES = {
    "ATM": ["ATM"],
    "Bills": ["Phone and Internet", "Water", "Electricity", "Gas"],
    "Car": ["License Tax", "Gas", "Garage", "Parking"],
    "Cashback": ["Cashback"],
    "Coffee": ["Beans", "Coffee"],
    "Eating Out": ["Food", "Pub", "Deli"],
    "Gifts": ["Gifts"],
    "Health & Sports": ["Gym"],
    "Home": ["Maintenance", "Electronics", "Furniture", "Other"],
    "Insurance": ["Insurance"],
    "Internet Services": ["Password Manager", "Streaming"],
    "Other": ["Payment Apps", "Other", "Card Fee Waiver"],
    "Payments and Taxes": ["Import Tax", "Social Security", "Passport tax"],
    "Personal Care": ["Glasses", "Haircut"],
    "Pharmacy": ["Pharmacy", "Natural", "Shampoo"],
    "Shopping": [
        "Baby Other",
        "Alcohol",
        "KSP",
        "Gift Cards",
        "Other",
        "Amazon",
        "Baby Clothes",
        "Video Games",
        "Baby Stroller",
        "Toys",
    ],
    "Supermarket": ["Supermarket", "Water", "Deli", "Nitzi", "greengrocer"],
    "Transportation": ["Bus", "Taxi"],
    "Travel": [
        "Groceries",
        "Shopping",
        "Gas",
        "Coffee",
        "Beer",
        "Insurance",
        "ATM",
        "Tickets",
        "Car Rental",
        "Eating Out",
        "Baby stuff",
        "Other",
        "Hotel",
        "?",
        "Flights",
        "Sim",
        "Gifts",
    ],
    "Wolt": ["Deli", "Wolt", "Bakery", "Wolt+", "Restaurant"],
}

ALL_CATEGORIES = list(CATEGORIES.keys())
ALL_SUBCATEGORIES = [(cat, sub) for cat, subs in CATEGORIES.items() for sub in subs]

# Color palette for charts
CATEGORY_COLORS = {
    "Investments": "#4A90D9",
    "Pension": "#7B68EE",
    "Hishtalmut": "#50C878",
    "Rainy Day Fund": "#FFB347",
    "Bank Account": "#87CEEB",
}

# Default color palette for persons (assigned dynamically by index)
_PERSON_COLOR_PALETTE = ["#4A90D9", "#E88D97", "#50C878", "#FFB347", "#9B59B6"]

PERSON_COLORS: dict[str, str] = {}


def get_person_color(person: str) -> str:
    """Get a consistent color for a person, assigning from palette as needed."""
    if person not in PERSON_COLORS:
        idx = len(PERSON_COLORS) % len(_PERSON_COLOR_PALETTE)
        PERSON_COLORS[person] = _PERSON_COLOR_PALETTE[idx]
    return PERSON_COLORS[person]


# Default persons (fallback when session state not configured)
PERSONS = ["Gomez", "Morticia"]
