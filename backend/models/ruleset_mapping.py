"""Pydantic models for the Ruleset Mapping tool (Tool 5)."""

from pydantic import BaseModel


class RulesetMappingSummary(BaseModel):
    sod_total: int
    sod_direct: int
    sod_derived: int
    sod_unmatched: int
    sa_total: int
    sa_direct: int
    sa_derived: int
    sa_unmatched: int
    ent_total: int
