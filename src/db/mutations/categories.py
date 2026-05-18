from src.db.connection import execute_mutation, is_mock_mode

_mock_state: dict = {}


def insert_category_mapping(description: str, category: str, subcategory: str) -> None:
    """Insert a new description-to-category mapping."""
    if is_mock_mode():
        if "mock_categories" not in _mock_state:
            _mock_state["mock_categories"] = []
        _mock_state["mock_categories"].append(
            {"description": description, "category": category, "subcategory": subcategory}
        )
        return

    execute_mutation(
        """
        INSERT INTO description_to_category (description, category, subcategory)
        VALUES (:description, :category, :subcategory)
        """,
        {"description": description, "category": category, "subcategory": subcategory},
    )
