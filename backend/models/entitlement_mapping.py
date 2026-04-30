"""Pydantic models for the Entitlement Mapping tool (Tool 1)."""

from typing import Any

from pydantic import BaseModel, Field


class EntitlementMappingSummary(BaseModel):
    total_mappings: int
    exact_matches: int
    supersets: int
    partial_matches: int
    no_matches: int
    results_preview: list[dict[str, Any]] = Field(default_factory=list)  # First 20 rows
