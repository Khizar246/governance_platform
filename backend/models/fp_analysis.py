"""Pydantic models for the False Positive Analysis tool (Tool 2)."""

from typing import Literal

from pydantic import BaseModel, Field


class FPRunConfig(BaseModel):
    mode: Literal["privilege", "entitlement"]
    sheets: list[str] = Field(
        default_factory=list,
        description="Subset of ROLE_SOD, ROLE_SA, USER_SOD, USER_SA to analyse",
    )


class FPSheetSummary(BaseModel):
    sheet: str
    total: int
    fp_count: int
    sl_count: int
    tc_count: int
    reduction_pct: float


class FPAnalysisSummary(BaseModel):
    mode: str
    sheets_analyzed: list[str]
    sheet_summaries: list[FPSheetSummary]
