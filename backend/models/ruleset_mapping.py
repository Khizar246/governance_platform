"""Pydantic models for the Ruleset Mapping tool (Tool 5)."""

from pydantic import BaseModel


class DirectionCounts(BaseModel):
    """Per-direction (Client→EY or EY→Client) result counts."""
    sod_total: int = 0
    sod_direct: int = 0
    sod_derived: int = 0
    sod_unmatched: int = 0
    sa_total: int = 0
    sa_direct: int = 0
    sa_derived: int = 0
    sa_unmatched: int = 0
    ent_total: int = 0
    missing_ctrl_total: int = 0
    missing_priv_total: int = 0


class RulesetMappingSummary(BaseModel):
    # Flat keys mirror the Client→EY direction (legacy StatCards).
    sod_total: int
    sod_direct: int
    sod_derived: int
    sod_unmatched: int
    sa_total: int
    sa_direct: int
    sa_derived: int
    sa_unmatched: int
    ent_total: int
    missing_ctrl_total: int = 0
    missing_priv_total: int = 0
    # Per-direction blocks (bidirectional mapping).
    c2e: DirectionCounts | None = None
    e2c: DirectionCounts | None = None
