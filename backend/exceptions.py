"""Custom exception hierarchy for the EY Access Governance Platform."""


class GovernanceError(Exception):
    """Base exception for all application errors."""

    def __init__(
        self,
        message: str,
        code: str = "INTERNAL_ERROR",
        details: list[str] | None = None,
    ):
        self.message = message
        self.code = code
        self.details = details or []
        super().__init__(message)


class FileFormatError(GovernanceError):
    """Raised when a file cannot be parsed or has unexpected structure."""

    def __init__(self, message: str, details: list[str] | None = None):
        super().__init__(message, "FILE_FORMAT_ERROR", details)


class JobNotFoundError(GovernanceError):
    """Raised when a job ID does not exist or has expired."""

    def __init__(self, job_id: str):
        super().__init__(
            "Analysis session not found or expired. Please start a new analysis.",
            "JOB_NOT_FOUND",
        )
