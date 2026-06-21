"""Pydantic models for the SOD & SA Analysis tool (Tool 4)."""

from typing import Literal

from pydantic import BaseModel, field_validator


class SODSARunConfig(BaseModel):
    analysis_type: Literal["role", "user", "both"]
    with_fp: bool = False
    # Dynamic analysis selection: which specific analyses to run
    # Allowed values: "role_sod", "role_sa", "user_sod", "user_sa"
    selected_analyses: list[str] = []
    with_observation: bool = False

    @field_validator("selected_analyses")
    @classmethod
    def validate_selected_analyses(cls, v: list[str]) -> list[str]:
        """Ensure all selected analyses are valid."""
        valid = {"role_sod", "role_sa", "user_sod", "user_sa"}
        invalid = [x for x in v if x not in valid]
        if invalid:
            raise ValueError(f"Invalid analysis types: {invalid}. Must be one of: {valid}")
        return v


class ViolationCounts(BaseModel):
    role_sod: int = 0
    role_sa: int = 0
    user_sod: int = 0
    user_sa: int = 0


class SODSASummary(BaseModel):
    analysis_type: str
    violations: ViolationCounts
    total_roles_analyzed: int = 0
    total_users_analyzed: int = 0
