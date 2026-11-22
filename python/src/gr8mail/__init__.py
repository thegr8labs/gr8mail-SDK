"""Official Python SDK for Gr8Mail (https://mail.thegr8labs.com)."""

from ._client import VERSION, AsyncGr8Mail, Gr8Mail
from ._errors import (
    AccountSuspendedError,
    APIConnectionError,
    AuthenticationError,
    Gr8MailError,
    NotFoundError,
    PlanLimitError,
    QuotaExceededError,
    RateLimitError,
    ValidationError,
)

__version__ = VERSION
__all__ = [
    "Gr8Mail", "AsyncGr8Mail", "Gr8MailError", "AuthenticationError", "ValidationError", "RateLimitError",
    "QuotaExceededError", "PlanLimitError", "AccountSuspendedError", "NotFoundError", "APIConnectionError",
    "__version__",
]
