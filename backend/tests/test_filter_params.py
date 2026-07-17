"""Router-level tests for the JSON column-filter protocol (AUDIT.md X-1).

Each active filter travels as one query param holding a JSON array of strings
(`col=["A","B, C",""]`); `[]` means "exclude every row" and an absent param
means "no filter". These tests drive the real /results and /filter-options
endpoints of all three file tools by injecting synthetic frames straight into
each router's result cache — the same seam the analysis done-callbacks fill —
so no upload/run is needed. The autouse `_reset_jobs` fixture clears the
registered caches between tests.
"""

import json

import polars as pl
import pytest

from routers import oracle_comparator, ruleset_mapping, sod_sa_analysis
from shared.query_filters import parse_filter_param

# One blank value and one comma-containing value cover every X-1 failure mode.
VALUES = ["C1", "B, C", "", "C3"]


def _install_sod_sa(job_id: str):
    df = pl.DataFrame({"CONTROL_NAME": VALUES, "ENTITLEMENT": ["E1", "E2", "E3", "E4"]})
    sod_sa_analysis._result_dfs[job_id] = {"ROLE_SOD": df}
    return {
        "results_url": f"/api/sod-sa/results/{job_id}",
        "options_url": f"/api/sod-sa/filter-options/{job_id}",
        "base": {"sheet": "ROLE_SOD"},
        "rows_key": "data",
        "col": "CONTROL_NAME",
        "other_col": "ENTITLEMENT",
    }


def _install_oracle(job_id: str):
    df = pl.DataFrame({"CONTROL_NAME": VALUES, "ENTITLEMENT": ["E1", "E2", "E3", "E4"]})
    oracle_comparator._result_data[job_id] = {"1to2": {"duty_role": df}}
    return {
        "results_url": f"/api/oracle-comparator/results/{job_id}",
        "options_url": f"/api/oracle-comparator/filter-options/{job_id}",
        "base": {"direction": "1to2", "comparison_type": "duty_role"},
        "rows_key": "rows",
        "col": "CONTROL_NAME",
        "other_col": "ENTITLEMENT",
    }


def _install_ruleset(job_id: str):
    df = pl.DataFrame({"Control Name": VALUES, "Entitlement": ["E1", "E2", "E3", "E4"]})
    ruleset_mapping._result_dfs[job_id] = {"c2e": {"sod": df}}
    return {
        "results_url": f"/api/ruleset-mapping/results/{job_id}",
        "options_url": f"/api/ruleset-mapping/filter-options/{job_id}",
        "base": {"tab": "sod", "direction": "c2e"},
        "rows_key": "data",
        "col": "Control Name",
        "other_col": "Entitlement",
    }


_INSTALLERS = {"sod_sa": _install_sod_sa, "oracle": _install_oracle, "ruleset": _install_ruleset}

pytestmark = pytest.mark.parametrize("tool", sorted(_INSTALLERS))


@pytest.fixture
def ctx(tool):
    return _INSTALLERS[tool](f"filter-test-{tool}")


def _rows(client, ctx, extra=None):
    """GET /results with the given filter params; return (sorted values, total)."""
    resp = client.get(ctx["results_url"], params={**ctx["base"], **(extra or {})})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    return sorted(row[ctx["col"]] for row in body[ctx["rows_key"]]), body["total"]


def _options(client, ctx, column, extra=None):
    resp = client.get(ctx["options_url"], params={**ctx["base"], "column": column, **(extra or {})})
    assert resp.status_code == 200, resp.text
    return resp.json()["values"]


# ── The five X-1 repro cases ──────────────────────────────────────────────────

def test_case1_empty_only_selection_shows_only_blank_rows(client, ctx):
    rows, total = _rows(client, ctx, {ctx["col"]: json.dumps([""])})
    assert rows == [""] and total == 1


def test_case2_empty_plus_value_shows_both(client, ctx):
    rows, total = _rows(client, ctx, {ctx["col"]: json.dumps(["", "C1"])})
    assert rows == ["", "C1"] and total == 2


def test_case3_comma_value_matches_as_single_value(client, ctx):
    rows, total = _rows(client, ctx, {ctx["col"]: json.dumps(["B, C"])})
    assert rows == ["B, C"] and total == 1


def test_case4_everything_unchecked_shows_zero_rows(client, ctx):
    rows, total = _rows(client, ctx, {ctx["col"]: json.dumps([])})
    assert rows == [] and total == 0


def test_case5_untouched_column_shows_all_rows(client, ctx):
    rows, total = _rows(client, ctx, {})
    assert rows == sorted(VALUES) and total == len(VALUES)


# ── /filter-options under the same protocol ──────────────────────────────────

def test_options_list_blank_and_comma_values_verbatim(client, ctx):
    values = _options(client, ctx, ctx["col"])
    assert "" in values and "B, C" in values


def test_options_narrow_by_other_columns_filter(client, ctx):
    values = _options(client, ctx, ctx["other_col"], {ctx["col"]: json.dumps(["B, C"])})
    assert values == ["E2"]


def test_options_empty_when_other_column_excludes_all(client, ctx):
    assert _options(client, ctx, ctx["other_col"], {ctx["col"]: json.dumps([])}) == []


# ── Protocol robustness ───────────────────────────────────────────────────────

def test_non_json_filter_param_is_ignored(client, ctx):
    # A legacy comma-joined value (or any junk) must not misfilter — it is skipped.
    rows, total = _rows(client, ctx, {ctx["col"]: "C1,B"})
    assert rows == sorted(VALUES) and total == len(VALUES)


def test_parse_filter_param_contract(tool):
    assert parse_filter_param('["A","B, C",""]') == ["A", "B, C", ""]
    assert parse_filter_param("[]") == []
    assert parse_filter_param("C1,B") is None          # legacy comma string
    assert parse_filter_param("") is None
    assert parse_filter_param('"A"') is None           # JSON but not a list
    assert parse_filter_param('[1, 2]') is None        # list but not of strings
