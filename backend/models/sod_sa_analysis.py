"""Pydantic models for the SOD & SA Analysis tool (Tool 4)."""

from typing import Literal

from pydantic import BaseModel


class SODSARunConfig(BaseModel):
    analysis_type: Literal["role", "user", "both"]


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
