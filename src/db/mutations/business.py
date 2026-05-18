from src.db.connection import execute_mutation, is_mock_mode

_mock_state: dict = {}


def insert_business_description(description: str) -> int | None:
    """Insert a new business description. Returns the new ID (mock: None)."""
    if is_mock_mode():
        if "mock_business_descs" not in _mock_state:
            _mock_state["mock_business_descs"] = []
        new_id = len(_mock_state["mock_business_descs"]) + 100
        _mock_state["mock_business_descs"].append({"id": new_id, "description": description})
        return new_id

    execute_mutation(
        "INSERT INTO business_descriptions (description) VALUES (:description)",
        {"description": description},
    )
    return None


def insert_business_mapping(unique_id: str, business_descriptions_id: int) -> None:
    """Map a transaction to a business description."""
    if is_mock_mode():
        if "mock_business_maps" not in _mock_state:
            _mock_state["mock_business_maps"] = []
        _mock_state["mock_business_maps"].append(
            {"unique_id": unique_id, "business_descriptions_id": business_descriptions_id}
        )
        return

    execute_mutation(
        """
        INSERT INTO business_transaction_mappings (unique_id, business_descriptions_id)
        VALUES (:unique_id, :business_descriptions_id)
        ON CONFLICT (unique_id) DO UPDATE
        SET business_descriptions_id = :business_descriptions_id
        """,
        {"unique_id": unique_id, "business_descriptions_id": business_descriptions_id},
    )
