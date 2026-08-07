"""Tests for the integration fixture's migration runner (tests/conftest.py).

The fixture applies db/migrations/*.sql by hand rather than shelling out to
dbmate, so its SQL splitting is real logic with a real failure mode - and one
that fails in a particularly unhelpful way. Splitting on a bare ";" cut
20260731000000_expose_cash_flow_type.sql in half at a semicolon inside a
comment; the leading fragment was still parseable SQL, so the error surfaced as
"syntax error at end of input" on a CREATE VIEW, and every integration test in
the suite errored at session setup. These pin the splitter so that cannot come
back silently.
"""

from tests.conftest import _split_statements


def test_splits_on_statement_terminators():
    sql = "CREATE TABLE a (id int);\nCREATE TABLE b (id int);"
    assert _split_statements(sql) == ["CREATE TABLE a (id int)", "CREATE TABLE b (id int)"]


def test_a_semicolon_inside_a_comment_does_not_end_the_statement():
    """The exact shape of the bug: a prose semicolon in an explanatory comment
    partway through a CREATE VIEW."""
    sql = """
CREATE VIEW v AS
 SELECT x,
    -- cash_flow_type is an enum; the scraped branch contributes NULL::text, so
    -- cast here to give the UNION a single resolvable type.
    y
   FROM t;
"""
    statements = _split_statements(sql)
    assert len(statements) == 1
    assert statements[0].startswith("CREATE VIEW v AS")
    assert statements[0].rstrip().endswith("FROM t")
    assert "cash_flow_type is an enum" not in statements[0]


def test_a_semicolon_inside_a_string_literal_does_not_end_the_statement():
    sql = "INSERT INTO t (v) VALUES ('a;b');"
    assert _split_statements(sql) == ["INSERT INTO t (v) VALUES ('a;b')"]


def test_an_escaped_quote_does_not_end_the_literal():
    sql = "INSERT INTO t (v) VALUES ('it''s; fine');\nSELECT 1;"
    assert _split_statements(sql) == ["INSERT INTO t (v) VALUES ('it''s; fine')", "SELECT 1"]


def test_trailing_statement_without_a_terminator_is_kept():
    assert _split_statements("SELECT 1;\nSELECT 2") == ["SELECT 1", "SELECT 2"]


def test_comment_only_and_empty_input_produce_no_statements():
    assert _split_statements("-- nothing to do here\n") == []
    assert _split_statements("   \n  ") == []


def test_every_real_migration_splits_into_runnable_looking_statements():
    """A guard on the actual corpus: no statement may come out empty or as a
    bare comment remnant, which is what a mis-split leaves behind."""
    from tests.conftest import MIGRATIONS_DIR, _extract_up_sql

    migrations = sorted(MIGRATIONS_DIR.glob("*.sql"))
    assert migrations, "no migrations found — the fixture would silently do nothing"

    for path in migrations:
        for statement in _split_statements(_extract_up_sql(path)):
            assert statement.strip(), f"{path.name} produced an empty statement"
            assert not statement.lstrip().startswith("--"), (
                f"{path.name} produced a comment-only statement: {statement[:60]!r}"
            )
