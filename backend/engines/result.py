"""Shared structured return type for all engine functions.

Engines import this instead of defining their own copy; it keeps them
import-free of each other and of any HTTP framework.
"""

from dataclasses import dataclass, field
from typing import Any


@dataclass
class EngineResult:
    """Structured return type for all engine functions."""
    success: bool
    data: Any = None
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
