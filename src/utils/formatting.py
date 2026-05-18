def format_currency(value: float, symbol: str = "₪", decimal_places: int = 0) -> str:
    if abs(value) >= 1_000_000:
        return f"{symbol}{value / 1_000_000:,.1f}M"
    if abs(value) >= 1_000:
        return f"{symbol}{value / 1_000:,.{decimal_places}f}K"
    return f"{symbol}{value:,.{decimal_places}f}"


def format_currency_full(value: float, symbol: str = "₪") -> str:
    return f"{symbol}{value:,.0f}"


def format_percentage(value: float, decimal_places: int = 1) -> str:
    return f"{value:.{decimal_places}f}%"


def format_delta(value: float) -> str:
    sign = "+" if value > 0 else ""
    return f"{sign}{value:.1f}%"
