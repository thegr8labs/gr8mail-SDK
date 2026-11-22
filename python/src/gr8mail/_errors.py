from __future__ import annotations

from typing import Optional


class Gr8MailError(Exception):
    """Raised for every API error. `name` matches the API's error code."""

    def __init__(self, message: str, *, name: str = "unknown_error", status_code: Optional[int] = None,
                 retry_after: Optional[int] = None):
        super().__init__(message)
        self.message = message
        self.name = name
        self.status_code = status_code
        self.retry_after = retry_after

    def __repr__(self) -> str:
        return f"{type(self).__name__}(name={self.name!r}, status_code={self.status_code}, message={self.message!r})"


class AuthenticationError(Gr8MailError):
    """Missing, invalid or restricted API key."""


class ValidationError(Gr8MailError):
    """The request was rejected (bad field, unverified From domain …)."""


class RateLimitError(Gr8MailError):
    """Too many requests per second/minute. Retried automatically before being raised."""


class QuotaExceededError(Gr8MailError):
    """Daily or monthly plan limit reached. `retry_after` is seconds until it resets."""


class PlanLimitError(Gr8MailError):
    """Your plan doesn't allow more of this resource (domains, contacts …)."""


class AccountSuspendedError(Gr8MailError):
    """Sending is paused for the account."""


class NotFoundError(Gr8MailError):
    """The object doesn't exist (or belongs to another account)."""


class APIConnectionError(Gr8MailError):
    """Couldn't reach Gr8Mail (after retries)."""


_BY_NAME = {
    "missing_api_key": AuthenticationError,
    "invalid_api_key": AuthenticationError,
    "restricted_api_key": AuthenticationError,
    "validation_error": ValidationError,
    "missing_required_field": ValidationError,
    "invalid_from_address": ValidationError,
    "rate_limit_exceeded": RateLimitError,
    "quota_exceeded": QuotaExceededError,
    "plan_limit_reached": PlanLimitError,
    "account_suspended": AccountSuspendedError,
    "not_found": NotFoundError,
}


def error_for(name: str, message: str, status: int, retry_after: Optional[int]) -> Gr8MailError:
    cls = _BY_NAME.get(name, Gr8MailError)
    return cls(message, name=name, status_code=status, retry_after=retry_after)
