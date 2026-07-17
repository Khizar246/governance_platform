"""Pydantic models for the Oracle Comparator tool."""

from typing import Literal

from pydantic import BaseModel


class OracleRunConfig(BaseModel):
    analysis_type: Literal["rbac", "dsp", "both"]
    env1_name: str
    env2_name: str


class ComparisonTypeSummary(BaseModel):
    comp_type: str      # "duty_role" | "privilege" | "dsp"
    direction: str      # "Env1 → Env2" | "Env2 → Env1"
    total: int
    matches: int
    missing: int
    match_rate: float


class OracleComparatorSummary(BaseModel):
    analysis_type: str
    env1_name: str
    env2_name: str
    comparisons: list[ComparisonTypeSummary]
